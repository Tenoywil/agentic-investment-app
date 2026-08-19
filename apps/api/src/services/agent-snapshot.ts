import type { AgentSnapshot, SnapshotActivity, SnapshotInstrument } from '@ccn/agent';
import type { Transaction } from '@ccn/db';
import {
  approvals,
  connectedAccounts,
  goals,
  holdings,
  instruments,
  kycStatus,
  orders,
  partners,
} from '@ccn/db';
import type { RiskRating } from '@ccn/domain';
import type { Currency } from '@ccn/money';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { isDatabaseBehind } from '../migrations';
import { loadBand, loadLimits } from './gate';

/**
 * Load the agent's read-only snapshot for a user: portfolio, limits, suitability
 * band, and the marketplace. Read once at the start of a chat turn so the agent's
 * tools are pure and the LLM stream never holds a DB transaction open. Runs inside
 * the caller's RLS scope; reference tables (instruments/partners) are world-read.
 */
export async function loadAgentSnapshot(tx: Transaction, userId: string): Promise<AgentSnapshot> {
  const [limits, band, kycRows] = await Promise.all([
    loadLimits(tx, userId),
    loadBand(tx, userId),
    tx.select().from(kycStatus).where(eq(kycStatus.userId, userId)).limit(1),
  ]);
  const kyc = kycRows[0];

  const holdingRows = await tx
    .select({
      instrumentId: holdings.instrumentId,
      name: holdings.name,
      valueMinor: holdings.valueMinor,
      partnerName: partners.name,
    })
    .from(holdings)
    .leftJoin(connectedAccounts, eq(holdings.connectedAccountId, connectedAccounts.id))
    .leftJoin(partners, eq(connectedAccounts.partnerId, partners.id))
    .where(eq(holdings.userId, userId));

  let netWorthMinor = 0n;
  let cashMinor = 0n;
  const positionsMap = new Map<string, bigint>();
  const holdingsList: AgentSnapshot['portfolio']['holdings'] = [];
  for (const h of holdingRows) {
    netWorthMinor += h.valueMinor;
    if (h.instrumentId === null) {
      cashMinor += h.valueMinor;
    } else {
      positionsMap.set(h.instrumentId, (positionsMap.get(h.instrumentId) ?? 0n) + h.valueMinor);
    }
    holdingsList.push({ name: h.name, valueMinor: h.valueMinor, partner: h.partnerName });
  }

  const [spentRow] = await tx
    .select({ v: sql<string>`coalesce(sum(${orders.amountMinor}), 0)::text` })
    .from(orders)
    .where(
      sql`${orders.userId} = ${userId} and ${orders.status} <> 'rejected' and ${orders.createdAt} >= date_trunc('day', now())`,
    );

  const instrumentColumns = {
    id: instruments.id,
    partnerId: instruments.partnerId,
    slug: instruments.slug,
    abbr: instruments.abbr,
    type: instruments.type,
    name: instruments.name,
    region: instruments.region,
    risk: instruments.risk,
    metricLabel: instruments.metricLabel,
    metric: instruments.metric,
    minInvestmentMinor: instruments.minInvestmentMinor,
    currency: instruments.currency,
    blocked: instruments.blocked,
    blockReasons: instruments.blockReasons,
    partnerName: partners.name,
    regulator: instruments.regulator,
  };
  /**
   * Live listings only. The marketplace and both order paths already refuse a
   * paused instrument, and the agent read the one unfiltered copy of the
   * catalogue — so it would go on recommending a product the firm had
   * withdrawn, and the person following the recommendation met a refusal the
   * agent itself had set up. On a database without 0017 the filter falls back
   * to the unfiltered read, which was the truth before pausing existed.
   */
  const instrumentRows = await tx
    .transaction((sp) =>
      sp
        .select(instrumentColumns)
        .from(instruments)
        .leftJoin(partners, eq(instruments.partnerId, partners.id))
        .where(eq(instruments.listingStatus, 'live')),
    )
    .catch((err: unknown) => {
      if (!isDatabaseBehind(err)) throw err;
      return tx
        .select(instrumentColumns)
        .from(instruments)
        .leftJoin(partners, eq(instruments.partnerId, partners.id));
    });

  const instrumentList: SnapshotInstrument[] = instrumentRows.map((i) => ({
    id: i.id,
    partnerId: i.partnerId,
    slug: i.slug,
    abbr: i.abbr,
    type: i.type,
    name: i.name,
    region: i.region,
    risk: (i.risk ?? 'medium') as RiskRating,
    metricLabel: i.metricLabel,
    metric: i.metric,
    minInvestmentMinor: i.minInvestmentMinor,
    currency: i.currency as Currency,
    blocked: i.blocked,
    blockReasons: i.blockReasons,
    partnerName: i.partnerName,
    regulator: i.regulator,
  }));

  /**
   * The caller's own activity: their orders, what awaits their approval, and
   * where each connection stands. This is what lets the agent answer the three
   * questions people actually ask after acting — where is my order, has the
   * firm accepted me, what is waiting on me — instead of going quiet at the
   * exact moment of worry.
   */
  const orderRows = await tx
    .select({
      id: orders.id,
      instrumentName: instruments.name,
      partnerName: partners.name,
      status: orders.status,
      amountMinor: orders.amountMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
      settlementEta: orders.settlementEta,
      settledAt: orders.settledAt,
      unitPriceMinor: orders.unitPriceMinor,
      units: orders.units,
      feeMinor: orders.feeMinor,
      rejectedReason: orders.rejectedReason,
    })
    .from(orders)
    .leftJoin(instruments, eq(instruments.id, orders.instrumentId))
    .leftJoin(partners, eq(partners.id, orders.partnerId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(20);

  const approvalRows = await tx
    .select({
      id: approvals.id,
      title: approvals.title,
      instrumentId: approvals.instrumentId,
      amountMinor: approvals.amountMinor,
      currency: approvals.currency,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(and(eq(approvals.userId, userId), eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.createdAt))
    .limit(10);

  /**
   * The quiet set, computed the same way the background sweep computes its
   * own: anything with a pending card plus approvals and orders inside the
   * 14-day window. Handed to the chat pipeline so a conversation cannot
   * recreate a deal that already exists.
   */
  const quietSince = new Date(Date.now() - 14 * 86_400_000);
  const [quietApprovals, quietOrders] = await Promise.all([
    tx
      .select({ instrumentId: approvals.instrumentId })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), gte(approvals.createdAt, quietSince))),
    tx
      .select({ instrumentId: orders.instrumentId })
      .from(orders)
      .where(and(eq(orders.userId, userId), gte(orders.createdAt, quietSince))),
  ]);
  const quietInstrumentIds = [
    ...new Set(
      [
        ...approvalRows.map((a) => a.instrumentId),
        ...quietApprovals.map((r) => r.instrumentId),
        ...quietOrders.map((r) => r.instrumentId),
      ].filter((id): id is string => id !== null),
    ),
  ];

  const goalRows = await tx
    .select({
      name: goals.name,
      targetMinor: goals.targetMinor,
      currentMinor: goals.currentMinor,
      eta: goals.eta,
    })
    .from(goals)
    .where(eq(goals.userId, userId));

  const connectionRows = await tx
    .select({
      partnerId: connectedAccounts.partnerId,
      partner: partners.name,
      status: connectedAccounts.status,
      declineReason: connectedAccounts.declineReason,
      requestedAt: connectedAccounts.createdAt,
    })
    .from(connectedAccounts)
    .innerJoin(partners, eq(partners.id, connectedAccounts.partnerId))
    .where(eq(connectedAccounts.userId, userId));

  const activity: SnapshotActivity = {
    orders: orderRows.map((o) => ({
      id: o.id,
      instrumentName: o.instrumentName,
      partnerName: o.partnerName,
      status: o.status,
      amountMinor: o.amountMinor,
      currency: o.currency as Currency,
      createdAt: o.createdAt.toISOString(),
      settlementEta: o.settlementEta?.toISOString() ?? null,
      settledAt: o.settledAt?.toISOString() ?? null,
      unitPriceMinor: o.unitPriceMinor,
      units: o.units,
      feeMinor: o.feeMinor,
      rejectedReason: o.rejectedReason,
    })),
    approvals: approvalRows.map((a) => ({
      id: a.id,
      title: a.title,
      instrumentId: a.instrumentId,
      amountMinor: a.amountMinor,
      currency: a.currency as Currency,
      createdAt: a.createdAt.toISOString(),
    })),
    connections: connectionRows.map((cn) => ({
      partnerId: cn.partnerId,
      partner: cn.partner,
      status: cn.status,
      declineReason: cn.declineReason,
      requestedAt: cn.requestedAt.toISOString(),
    })),
  };

  return {
    activity,
    compliance: {
      identityVerified: kyc?.identityVerified ?? false,
      complianceConfirmed: kyc?.complianceConfirmed ?? false,
      riskCompleted: kyc?.riskCompleted ?? false,
      fundsConfirmed: kyc?.fundsConfirmed ?? false,
    },
    portfolio: {
      currency: 'USD',
      netWorthMinor,
      cashMinor,
      spentTodayMinor: BigInt(spentRow?.v ?? '0'),
      positions: [...positionsMap.entries()].map(([instrumentId, valueMinor]) => ({
        instrumentId,
        valueMinor,
      })),
      holdings: holdingsList,
    },
    limits,
    band,
    instruments: instrumentList,
    goals: goalRows,
    quietInstrumentIds,
  };
}
