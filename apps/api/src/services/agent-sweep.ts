import { withRls } from '@ccn/db';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  holdings,
  instruments,
  orders,
  partners,
  riskProfiles,
  userRoles,
} from '@ccn/db';
import { SYMBOL } from '@ccn/money';
import type { Currency } from '@ccn/money';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../context';
import { auditAppend } from '../db-fns';
import { loadInstrument, loadLimits, runGate } from './gate';

/**
 * The background half of the agent — the part the product has always claimed.
 *
 * Every screen says the agent "discovers, screens and coordinates execution",
 * and until this existed all three only happened when a person typed at the
 * chat. Nothing watched the marketplace for them; a product listed an hour
 * after their last visit was a product their agent never saw. The claim was a
 * description of the chat, not of an agent.
 *
 * The sweep closes that gap without widening what the agent may do:
 *
 *  - It NEVER moves money. Even a candidate the Limits Engine would auto-act
 *    on is raised as an approval card — auto-act exists for moves the person
 *    initiated, and a background process spending someone's cash unasked is
 *    the surprise this product is built to never spring.
 *  - Every candidate passes the SAME gate as the chat and the order path:
 *    the person's own limits, risk band, cash floor and position caps decide
 *    what is proposable, not a heuristic of this file's own.
 *  - It is quiet by design: at most one proposal per person per sweep,
 *    nothing while one is already waiting, and an instrument it has proposed
 *    (or the person has recently traded) is not proposed again for two weeks.
 *
 * RLS is kept honest: people are enumerated under an admin-scoped context
 * (the same read the administration console is allowed), and each person's
 * own work — reads, the approval, the message — runs inside THEIR tenant
 * context, so the sweep can never write across tenants any more than a
 * request could. The approvals INSERT fires the existing notify trigger, so
 * an open home or agent screen shows the card the moment it exists.
 */

/** How long a proposed or traded instrument stays off the table. */
const QUIET_DAYS = 14;

/** Candidates considered per person per sweep, before the gate. */
const CANDIDATES_PER_USER = 12;

interface SweepResult {
  scanned: number;
  proposed: number;
}

function fmtMinor(minor: bigint, currency: string): string {
  const symbol = SYMBOL[currency as Currency] ?? `${currency} `;
  return `${symbol}${(Number(minor) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const RISK_WORD: Record<string, string> = { low: 'low', medium: 'medium', high: 'high' };

export async function runAgentSweep(
  deps: Pick<AppDeps, 'db' | 'config' | 'logger'>,
): Promise<SweepResult> {
  const dbRole = deps.config.DB_APP_ROLE;

  // Who the agent works for: customers with an active account somewhere (there
  // is recorded money to invest from) and a risk profile (a band to screen
  // against). Enumerated under the admin read the console already has.
  const investors = await withRls(deps.db, { appRole: 'admin', dbRole }, async (tx) => {
    const rows = await tx
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(
        connectedAccounts,
        and(eq(connectedAccounts.userId, userRoles.userId), eq(connectedAccounts.status, 'active')),
      )
      .innerJoin(riskProfiles, eq(riskProfiles.userId, userRoles.userId))
      .where(eq(userRoles.role, 'customer'));
    return rows.map((r) => r.userId);
  });

  let proposed = 0;
  for (const userId of investors) {
    try {
      if (await sweepOne(deps, userId, dbRole)) proposed += 1;
    } catch (error) {
      // One person's failure must not cost everyone else their sweep.
      deps.logger.error('agent sweep failed for a user', { userId, error });
    }
  }

  if (proposed > 0) {
    deps.logger.info('agent sweep proposed investments', {
      scanned: investors.length,
      proposed,
    });
  }
  return { scanned: investors.length, proposed };
}

/** One person's sweep, entirely inside their own tenant context. */
async function sweepOne(
  deps: Pick<AppDeps, 'db' | 'config' | 'logger'>,
  userId: string,
  dbRole: string,
): Promise<boolean> {
  return withRls(deps.db, { userId, appRole: 'customer', dbRole }, async (tx) => {
    // Nothing while something already waits: a queue the agent keeps topping
    // up stops being a queue the person reads.
    const [pending] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), eq(approvals.status, 'pending')))
      .limit(1);
    if (pending) return false;

    const quietSince = new Date(Date.now() - QUIET_DAYS * 86_400_000);
    const [recentApprovals, recentOrders, activeAccounts] = await Promise.all([
      tx
        .select({ instrumentId: approvals.instrumentId })
        .from(approvals)
        .where(and(eq(approvals.userId, userId), gte(approvals.createdAt, quietSince))),
      tx
        .select({ instrumentId: orders.instrumentId })
        .from(orders)
        .where(and(eq(orders.userId, userId), gte(orders.createdAt, quietSince))),
      tx
        .select({ partnerId: connectedAccounts.partnerId })
        .from(connectedAccounts)
        .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.status, 'active'))),
    ]);
    const excluded = new Set(
      [...recentApprovals, ...recentOrders].map((r) => r.instrumentId).filter(Boolean),
    );
    const partnerIds = activeAccounts.map((a) => a.partnerId);
    if (partnerIds.length === 0) return false;

    // Cash on record: without it there is nothing to propose spending. The
    // gate re-checks this properly (floor, caps); this is just "is there any
    // point looking".
    const [cashRow] = await tx
      .select({ v: sql<string>`coalesce(sum(${holdings.valueMinor}), 0)::text` })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), isNull(holdings.instrumentId)));
    if (BigInt(cashRow?.v ?? '0') <= 0n) return false;

    /**
     * Candidates: live, unblocked, with a real minimum, at a firm the person
     * actually holds an account with — the agent proposes what the person
     * could genuinely act on, not the whole catalogue. Lowest-risk first,
     * then smallest minimum: the background agent leads with the gentlest
     * viable idea and lets the person ask for more.
     */
    const candidates = await tx
      .select({ id: instruments.id })
      .from(instruments)
      .where(
        and(
          eq(instruments.listingStatus, 'live'),
          eq(instruments.blocked, false),
          inArray(instruments.partnerId, partnerIds),
          sql`${instruments.minInvestmentMinor} > 0`,
        ),
      )
      .orderBy(
        sql`case ${instruments.risk} when 'low' then 0 when 'medium' then 1 else 2 end`,
        instruments.minInvestmentMinor,
      )
      .limit(CANDIDATES_PER_USER);

    for (const c of candidates) {
      if (excluded.has(c.id)) continue;
      const instrument = await loadInstrument(tx, c.id, deps.logger);
      if (!instrument || instrument.listingStatus !== 'live' || instrument.blocked) continue;

      const amountMinor = instrument.minInvestmentMinor;
      const decision = await runGate(tx, {
        userId,
        instrument,
        amountMinor,
        currency: instrument.currency,
      });
      // Blocked candidates are simply not for this person. Both passing
      // decisions become an approval — the background agent asks, always.
      if (decision.decision === 'blocked') continue;

      const [detail] = await tx
        .select({ name: instruments.name, risk: instruments.risk, partner: partners.name })
        .from(instruments)
        .leftJoin(partners, eq(partners.id, instruments.partnerId))
        .where(eq(instruments.id, c.id));
      const name = detail?.name ?? 'A listed product';
      const amount = fmtMinor(amountMinor, instrument.currency);
      const limits = await loadLimits(tx, userId);

      const body = [
        `Found by your agent while scanning the marketplace against your limits: ${name}`,
        detail?.partner ? ` at ${detail.partner}` : '',
        detail?.risk ? `, ${RISK_WORD[detail.risk] ?? detail.risk} risk` : '',
        `. The minimum is ${amount}, from your cash`,
        limits.cashFloorEnabled
          ? `, and it clears your ${fmtMinor(limits.cashFloorMinor, instrument.currency)} cash floor`
          : '',
        '. Nothing happens unless you approve.',
      ].join('');

      const [card] = await tx
        .insert(approvals)
        .values({
          userId,
          type: 'investment_rec',
          instrumentId: c.id,
          title: `${name} · ${amount}`,
          body,
          amountMinor,
          currency: instrument.currency as Currency,
          snapshot: {
            source: 'background_sweep',
            decision: decision.decision,
            code: decision.code,
          },
        })
        .returning({ id: approvals.id });

      // The finding, in the person's own conversation — so opening the agent
      // shows what it did while they were away, in its own words.
      await tx.insert(agentMessages).values({
        userId,
        role: 'agent',
        content: `While you were away I scanned the marketplace against your limits and found ${name}${detail?.partner ? ` at ${detail.partner}` : ''}. I've put it in your approvals — ${amount} minimum, and it stays there until you decide.`,
      });

      await auditAppend(tx, {
        actorType: 'agent',
        actorId: null,
        userId,
        partnerId: instrument.partnerId,
        action: 'agent.proposed',
        entityType: 'approval',
        entityId: card?.id ?? null,
        detail: {
          instrument: name,
          amount_minor: amountMinor.toString(),
          currency: instrument.currency,
          decision: decision.decision,
        },
      });
      return true;
    }
    return false;
  });
}

/**
 * The scheduler. Started from the composition root only — never from
 * createApp, so tests and one-off scripts get no timers they did not ask for.
 * Runs are serialized: a slow sweep skips the next tick rather than stacking.
 */
export function startAgentSweep(deps: Pick<AppDeps, 'db' | 'config' | 'logger'>): () => void {
  const interval = deps.config.AGENT_SWEEP_INTERVAL_MS;
  if (interval <= 0) {
    deps.logger.info('agent background sweep disabled (AGENT_SWEEP_INTERVAL_MS=0)');
    return () => {};
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAgentSweep(deps);
    } catch (error) {
      deps.logger.error('agent sweep run failed', { error });
    } finally {
      running = false;
    }
  };

  // First pass shortly after boot, so a restarted API catches up without
  // waiting a full interval; then steadily.
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, interval);
  deps.logger.info('agent background sweep started', { intervalMs: interval });
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
