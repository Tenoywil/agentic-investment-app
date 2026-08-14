import { z } from 'zod';

/**
 * Zod schemas for API request boundaries (the customer app and partner console).
 * Everything crossing the wire is parsed here before it reaches a handler — an
 * invalid body never touches the database or the Limits Engine.
 */

export const currencySchema = z.enum(['USD', 'JMD', 'TTD']);

/**
 * Minor units off the wire: a non-negative integer sent as a JSON number or a
 * digit string (bigint has no JSON form), normalized to `bigint`. Rejects
 * floats, signs, and non-numeric strings.
 */
export const amountMinorSchema = z
  .union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/, 'must be a non-negative integer'),
  ])
  .transform((v) => BigInt(v));

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
export const listInstrumentSchema = z.object({
  /** Present to amend a listing, absent to create one. */
  id: uuidSchema.optional(),
  name: z.string().min(2).max(140),
  type: z.enum(['bond', 'fund', 'equity', 'real_estate', 'private']),
  /** The short badge on the card. Derived from the name when not given. */
  abbr: z.string().min(1).max(12).optional(),
  currency: currencySchema.default('USD'),
  /** Zero is allowed and means "no minimum", so this is not the positive variant. */
  minInvestmentMinor: amountMinorSchema.default(0),
  term: z.string().max(60).optional(),
  /** The headline number, e.g. "8.25%" — free text because a fund's is not a bond's. */
  metric: z.string().max(60).optional(),
  /** What that number is, e.g. "Coupon", "Target return". */
  metricLabel: z.string().max(60).optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  description: z.string().max(2000).optional(),
  region: z.string().max(100).optional(),
});
export type ListInstrumentInput = z.infer<typeof listInstrumentSchema>;

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
  residencyCountry: z.string().min(1).max(100),
  occupation: z.string().min(1).max(150),
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
  isPoliticallyExposed: z.boolean(),
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
});
export type OnboardingFundsInput = z.infer<typeof onboardingFundsSchema>;
