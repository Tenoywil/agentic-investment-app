import type { Transaction } from '@ccn/db';
import {
  holdings,
  instruments,
  limits as limitsTable,
  orders,
  partners,
  riskProfiles,
} from '@ccn/db';
import type { RiskBand, RiskRating } from '@ccn/domain';
import {
  type EngineInput,
  type EngineLimits,
  type LimitsDecision,
  evaluate,
} from '@ccn/limits-engine';
import type { Currency } from '@ccn/money';
import { and, eq, isNull, sql } from 'drizzle-orm';

/**
 * Assemble the Limits Engine's input from the caller's live data and evaluate a
 * proposed investment. This is the seam between the database and the pure
 * guardrail engine — every proposal passes through here before it can reach the
 * `create_order` choke point. Runs inside the caller's RLS transaction, so every
 * read is already tenant-scoped.
 */

export interface LoadedInstrument {
  id: string;
  partnerId: string | null;
  /** The partner's own identifier for this instrument, sent when routing. */
  slug: string;
  /** The executing firm's code, for resolving its adapter. */
  partnerCode: string | null;
  risk: RiskRating;
  blocked: boolean;
  blockReasons: string[];
  minInvestmentMinor: bigint;
  currency: Currency;
  /**
   * Whether the listing firm still offers it. Distinct from `blocked`: blocked
   * is about this investor's suitability and comes back with reasons, paused is
   * the firm having taken the product off the shelf for everyone.
   */
  listingStatus: 'live' | 'paused';
}

/** Fetch the instrument a proposal targets, or null if it does not exist. */
export async function loadInstrument(
  tx: Transaction,
  instrumentId: string,
): Promise<LoadedInstrument | null> {
  const [row] = await tx
    .select({
      id: instruments.id,
      partnerId: instruments.partnerId,
      slug: instruments.slug,
      partnerCode: partners.code,
      risk: instruments.risk,
      blocked: instruments.blocked,
      blockReasons: instruments.blockReasons,
      minInvestmentMinor: instruments.minInvestmentMinor,
      currency: instruments.currency,
      listingStatus: instruments.listingStatus,
    })
    .from(instruments)
    .leftJoin(partners, eq(partners.id, instruments.partnerId))
    .where(eq(instruments.id, instrumentId));
  if (!row) return null;
  return {
    id: row.id,
    partnerId: row.partnerId,
    slug: row.slug,
    partnerCode: row.partnerCode,
    risk: (row.risk ?? 'medium') as RiskRating,
    blocked: row.blocked,
    blockReasons: row.blockReasons,
    minInvestmentMinor: row.minInvestmentMinor,
    currency: row.currency as Currency,
    listingStatus: row.listingStatus,
  };
}

/** Default guardrail policy (mirrors the `limits` column defaults) when a user
 *  has no row yet. */
const DEFAULT_LIMITS: EngineLimits = {
  autoInvestCapMinor: 50_000n,
  autoInvestEnabled: true,
  cashFloorMinor: 100_000n,
  cashFloorEnabled: true,
  fxSpreadMaxBps: 30,
  fxSpreadEnabled: true,
  requireApprovalAboveMinor: 100_000n,
  requireApprovalEnabled: true,
  singlePositionMaxPct: 15,
  singlePositionEnabled: true,
  dailyCapMinor: null,
  dailyCapEnabled: false,
};

export async function loadLimits(tx: Transaction, userId: string): Promise<EngineLimits> {
  const [row] = await tx.select().from(limitsTable).where(eq(limitsTable.userId, userId));
  if (!row) return DEFAULT_LIMITS;
  return {
    autoInvestCapMinor: row.autoInvestCapMinor,
    autoInvestEnabled: row.autoInvestEnabled,
    cashFloorMinor: row.cashFloorMinor,
    cashFloorEnabled: row.cashFloorEnabled,
    fxSpreadMaxBps: row.fxSpreadMaxBps,
    fxSpreadEnabled: row.fxSpreadEnabled,
    requireApprovalAboveMinor: row.requireApprovalAboveMinor,
    requireApprovalEnabled: row.requireApprovalEnabled,
    singlePositionMaxPct: row.singlePositionMaxPct,
    singlePositionEnabled: row.singlePositionEnabled,
    dailyCapMinor: row.dailyCapMinor,
    dailyCapEnabled: row.dailyCapEnabled,
  };
}

/** Suitability band; a balanced-income default when onboarding hasn't run. */
export async function loadBand(tx: Transaction, userId: string): Promise<RiskBand> {
  const [row] = await tx
    .select({ band: riskProfiles.band })
    .from(riskProfiles)
    .where(eq(riskProfiles.userId, userId))
    .orderBy(sql`${riskProfiles.createdAt} desc`)
    .limit(1);
  return (row?.band ?? 'high_moderate') as RiskBand;
}

/** Snapshot of the caller's position for the engine (all in the base currency). */
export async function loadSnapshot(tx: Transaction, userId: string, instrumentId: string) {
  const [totalRow] = await tx
    .select({ v: sql<string>`coalesce(sum(${holdings.valueMinor}), 0)::text` })
    .from(holdings)
    .where(eq(holdings.userId, userId));
  // Cash = holdings not tied to an instrument (chequing/savings/wallet).
  const [cashRow] = await tx
    .select({ v: sql<string>`coalesce(sum(${holdings.valueMinor}), 0)::text` })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), isNull(holdings.instrumentId)));
  const [positionRow] = await tx
    .select({ v: sql<string>`coalesce(sum(${holdings.valueMinor}), 0)::text` })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.instrumentId, instrumentId)));
  const [spentRow] = await tx
    .select({ v: sql<string>`coalesce(sum(${orders.amountMinor}), 0)::text` })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        sql`${orders.status} <> 'rejected'`,
        sql`${orders.createdAt} >= date_trunc('day', now())`,
      ),
    );
  return {
    portfolioTotalMinor: BigInt(totalRow?.v ?? '0'),
    cashMinor: BigInt(cashRow?.v ?? '0'),
    currentPositionMinor: BigInt(positionRow?.v ?? '0'),
    spentTodayMinor: BigInt(spentRow?.v ?? '0'),
  };
}

export interface GateInput {
  userId: string;
  instrument: LoadedInstrument;
  amountMinor: bigint;
  currency: Currency;
  isFxTransfer?: boolean;
  fxSpreadBps?: number;
}

/** Load the caller's limits, band, and snapshot, then run the pure engine. */
export async function runGate(tx: Transaction, input: GateInput): Promise<LimitsDecision> {
  const [limits, band, snapshot] = await Promise.all([
    loadLimits(tx, input.userId),
    loadBand(tx, input.userId),
    loadSnapshot(tx, input.userId, input.instrument.id),
  ]);
  const engineInput: EngineInput = {
    proposal: {
      amountMinor: input.amountMinor,
      currency: input.currency,
      instrument: {
        risk: input.instrument.risk,
        minInvestmentMinor: input.instrument.minInvestmentMinor,
        blocked: input.instrument.blocked,
        blockReasons: input.instrument.blockReasons,
      },
      isFxTransfer: input.isFxTransfer ?? false,
      fxSpreadBps: input.fxSpreadBps ?? 0,
    },
    limits,
    portfolio: snapshot,
    band,
  };
  return evaluate(engineInput);
}
