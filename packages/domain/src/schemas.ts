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
  residencyCountry: z.string().min(1).max(100),
  occupation: z.string().min(1).max(150),
});
export type OnboardingIdentityInput = z.infer<typeof onboardingIdentitySchema>;

/** POST /api/onboarding/compliance — the three prototype declarations, all required. */
export const onboardingComplianceSchema = z.object({
  notPoliticallyExposed: z.literal(true),
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
