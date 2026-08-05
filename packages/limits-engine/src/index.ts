/**
 * @ccn/limits-engine — the deterministic guardrail evaluator. THE single gate
 * every proposed money movement passes before it can become an order.
 *
 * Pure: input in, decision out, no I/O and no side effects. The API calls this
 * before the `create_order` choke point; only an `auto_act` decision (fully in
 * limits) or a human-approved card may reach that function. The model proposes;
 * this module — not the model — decides, so a compromised or hallucinating agent
 * still cannot move money outside the rules.
 *
 * Encodes 03-agent-workflow.mmd and the prototype's rulesData + 15% cap +
 * FX-spread guard. Checks run in a fixed order; the first decisive one wins.
 */

import { type RiskBand, type RiskRating, fitsSuitability } from '@ccn/domain';
import { type Currency, atMostPercent, formatMoney, money } from '@ccn/money';

export interface EngineInstrument {
  risk: RiskRating;
  /** Minimum ticket the partner will accept, in minor units. */
  minInvestmentMinor: bigint;
  /** Hard screen-out flag; when true the curated `blockReasons` are returned. */
  blocked: boolean;
  blockReasons: readonly string[];
}

/** The user's guardrail policy — mirrors the `limits` table one-for-one. */
export interface EngineLimits {
  autoInvestCapMinor: bigint;
  autoInvestEnabled: boolean;
  cashFloorMinor: bigint;
  cashFloorEnabled: boolean;
  fxSpreadMaxBps: number;
  fxSpreadEnabled: boolean;
  requireApprovalAboveMinor: bigint;
  requireApprovalEnabled: boolean;
  singlePositionMaxPct: number;
  singlePositionEnabled: boolean;
  dailyCapMinor: bigint | null;
  dailyCapEnabled: boolean;
}

/** A snapshot of the user's position, all in the proposal currency (minor units). */
export interface EnginePortfolio {
  /** Investable cash available now. */
  cashMinor: bigint;
  /** Total portfolio value (net worth). */
  portfolioTotalMinor: bigint;
  /** Existing holding value in the proposal's instrument (0 if none). */
  currentPositionMinor: bigint;
  /** Value of orders already created today (for the daily cap). */
  spentTodayMinor: bigint;
}

export interface EngineProposal {
  amountMinor: bigint;
  currency: Currency;
  instrument: EngineInstrument;
  /** True when the move crosses currencies (subject to the FX-spread guard). */
  isFxTransfer: boolean;
  /** Computed spread for this proposal in basis points (0 when not an FX move). */
  fxSpreadBps: number;
}

export interface EngineInput {
  proposal: EngineProposal;
  limits: EngineLimits;
  portfolio: EnginePortfolio;
  band: RiskBand;
}

export type LimitsDecisionCode =
  | 'in_limit'
  | 'above_auto_invest'
  | 'above_approval_threshold'
  | 'fx_spread_review'
  | 'instrument_blocked'
  | 'below_minimum'
  | 'unsuitable'
  | 'cash_floor'
  | 'single_position'
  | 'daily_cap';

/**
 * The verdict:
 * - `auto_act`     — fully in limits; the agent may execute without asking.
 * - `requires_approval` — creates a "Needs your approval" card; a human tap
 *                    (or the exec-modal authorize) then reaches `create_order`.
 * - `blocked`      — cannot proceed at all; `reasons` explains why.
 */
export type LimitsDecision =
  | { decision: 'auto_act'; code: 'in_limit' }
  | { decision: 'requires_approval'; code: LimitsDecisionCode; reason: string }
  | { decision: 'blocked'; code: LimitsDecisionCode; reasons: string[] };

const blocked = (code: LimitsDecisionCode, reasons: string[]): LimitsDecision => ({
  decision: 'blocked',
  code,
  reasons,
});
const approve = (code: LimitsDecisionCode, reason: string): LimitsDecision => ({
  decision: 'requires_approval',
  code,
  reason,
});

/**
 * Evaluate a proposal against the user's limits. Checks run in this fixed order;
 * the first that decides the outcome wins:
 *
 *   1. instrument hard-blocked   → blocked (curated reasons)
 *   2. below instrument minimum  → blocked
 *   3. suitability band          → blocked
 *   4. cash floor                → blocked
 *   5. single-position cap       → blocked
 *   6. daily cap                 → blocked
 *   7. FX-spread over guardrail  → requires approval (held for review)
 *   8. above approval threshold  → requires approval
 *   9. within auto-invest cap    → auto-act; otherwise requires approval
 *
 * A disabled toggle skips its check.
 */
export function evaluate(input: EngineInput): LimitsDecision {
  const { proposal, limits, portfolio, band } = input;
  const { instrument, amountMinor, currency } = proposal;
  const fmt = (minor: bigint): string => formatMoney(money(minor, currency));

  // 1. Hard instrument block — the most specific, curated reason set.
  if (instrument.blocked) {
    return blocked('instrument_blocked', [...instrument.blockReasons]);
  }

  // 2. Below the partner's minimum ticket.
  if (amountMinor < instrument.minInvestmentMinor) {
    return blocked('below_minimum', [
      `Below the ${fmt(instrument.minInvestmentMinor)} minimum for this instrument`,
    ]);
  }

  // 3. Suitability band.
  if (!fitsSuitability(band, instrument.risk)) {
    return blocked('unsuitable', [
      `This ${instrument.risk}-risk instrument is outside your suitability band`,
    ]);
  }

  // 4. Cash floor — the move must leave at least the floor behind.
  if (limits.cashFloorEnabled && portfolio.cashMinor - amountMinor < limits.cashFloorMinor) {
    return blocked('cash_floor', [
      `Would draw your cash below the ${fmt(limits.cashFloorMinor)} floor you set`,
    ]);
  }

  // 5. Single-position cap — resulting position vs. portfolio after the new money.
  if (limits.singlePositionEnabled) {
    const resultingPosition = money(portfolio.currentPositionMinor + amountMinor, currency);
    const portfolioAfter = money(portfolio.portfolioTotalMinor + amountMinor, currency);
    if (!atMostPercent(resultingPosition, portfolioAfter, limits.singlePositionMaxPct)) {
      return blocked('single_position', [
        `Would put more than ${limits.singlePositionMaxPct}% of your portfolio in a single position`,
      ]);
    }
  }

  // 6. Daily cap.
  if (limits.dailyCapEnabled && limits.dailyCapMinor !== null) {
    if (portfolio.spentTodayMinor + amountMinor > limits.dailyCapMinor) {
      return blocked('daily_cap', [`Exceeds your ${fmt(limits.dailyCapMinor)} daily limit`]);
    }
  }

  // 7. FX-spread guardrail — held for review rather than hard-blocked.
  if (
    limits.fxSpreadEnabled &&
    proposal.isFxTransfer &&
    proposal.fxSpreadBps > limits.fxSpreadMaxBps
  ) {
    return approve(
      'fx_spread_review',
      `FX spread ${proposal.fxSpreadBps} bps is above your ${limits.fxSpreadMaxBps} bps guardrail — held for your review`,
    );
  }

  // 8. Above the require-approval threshold → always ask.
  if (limits.requireApprovalEnabled && amountMinor > limits.requireApprovalAboveMinor) {
    return approve(
      'above_approval_threshold',
      `Above your ${fmt(limits.requireApprovalAboveMinor)} require-approval threshold`,
    );
  }

  // 9. Within the auto-invest cap → the agent may act alone; else it asks.
  if (limits.autoInvestEnabled && amountMinor <= limits.autoInvestCapMinor) {
    return { decision: 'auto_act', code: 'in_limit' };
  }
  return approve(
    'above_auto_invest',
    `Above your ${fmt(limits.autoInvestCapMinor)} auto-invest limit`,
  );
}
