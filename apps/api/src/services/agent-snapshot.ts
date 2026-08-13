import type { AgentSnapshot, SnapshotInstrument } from '@ccn/agent';
import type { Transaction } from '@ccn/db';
import { connectedAccounts, holdings, instruments, orders, partners } from '@ccn/db';
import type { RiskRating } from '@ccn/domain';
import type { Currency } from '@ccn/money';
import { eq, sql } from 'drizzle-orm';
import { loadBand, loadLimits } from './gate';

/**
 * Load the agent's read-only snapshot for a user: portfolio, limits, suitability
 * band, and the marketplace. Read once at the start of a chat turn so the agent's
 * tools are pure and the LLM stream never holds a DB transaction open. Runs inside
 * the caller's RLS scope; reference tables (instruments/partners) are world-read.
 */
export async function loadAgentSnapshot(tx: Transaction, userId: string): Promise<AgentSnapshot> {
  const [limits, band] = await Promise.all([loadLimits(tx, userId), loadBand(tx, userId)]);

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

  const instrumentRows = await tx
    .select({
      id: instruments.id,
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
    })
    .from(instruments)
    .leftJoin(partners, eq(instruments.partnerId, partners.id));

  const instrumentList: SnapshotInstrument[] = instrumentRows.map((i) => ({
    id: i.id,
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

  return {
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
  };
}
