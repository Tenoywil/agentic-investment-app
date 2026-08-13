import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { currency, riskRating } from './enums';
import { createdAt, moneyMinor, updatedAt } from './helpers';

/**
 * Gateway — private-deal origination/matching/introduction, additive to the
 * retail-execution schema in ./market.ts and ./activity.ts. Mirrors
 * `packages/domain/src/gateway.ts`'s state machines and
 * `packages/gateway-guardrail`'s decision vocabulary exactly; see that package
 * for why `allow`/`allow_with_disclosure` both land on `approved` here.
 */

export const gatewayOpportunityStatus = pgEnum('gateway_opportunity_status', [
  'submitted',
  'assessed',
  'pending_review',
  'approved',
  'rejected',
]);

export const gatewayIntroductionStatus = pgEnum('gateway_introduction_status', [
  'requested',
  'approved',
  'rejected',
  'completed',
]);

// Trust label on a piece of evidence for a claim — the doc's evidence/claim
// model, the genuine gap this addendum fills vs. the flat instruments.agentNote.
export const gatewayEvidenceStatus = pgEnum('gateway_evidence_status', [
  'verified',
  'partially_verified',
  'self_reported',
  'unverified',
  'contradicted',
]);

// Deal stage only — no meeting/doc-share/NDA tracking yet (explicitly deferred).
export const gatewayDealStage = pgEnum('gateway_deal_stage', [
  'intro',
  'dd',
  'term_sheet',
  'closed',
  'withdrawn',
]);

/**
 * An investor's standing mandate — what they're looking for. One row per
 * investor (like `limits`); `POST /gateway/mandate` upserts it after the
 * NL-extraction pass and the investor's confirmation. `riskAppetite`/
 * `liquidityNeed` reuse the existing low/medium/high `riskRating` enum — same
 * ordinal semantics as `packages/agent/src/gateway/matching.ts`'s `Ordinal`.
 */
export const investorMandates = pgTable('investor_mandates', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  narrative: text('narrative'), // the original free-text input, kept for context/audit
  countries: text('countries').array().notNull().default([]),
  sectors: text('sectors').array().notNull().default([]),
  minCheckMinor: moneyMinor('min_check_minor').notNull(),
  maxCheckMinor: moneyMinor('max_check_minor').notNull(),
  stagePreferences: text('stage_preferences').array().notNull().default([]),
  riskAppetite: riskRating('risk_appetite').notNull(),
  horizonYears: integer('horizon_years').notNull(),
  targetReturnPct: numeric('target_return_pct', { precision: 6, scale: 2 }).notNull(),
  liquidityNeed: riskRating('liquidity_need').notNull(),
  boardInvolvement: boolean('board_involvement').notNull().default(false),
  impactPreference: boolean('impact_preference').notNull().default(false),
  currency: currency('currency').notNull().default('USD'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A private-deal opportunity. `status` is the `packages/domain/src/gateway.ts`
 * state machine; `readinessScore`/`criticalMissingItems`/`disclosures` are set
 * by the readiness-assessment agent pass and consumed by `gateway-guardrail`.
 * `submittedBy` is nullable — provider self-service is deferred, so Thursday's
 * rows are submitted by an admin/analyst or the seed script.
 */
export const gatewayOpportunities = pgTable('gateway_opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  submittedBy: uuid('submitted_by').references(() => user.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  country: text('country').notNull(),
  sector: text('sector').notNull(),
  stage: text('stage').notNull(),
  investmentType: text('investment_type').notNull(),
  capitalSoughtMinor: moneyMinor('capital_sought_minor').notNull(),
  currency: currency('currency').notNull().default('USD'),
  valuationMinor: moneyMinor('valuation_minor'),
  useOfFunds: text('use_of_funds'),
  targetReturnPct: numeric('target_return_pct', { precision: 6, scale: 2 }).notNull(),
  horizonYears: integer('horizon_years').notNull(),
  riskRating: riskRating('risk_rating').notNull(),
  liquidity: riskRating('liquidity').notNull(),
  offersBoardSeat: boolean('offers_board_seat').notNull().default(false),
  hasImpactFocus: boolean('has_impact_focus').notNull().default(false),
  exitAssumptions: text('exit_assumptions'),
  summary: text('summary').notNull(),
  status: gatewayOpportunityStatus('status').notNull().default('submitted'),
  readinessScore: integer('readiness_score'), // 0-100; set by the readiness pass
  criticalMissingItems: text('critical_missing_items').array().notNull().default([]),
  disclosures: text('disclosures').array().notNull().default([]), // set on allow_with_disclosure
  guardrailCode: text('guardrail_code'), // last gateway-guardrail decision code, for the audit trail/UI
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * An atomic factual claim about an opportunity (e.g. "ARR is $500k/yr"),
 * extracted by the readiness pass. Evidence (below) carries the trust label;
 * the claim itself is just the assertion.
 */
export const gatewayClaims = pgTable('gateway_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => gatewayOpportunities.id, { onDelete: 'cascade' }),
  category: text('category'), // financial | legal | market | team | other
  label: text('label').notNull(),
  value: text('value').notNull(),
  createdAt: createdAt(),
});

/**
 * Evidence for a claim, carrying the trust label the doc's §15/§25 evidence
 * graph calls for — a relational table, not a graph DB. `contradicted` status
 * is what `gateway-guardrail` treats as an integrity block, never a mere score
 * penalty.
 */
export const gatewayEvidence = pgTable('gateway_evidence', {
  id: uuid('id').defaultRandom().primaryKey(),
  claimId: uuid('claim_id')
    .notNull()
    .references(() => gatewayClaims.id, { onDelete: 'cascade' }),
  status: gatewayEvidenceStatus('status').notNull().default('unverified'),
  source: text('source'), // e.g. "financial statement", "founder interview"
  detail: text('detail'),
  documentId: uuid('document_id').references(() => gatewayDocuments.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** Document metadata for an opportunity. Ingestion (OCR/vision) is deferred;
 *  this table exists so evidence can cite a document once that lands. */
export const gatewayDocuments = pgTable('gateway_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => gatewayOpportunities.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  storagePath: text('storage_path'),
  createdAt: createdAt(),
});

/**
 * A record of one agent pass (doc §20) — additive alongside `audit_log`, not a
 * replacement. `opportunityId` is set for opportunity-scoped passes
 * (readiness assessment, match narration); `userId` for the mandate-extraction
 * pass. `tier`/`model` are the tiered-gateway fields `packages/agent/src/
 * gateway/provider.ts` fills in.
 */
export const gatewayAgentRuns = pgTable('gateway_agent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id').references(() => gatewayOpportunities.id, {
    onDelete: 'cascade',
  }),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
  pass: text('pass').notNull(), // 'mandate_extraction' | 'readiness_assessment' | 'match_narration'
  tier: text('tier').notNull(), // 'high' | 'general' | 'low'
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull().default('v1'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output').notNull().default({}),
  confidence: numeric('confidence', { precision: 4, scale: 3 }), // 0..1
  toolCalls: integer('tool_calls').notNull().default(0),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  latencyMs: integer('latency_ms'),
  createdAt: createdAt(),
});

/**
 * A stored mandate↔opportunity match. Written by the deterministic
 * `packages/agent/src/gateway/matching.ts#score()` — `score`/`componentScores`
 * are arithmetic, never an LLM guess; `reasons`/`concerns` are the narration
 * pass explaining an already-computed number. One row per (user, opportunity).
 */
export const gatewayMatches = pgTable(
  'gateway_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => gatewayOpportunities.id, { onDelete: 'cascade' }),
    score: numeric('score', { precision: 5, scale: 4 }).notNull(), // 0..1
    componentScores: jsonb('component_scores').notNull().default({}),
    reasons: text('reasons').array().notNull().default([]),
    concerns: text('concerns').array().notNull().default([]),
    usedSemanticProxy: boolean('used_semantic_proxy').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('gateway_matches_user_opportunity_uq').on(t.userId, t.opportunityId)],
);

/**
 * An investor's request to be introduced to an opportunity — the human-gated
 * step between a match and a deal. `decidedBy` is the analyst who resolved it.
 */
export const gatewayIntroductionRequests = pgTable('gateway_introduction_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  matchId: uuid('match_id')
    .notNull()
    .references(() => gatewayMatches.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => gatewayOpportunities.id, { onDelete: 'cascade' }),
  status: gatewayIntroductionStatus('status').notNull().default('requested'),
  note: text('note'),
  decisionReason: text('decision_reason'),
  decidedBy: uuid('decided_by').references(() => user.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A deal record, created when an analyst approves an introduction request. */
export const gatewayDeals = pgTable('gateway_deals', {
  id: uuid('id').defaultRandom().primaryKey(),
  introductionRequestId: uuid('introduction_request_id')
    .notNull()
    .unique()
    .references(() => gatewayIntroductionRequests.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => gatewayOpportunities.id, { onDelete: 'cascade' }),
  stage: gatewayDealStage('stage').notNull().default('intro'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
