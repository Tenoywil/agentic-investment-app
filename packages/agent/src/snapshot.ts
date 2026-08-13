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

export interface AgentSnapshot {
  portfolio: SnapshotPortfolio;
  limits: EngineLimits;
  band: RiskBand;
  instruments: SnapshotInstrument[];
}
