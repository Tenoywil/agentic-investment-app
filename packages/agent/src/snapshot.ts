import type { RiskBand, RiskRating } from '@ccn/domain';
import type { EngineLimits } from '@ccn/limits-engine';
import type { Currency } from '@ccn/money';

/**
 * A point-in-time snapshot of everything the agent's read/propose tools need,
 * loaded once at the start of a request. The agent reads from this snapshot —
 * never live, never a held transaction — so the tools are pure and the LLM stream
 * doesn't hold a DB connection open. All amounts are minor units in `currency`.
 */

export interface SnapshotInstrument {
  id: string;
  slug: string;
  abbr: string;
  type: string;
  name: string;
  region: string | null;
  risk: RiskRating;
  metricLabel: string | null;
  metric: string | null;
  minInvestmentMinor: bigint;
  currency: Currency;
  blocked: boolean;
  blockReasons: string[];
  partnerName: string | null;
  regulator: string | null;
}

export interface SnapshotPosition {
  instrumentId: string;
  valueMinor: bigint;
}

export interface SnapshotPortfolio {
  currency: Currency;
  netWorthMinor: bigint;
  cashMinor: bigint;
  spentTodayMinor: bigint;
  positions: SnapshotPosition[];
  holdings: { name: string; valueMinor: bigint; partner: string | null }[];
}

/**
 * One of the caller's own orders, with what has actually happened to it.
 *
 * The agent could research and propose and then went silent at exactly the
 * moment a person starts asking questions — "where is my order?", "has the
 * firm accepted me?", "what's waiting on me?" are the three things an investor
 * wants to know after acting, and the agent had no tool that could answer any
 * of them.
 */
export interface SnapshotOrder {
  id: string;
  instrumentName: string | null;
  partnerName: string | null;
  status: 'created' | 'accepted' | 'settled' | 'rejected' | 'expired';
  amountMinor: bigint;
  currency: Currency;
  createdAt: string;
  /** The date the firm committed to on acceptance, if it gave one. */
  settlementEta: string | null;
  settledAt: string | null;
  /** What the firm reported at settlement. Null = not reported, never zero. */
  unitPriceMinor: bigint | null;
  units: string | null;
  feeMinor: bigint | null;
  rejectedReason: string | null;
}

export interface SnapshotApproval {
  id: string;
  title: string;
  /** What the card proposes buying — the machine-checkable half the agent
   *  needs to avoid re-proposing something already waiting. Null for cards
   *  that aren't about an instrument (fund transfers, plan enrollments). */
  instrumentId: string | null;
  amountMinor: bigint | null;
  currency: Currency;
  createdAt: string;
}

/** A goal as the agent sees it: what it's for, how funded, and by when. */
export interface SnapshotGoal {
  name: string;
  targetMinor: bigint;
  currentMinor: bigint;
  /** Free-text ETA label, e.g. "On track · mid-2028". */
  eta: string | null;
}

export interface SnapshotConnection {
  partner: string;
  status: 'pending' | 'active' | 'declined';
  declineReason: string | null;
  requestedAt: string;
}

export interface SnapshotActivity {
  orders: SnapshotOrder[];
  approvals: SnapshotApproval[];
  connections: SnapshotConnection[];
}

export interface AgentSnapshot {
  portfolio: SnapshotPortfolio;
  limits: EngineLimits;
  band: RiskBand;
  instruments: SnapshotInstrument[];
  activity: SnapshotActivity;
  /** The person's goals — what the money is for. Read by the fit agent
   *  (liquidity vs. a dated goal) and the goals view. */
  goals: SnapshotGoal[];
  /**
   * Instruments the agent must not re-propose: anything with a pending
   * approval, plus approvals and orders inside the quiet window. The same
   * discipline the background sweep applies, so the chat's pipeline cannot
   * recreate a deal that already exists.
   */
  quietInstrumentIds: string[];
}
