import { z } from 'zod';

/**
 * Zod schemas for API request boundaries (the customer app and partner console).
 * Everything crossing the wire is parsed here before it reaches a handler — an
 * invalid body never touches the database or the Limits Engine.
 */

export const currencySchema = z.enum(['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD']);

/**
 * Minor units off the wire: a non-negative integer sent as a JSON number or a
 * digit string (bigint has no JSON form), normalized to `bigint`. Rejects
 * floats, signs, and non-numeric strings.
 */
export const amountMinorSchema = z
  .union([
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    z
      .string()
      .regex(/^\d+$/, 'must be a non-negative integer')
      .max(19, 'amount exceeds the supported signed 64-bit range'),
  ])
  .transform((v) => BigInt(v))
  .refine((value) => value <= 9_223_372_036_854_775_807n, {
    message: 'amount exceeds the supported signed 64-bit range',
  });

export const positiveAmountMinorSchema = amountMinorSchema.refine((v) => v > 0n, {
  message: 'amount must be greater than zero',
});

export const uuidSchema = z.string().uuid();

/** POST /api/orders — propose an investment; the engine decides its fate. */
export const proposeOrderSchema = z.object({
  instrumentId: uuidSchema,
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  // Optional client idempotency key; the server derives one when absent.
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type ProposeOrderInput = z.infer<typeof proposeOrderSchema>;

/** POST /api/approvals — the agent (or a test) opens a "Needs your approval"
 *  card. Approving it later is one of only two paths to an order. */
export const createApprovalSchema = z.object({
  instrumentId: uuidSchema,
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  type: z.enum(['investment_rec', 'fund_transfer', 'plan_enrollment']).default('investment_rec'),
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
  /** The agent's one-line case for the move, when the card was raised from a
   *  chat proposal — stored on the snapshot so "How this was decided" exists
   *  on chat-raised cards too, not only on background-sweep ones. */
  summary: z.string().max(500).optional(),
  /** The gate's reasons for the verdict, same provenance as `summary`. */
  reasons: z.array(z.string().max(300)).max(10).optional(),
});
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;

/** POST /api/approvals/:id/approve — optional client idempotency key. */
export const approveSchema = z.object({
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type ApproveInput = z.infer<typeof approveSchema>;

/** POST /api/ingestion/pull — pull a partner's statements into the reconciliation queue. */
export const ingestPullSchema = z.object({
  partnerCode: z.string().min(2).max(8),
});
export type IngestPullInput = z.infer<typeof ingestPullSchema>;

/** POST /api/agent/message — a chat turn to the Capital Agent. */
export const agentMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type AgentMessageInput = z.infer<typeof agentMessageSchema>;

/** POST /api/approvals/:id/reject and console reject — optional reason. */
export const rejectSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type RejectInput = z.infer<typeof rejectSchema>;

/**
 * POST /api/console/orders/:id/accept — the firm takes the order onto its desk
 * and commits to a settlement date.
 *
 * The exec dialog has told investors "set by your firm on acceptance" since the
 * fabricated "T+2" was removed from it; this is what finally sets it. Optional,
 * because a desk that cannot yet commit to a date must still be able to accept
 * — and a date invented to fill the field is the thing that was removed.
 */
export const acceptOrderSchema = z.object({
  /** ISO-8601. Parsed and range-checked rather than trusted as a string. */
  settlementEta: z
    .string()
    .datetime({ offset: true })
    .refine((v) => {
      const at = new Date(v).getTime();
      const now = Date.now();
      // A settlement date in the past is a typo; one more than a year out is
      // not a settlement date. Both are worth refusing at the boundary.
      return at > now - 86_400_000 && at < now + 365 * 86_400_000;
    }, 'settlement date must be between yesterday and a year from now')
    .optional(),
});
export type AcceptOrderInput = z.infer<typeof acceptOrderSchema>;

/**
 * POST /api/console/orders/:id/settle — what the firm actually executed.
 *
 * `settle_order` used to write three columns: status, settled_at, updated_at.
 * An investor was told "settled" and nothing else, and the desk had nowhere to
 * put the execution. Every field here is optional: a firm that does not report
 * a price still has to be able to settle, and the alternative to an empty
 * column is an invented number on a record someone reads about their money.
 */
export const settleOrderSchema = z.object({
  /** Price per unit in minor units. Zero is legal (a bonus allocation). */
  unitPriceMinor: amountMinorSchema.optional(),
  /** Decimal units, as a string — fractional and not a money amount. */
  units: z
    .string()
    .regex(/^\d{1,14}(\.\d{1,6})?$/, 'units must fit the supported 20,6 decimal precision')
    .refine((value) => /[1-9]/.test(value), 'units must be greater than zero')
    .optional(),
  feeMinor: amountMinorSchema.optional(),
  /** The firm's own reference, for reconciling against their books. */
  externalRef: z.string().min(1).max(120).optional(),
});
export type SettleOrderInput = z.infer<typeof settleOrderSchema>;

/**
 * POST /api/console/clients/:id/funds — the firm confirms settled funding.
 *
 * The money moved between the investor and the firm, off-platform; what CCN
 * records is the firm's statement that it landed. Amount and currency are the
 * firm's words about its own books, `reference` is theirs to reconcile by.
 */
export const confirmFundsSchema = z.object({
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  /** The firm's own reference — a wire id, a receipt number. */
  reference: z.string().min(1).max(120).optional(),
});
export type ConfirmFundsInput = z.infer<typeof confirmFundsSchema>;

/**
 * PATCH /api/console/partner — a firm corrects its own record.
 *
 * Three fields, and the omissions are the point. `code` is how the adapter
 * registry resolves an executing firm, `regulator` is a compliance claim
 * rendered to investors on every deal card, and `agreementStatus` gates live
 * order routing. None is a firm's to set about itself.
 */
export const partnerProfileSchema = z.object({
  name: z.string().min(2).max(140),
  kind: z.string().max(80).optional(),
  residency: z.string().max(100).optional(),
  /** How a client funds an account with this firm, in the firm's own words.
   *  Omitted = unchanged; empty string = cleared. */
  fundingInstructions: z.string().max(2000).optional(),
  /**
   * Withdrawal charges (0026). All omitted = unchanged. The flat fee is minor
   * units as a digit string (bigint has no JSON form); the two rates are basis
   * points — 100 = 1%, so Jamaica's 15% GCT is 1500.
   */
  withdrawalFeeFlatMinor: z
    .string()
    .regex(/^\d{1,15}$/, 'minor units as a digit string')
    .optional(),
  withdrawalFeeBps: z.number().int().min(0).max(10000).optional(),
  gctBps: z.number().int().min(0).max(10000).optional(),
});
export type PartnerProfileInput = z.infer<typeof partnerProfileSchema>;

/**
 * PUT /api/console/webhook — a partner-managed audit-event export target.
 *
 * The deployment allowlist is enforced separately by the API's outbound
 * network guard. This schema keeps the stored value unambiguous: TLS only,
 * no credentials, and no query/fragment where secrets are too easily hidden.
 */
export const partnerWebhookSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .transform((raw, ctx) => {
      try {
        const url = new URL(raw);
        if (
          url.protocol !== 'https:' ||
          url.username !== '' ||
          url.password !== '' ||
          url.port !== '' ||
          url.search !== '' ||
          url.hash !== ''
        ) {
          throw new Error('unsafe webhook URL');
        }
        return url.toString();
      } catch {
        ctx.addIssue({
          code: 'custom',
          message:
            'expected an HTTPS URL without credentials, a custom port, query parameters, or a fragment',
        });
        return z.NEVER;
      }
    }),
  active: z.boolean().default(true),
  rotateSecret: z.boolean().default(false),
});
export type PartnerWebhookInput = z.infer<typeof partnerWebhookSchema>;

/**
 * POST /api/portfolio/withdrawals — the investor asks their firm for money
 * back. The firm decides; recorded cash falls only when it confirms it paid.
 */
export const withdrawalRequestSchema = z.object({
  partnerCode: z.string().min(2).max(12),
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
});
export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;

/** POST /api/console/withdrawals/:id/decide — pay it or decline it (with a
 *  reason the client will read). */
export const decideWithdrawalSchema = z
  .object({
    paid: z.boolean(),
    reason: z.string().min(1).max(300).optional(),
    reference: z.string().min(1).max(120).optional(),
  })
  .refine((v) => v.paid || (v.reason ?? '').trim().length > 0, {
    message: 'declining needs a reason the client will read',
  });
export type DecideWithdrawalInput = z.infer<typeof decideWithdrawalSchema>;

/**
 * POST /api/portfolio/funding-notice — "I've sent the money." Lands in the
 * firm's existing reconciliation queue for human confirmation; nothing is
 * credited until the desk matches it.
 */
export const fundingNoticeSchema = z.object({
  partnerCode: z.string().min(2).max(12),
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  reference: z.string().trim().min(3).max(120).optional(),
  receipt: z
    .object({
      name: z.string().trim().min(1).max(180),
      mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
      // Two binary megabytes encode to at most 2,796,204 base64 characters.
      // The API decodes and checks the exact byte count before storing it.
      data: z.string().min(1).max(2_800_000),
    })
    .optional(),
});
export type FundingNoticeInput = z.infer<typeof fundingNoticeSchema>;

/**
 * POST /api/console/products — a partner lists a product, or amends one.
 *
 * The fields are exactly what the marketplace renders on a deal card, which is
 * the point: the console used to capture a name and a type, and a listing made
 * from those two showed "US$0", a blank metric and "Not rated" to every
 * investor who opened it.
 *
 * `slug` and `regulator` are deliberately absent. The slug is the key holdings
 * and reconciliation join on, so it is derived once by the database and never
 * re-typed; the regulator is a compliance claim about the executing firm, and a
 * console that could set it freely could claim any regulator it liked.
 */
const instrumentInputSchema = z.object({
  /** Present to amend a listing, absent to create one. */
  id: uuidSchema.optional(),
  name: z.string().trim().min(2).max(140),
  type: z.enum(['bond', 'fund', 'equity', 'real_estate', 'private']),
  /** The short badge on the card. Derived from the name when not given. */
  abbr: z.string().trim().min(1).max(12).optional(),
  currency: currencySchema.default('USD'),
  /** Zero is allowed and means "no minimum", so this is not the positive variant. */
  minInvestmentMinor: amountMinorSchema.default(0),
  term: z.string().trim().max(60).optional(),
  /** The headline number, e.g. "8.25%" — free text because a fund's is not a bond's. */
  metric: z.string().trim().max(60).optional(),
  /** What that number is, e.g. "Coupon", "Target return". */
  metricLabel: z.string().trim().max(60).optional(),
  risk: z.enum(['low', 'medium', 'high']),
  description: z.string().trim().max(2000).optional(),
  region: z.string().trim().max(100).optional(),
});

const completeInstrumentHeadline = (input: {
  metric?: string | undefined;
  metricLabel?: string | undefined;
}) => Boolean(input.metric) === Boolean(input.metricLabel);

export const listInstrumentSchema = instrumentInputSchema.refine(completeInstrumentHeadline, {
  message: 'headline figure and label must be supplied together',
  path: ['metricLabel'],
});
export type ListInstrumentInput = z.infer<typeof listInstrumentSchema>;

/**
 * POST /api/console/products/bulk — new listings only.
 *
 * The limit bounds one transaction and one audit burst. `id` is deliberately
 * removed: bulk import adds products; amendments remain an explicit one-product
 * review so a spreadsheet cannot overwrite an existing catalogue by mistake.
 */
const bulkInstrumentInputSchema = instrumentInputSchema
  .omit({ id: true })
  .strict()
  .refine(completeInstrumentHeadline, {
    message: 'headline figure and label must be supplied together',
    path: ['metricLabel'],
  });

export const bulkListInstrumentSchema = z
  .object({ products: z.array(bulkInstrumentInputSchema).min(1).max(100) })
  .strict();
export type BulkListInstrumentInput = z.infer<typeof bulkListInstrumentSchema>;

/**
 * Gateway — evidence/matching/introduction schemas. See
 * `packages/gateway-guardrail` (the deterministic decision) and
 * `packages/agent/src/gateway/matching.ts` (the deterministic score) for the
 * pure modules these requests feed.
 */

export const ordinalSchema = z.enum(['low', 'medium', 'high']);

/** POST /api/gateway/mandate — free text; the orchestrator extracts the fields
 *  below and the caller confirms them before they're saved (never silently guessed). */
export const gatewayMandateNarrativeSchema = z.object({
  narrative: z.string().min(10).max(4000),
});
export type GatewayMandateNarrativeInput = z.infer<typeof gatewayMandateNarrativeSchema>;

/** The confirmed, structured mandate — what actually gets saved. */
export const gatewayMandateSchema = z
  .object({
    countries: z.array(z.string().min(1).max(100)).max(20).default([]),
    sectors: z.array(z.string().min(1).max(100)).max(20).default([]),
    minCheckMinor: amountMinorSchema,
    maxCheckMinor: amountMinorSchema,
    stagePreferences: z.array(z.string().min(1).max(100)).max(10).default([]),
    riskAppetite: ordinalSchema,
    horizonYears: z.number().int().min(0).max(50),
    targetReturnPct: z.number().min(0).max(1000),
    liquidityNeed: ordinalSchema,
    boardInvolvement: z.boolean().default(false),
    impactPreference: z.boolean().default(false),
    currency: currencySchema.default('USD'),
  })
  .refine((d) => d.maxCheckMinor >= d.minCheckMinor, {
    message: 'maxCheckMinor must be greater than or equal to minCheckMinor',
    path: ['maxCheckMinor'],
  });
export type GatewayMandateInput = z.infer<typeof gatewayMandateSchema>;

/** POST /api/gateway/opportunities — a submitted opportunity. */
export const gatewayOpportunitySchema = z.object({
  name: z.string().min(1).max(200),
  country: z.string().min(1).max(100),
  sector: z.string().min(1).max(100),
  stage: z.string().min(1).max(100),
  investmentType: z.string().min(1).max(100),
  capitalSoughtMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  valuationMinor: amountMinorSchema.optional(),
  useOfFunds: z.string().max(2000).optional(),
  targetReturnPct: z.number().min(0).max(1000),
  horizonYears: z.number().int().min(0).max(50),
  riskRating: ordinalSchema,
  liquidity: ordinalSchema,
  offersBoardSeat: z.boolean().default(false),
  hasImpactFocus: z.boolean().default(false),
  exitAssumptions: z.string().max(2000).optional(),
  summary: z.string().min(1).max(4000),
});
export type GatewayOpportunityInput = z.infer<typeof gatewayOpportunitySchema>;

/** POST /api/gateway/matches/:id/request-introduction */
export const gatewayIntroductionRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type GatewayIntroductionRequestInput = z.infer<typeof gatewayIntroductionRequestSchema>;

/** POST /api/gateway/introductions/:id/approve|reject */
export const gatewayIntroductionDecisionSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type GatewayIntroductionDecisionInput = z.infer<typeof gatewayIntroductionDecisionSchema>;

/**
 * Planning — goals + the products catalog (packages/db/src/schema/activity.ts
 * `goals`, packages/db/src/schema/market.ts `planningProducts`).
 */

/** POST /api/planning/goals */
export const createGoalSchema = z.object({
  name: z.string().min(1).max(200),
  targetMinor: positiveAmountMinorSchema,
  fromLabel: z.string().max(200).optional(),
  eta: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

/**
 * Onboarding — one schema per wizard step (packages/db/src/schema/identity.ts).
 * Each step is its own request so a partially-completed wizard is never an
 * invalid intermediate state in the database.
 */

/** POST /api/onboarding/identity */
export const onboardingIdentitySchema = z.object({
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date'),
  placeOfBirth: z.string().min(1).max(150),
  residentialAddress: z.string().min(5).max(500),
  residencyCountry: z.string().min(1).max(100),
  citizenships: z.array(z.string().min(1).max(100)).min(1).max(5),
  occupation: z.string().min(1).max(150),
  employer: z.string().max(200).optional(),
});
export type OnboardingIdentityInput = z.infer<typeof onboardingIdentitySchema>;

/**
 * POST /api/onboarding/compliance — the declarations.
 *
 * Two are affirmations and must be true to proceed. The third is a disclosure
 * and is a plain boolean: it used to be `notPoliticallyExposed: z.literal(true)`,
 * which made "I am not a PEP" the only submittable answer, wrote `is_pep = false`
 * for every person on the network, and left the console's "Politically exposed"
 * chip permanently unreachable. A screening question with one legal answer is
 * not screening anything.
 */
export const onboardingComplianceSchema = z.object({
  pepStatus: z.enum(['none', 'self', 'family', 'close_associate']),
  taxResidencies: z
    .array(
      z
        .object({
          country: z.string().min(1).max(100),
          identifierType: z.enum(['trn', 'ssn', 'tin', 'national_id', 'other']),
          identifier: z.string().min(3).max(80).optional(),
          noIdentifierReason: z.string().min(3).max(300).optional(),
        })
        .refine((value) => Boolean(value.identifier) !== Boolean(value.noIdentifierReason), {
          message: 'provide either a tax identifier or a reason it is unavailable',
        }),
    )
    .min(1)
    .max(5),
  fatcaStatus: z.enum(['us_person', 'non_us_person', 'undetermined']),
  fatcaForm: z.enum(['w9', 'w8ben', 'not_applicable']),
  taxResidencyDeclared: z.literal(true),
  risksUnderstood: z.literal(true),
});
export type OnboardingComplianceInput = z.infer<typeof onboardingComplianceSchema>;

/** POST /api/onboarding/risk — three fact-find answers, each scored 1-5. */
export const onboardingRiskSchema = z.object({
  scores: z.tuple([
    z.number().int().min(1).max(5),
    z.number().int().min(1).max(5),
    z.number().int().min(1).max(5),
  ]),
});
export type OnboardingRiskInput = z.infer<typeof onboardingRiskSchema>;

/** POST /api/onboarding/funds — at least one declared source. */
export const onboardingFundsSchema = z.object({
  sources: z.array(z.enum(['investment', 'salary', 'business', 'other'])).min(1),
  sourceOfWealth: z.string().min(3).max(500),
  accountPurpose: z.string().min(3).max(500),
  expectedAnnualInvestmentMinor: positiveAmountMinorSchema,
  expectedFrequency: z.enum(['one_off', 'monthly', 'quarterly', 'annually', 'irregular']),
});
export type OnboardingFundsInput = z.infer<typeof onboardingFundsSchema>;

/**
 * POST /api/onboarding/documents — a KYC document, file included.
 *
 * `data` is base64 of at most 2MB (the table's CHECK enforces the decoded
 * size; the length ceiling here refuses obvious oversends before decoding).
 * The mime allowlist is the set a compliance desk can actually open, and what
 * the two byte-serving routes will echo as Content-Type — nothing executable
 * ever comes back with a renderable type.
 */
export const kycDocumentSchema = z.object({
  step: z.enum(['identity', 'compliance', 'risk', 'funds']),
  documentType: z
    .enum([
      'government_id',
      'proof_of_address',
      'source_of_funds',
      'source_of_wealth',
      'tax_form',
      'other',
    ])
    .default('other'),
  label: z.string().min(1).max(140),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  issuingCountry: z.string().min(1).max(100).optional(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date')
    .optional(),
  data: z.string().min(1).max(2_900_000),
});

export const partnerKycReviewSchema = z
  .object({
    identityVerified: z.literal(true),
    addressVerified: z.literal(true),
    sanctionsClear: z.literal(true),
    pepReviewComplete: z.literal(true),
    fundsVerified: z.literal(true),
    taxDocumentationComplete: z.literal(true),
    amlRiskRating: z.enum(['low', 'medium', 'high']),
    seniorApproval: z.boolean(),
    policyKey: z.enum(['JM', 'GY', 'TT', 'US-NY', 'US-FL', 'BB', 'GB', 'CA']),
    nextReviewAt: z.string().datetime(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.amlRiskRating === 'high' && !value.seniorApproval) {
      ctx.addIssue({
        code: 'custom',
        path: ['seniorApproval'],
        message: 'high-risk clients require senior approval',
      });
    }
  });
export type PartnerKycReviewInput = z.infer<typeof partnerKycReviewSchema>;
export type KycDocumentInput = z.infer<typeof kycDocumentSchema>;
