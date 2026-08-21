import {
  type FitPosition,
  type InstrumentFacts,
  type ResearchFn,
  type SizingChoice,
  assessPortfolioFit,
  assessTransactionCompliance,
  buildDiasporaComparison,
  runProposalPipeline,
} from '@ccn/agent';
import { withRls } from '@ccn/db';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  goals as goalsTable,
  holdings,
  instruments,
  kycStatus,
  orders,
  partners,
  riskProfiles,
  userProfiles,
  userRoles,
} from '@ccn/db';
import { SYMBOL } from '@ccn/money';
import type { Currency } from '@ccn/money';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { AppDeps } from '../context';
import { auditAppend } from '../db-fns';
import { loadBand, loadInstrument, loadLimits, runGate } from './gate';

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
 *  - It NEVER moves money. Even a candidate the Limits Engine classifies as
 *    auto-act is raised as an approval card — auto-act means within-limit, not
 *    execution authority, and every move still requires human confirmation.
 *  - Every candidate passes the SAME gate as the chat and the order path:
 *    the person's own limits, risk band, cash floor and position caps decide
 *    what is proposable, not a heuristic of this file's own.
 *  - It is quiet by design: at most one proposal per person per sweep,
 *    nothing while one is already waiting, an instrument it has proposed
 *    (or the person has recently traded) is not proposed again for two weeks
 *    — and a candidate that clears the limits but carries low conviction is
 *    passed over rather than proposed (the pipeline's proposal bar).
 *
 * The pipeline's other specialists are injected here the same way the gate
 * is: the per-asset RESEARCH pass arrives as `deps.research` (wired by the
 * composition root only when enabled — a shared, cached dossier per
 * instrument, so a sweep over N users researches each asset once, and a
 * failed pass degrades to no signal rather than fabricating one), and the
 * PORTFOLIO FIT assessor runs over the person's own holdings, currencies and
 * goals loaded below. Sizing may step above an instrument's minimum toward an
 * underfunded goal, bounded by the cash floor and position-cap headroom — and
 * any size above the minimum is re-gated by the pipeline before it is
 * proposed.
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

/**
 * How long the agent stays quiet after ANY card for this person was raised —
 * decided or not. Without it, deciding a card reopened the pending gate and
 * the next tick (≤10 minutes later) proposed something else, with another
 * near-identical "While you were away…" message; an afternoon of decisions
 * became an afternoon of cards. One proposal a day is a colleague; six an
 * hour is a fly.
 */
const PROPOSAL_COOLDOWN_HOURS = 24;

/** Candidates considered per person per sweep, before the gate. */
const CANDIDATES_PER_USER = 12;

export interface SweepDeps extends Pick<AppDeps, 'db' | 'config' | 'logger'> {
  /** The per-asset research pass (shared dossier cache behind it). Absent —
   *  the default, and every test's — the pipeline ranks without it. */
  research?: ResearchFn | undefined;
}

interface SweepResult {
  scanned: number;
  proposed: number;
}

function fmtMinor(minor: bigint, currency: string): string {
  const symbol = SYMBOL[currency as Currency] ?? `${currency} `;
  return `${symbol}${(Number(minor) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

const RISK_WORD: Record<string, string> = { low: 'low', medium: 'medium', high: 'high' };

const minBig = (...values: bigint[]): bigint =>
  values.reduce((lo, v) => (v < lo ? v : lo), values[0] ?? 0n);

export async function runAgentSweep(deps: SweepDeps): Promise<SweepResult> {
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
async function sweepOne(deps: SweepDeps, userId: string, dbRole: string): Promise<boolean> {
  return withRls(deps.db, { userId, appRole: 'customer', dbRole }, async (tx) => {
    // Nothing while something already waits: a queue the agent keeps topping
    // up stops being a queue the person reads.
    const [pending] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), eq(approvals.status, 'pending')))
      .limit(1);
    if (pending) return false;

    // The daily cooldown: any card raised in the last day — pending, decided,
    // chat-raised or sweep-raised — keeps the background agent quiet.
    const cooldownSince = new Date(Date.now() - PROPOSAL_COOLDOWN_HOURS * 3_600_000);
    const [recent] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.userId, userId), gte(approvals.createdAt, cooldownSince)))
      .limit(1);
    if (recent) return false;

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
      [...recentApprovals, ...recentOrders]
        .map((r) => r.instrumentId)
        .filter((id): id is string => id !== null),
    );
    const partnerIds = activeAccounts.map((a) => a.partnerId);
    if (partnerIds.length === 0) return false;

    /**
     * The person's actual position — what the fit agent weighs against. Each
     * holding carries its instrument's type and firm so concentration is
     * computed over what they hold, not guessed. A holding without an
     * instrument is cash (the table's convention).
     */
    const heldRows = await tx
      .select({
        instrumentId: holdings.instrumentId,
        name: holdings.name,
        valueMinor: holdings.valueMinor,
        instrumentType: instruments.type,
        partnerName: partners.name,
      })
      .from(holdings)
      .leftJoin(instruments, eq(instruments.id, holdings.instrumentId))
      .leftJoin(partners, eq(partners.id, instruments.partnerId))
      .where(eq(holdings.userId, userId));

    const cashMinor = heldRows
      .filter((h) => h.instrumentId === null)
      .reduce((sum, h) => sum + h.valueMinor, 0n);
    const netWorthMinor = heldRows.reduce((sum, h) => sum + h.valueMinor, 0n);

    // Cash on record: without it there is nothing to propose spending. The
    // gate re-checks this properly (floor, caps); this is just "is there any
    // point looking".
    if (cashMinor <= 0n) return false;

    const positions: FitPosition[] = heldRows.map((h) => ({
      instrumentId: h.instrumentId,
      name: h.name,
      valueMinor: h.valueMinor,
      type: h.instrumentType,
      partnerName: h.partnerName,
    }));

    /**
     * A deal the person already holds is not a background discovery — however
     * it was acquired (an order, an imported statement, a position older than
     * the quiet window). Deepening an existing position is a conversation for
     * the chat, where the person can weigh it; proposed unprompted it reads
     * as the agent recreating a deal that already exists.
     */
    for (const h of heldRows) {
      if (h.instrumentId !== null) excluded.add(h.instrumentId);
    }

    const [profileRow] = await tx
      .select({
        displayCurrency: userProfiles.displayCurrency,
        residencyCountry: userProfiles.residencyCountry,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    const displayCurrency: string = profileRow?.displayCurrency ?? 'USD';

    const goalRows = await tx
      .select({
        name: goalsTable.name,
        targetMinor: goalsTable.targetMinor,
        currentMinor: goalsTable.currentMinor,
        eta: goalsTable.eta,
      })
      .from(goalsTable)
      .where(eq(goalsTable.userId, userId));

    const [limits, band, kycRows] = await Promise.all([
      loadLimits(tx, userId),
      loadBand(tx, userId),
      tx.select().from(kycStatus).where(eq(kycStatus.userId, userId)).limit(1),
    ]);
    const kyc = kycRows[0];
    const activePartnerIds = new Set(partnerIds);

    /**
     * Candidates: live, unblocked, with a real minimum, at a firm the person
     * actually holds an account with — the agent proposes what the person
     * could genuinely act on, not the whole catalogue. The pipeline's research
     * and fit stages do the ranking from here.
     */
    const universe = await tx
      .select({
        id: instruments.id,
        partnerId: instruments.partnerId,
        name: instruments.name,
        type: instruments.type,
        region: instruments.region,
        risk: instruments.risk,
        term: instruments.term,
        metricLabel: instruments.metricLabel,
        metric: instruments.metric,
        description: instruments.description,
        agentNote: instruments.agentNote,
        regulator: instruments.regulator,
        minInvestmentMinor: instruments.minInvestmentMinor,
        currency: instruments.currency,
        partnerName: partners.name,
      })
      .from(instruments)
      .leftJoin(partners, eq(partners.id, instruments.partnerId))
      .where(
        and(
          eq(instruments.listingStatus, 'live'),
          eq(instruments.blocked, false),
          inArray(instruments.partnerId, partnerIds),
          sql`${instruments.minInvestmentMinor} > 0`,
        ),
      )
      .limit(CANDIDATES_PER_USER);
    const universeById = new Map(universe.map((c) => [c.id, c]));

    const heldByInstrument = new Map<string, bigint>();
    for (const h of heldRows) {
      if (h.instrumentId === null) continue;
      heldByInstrument.set(
        h.instrumentId,
        (heldByInstrument.get(h.instrumentId) ?? 0n) + h.valueMinor,
      );
    }

    /**
     * Sizing above the minimum, toward the person's own goals: the nearest
     * underfunded goal's remaining gap, bounded by the cash above their floor
     * and by single-position headroom. Deterministic, conservative, and
     * whatever it returns is re-gated by the pipeline before it is proposed —
     * sizing never outruns screening.
     */
    const sizeFor = (candidate: { instrumentId: string }): SizingChoice | null => {
      const gaps = goalRows
        .map((g) => ({ name: g.name, gap: g.targetMinor - g.currentMinor }))
        .filter((g) => g.gap > 0n)
        .sort((a, b) => (a.gap < b.gap ? -1 : a.gap > b.gap ? 1 : 0));
      const goal = gaps[0];
      if (!goal) return null;

      const cashAvailable = limits.cashFloorEnabled ? cashMinor - limits.cashFloorMinor : cashMinor;
      const bounds = [goal.gap, cashAvailable];
      if (limits.singlePositionEnabled && netWorthMinor > 0n) {
        const cap = (netWorthMinor * BigInt(limits.singlePositionMaxPct)) / 100n;
        bounds.push(cap - (heldByInstrument.get(candidate.instrumentId) ?? 0n));
      }
      const amountMinor = minBig(...bounds);
      if (amountMinor <= 0n) return null;
      return { amountMinor, rationale: `sized toward your "${goal.name}" goal` };
    };

    /**
     * The multi-specialist pipeline — the SAME stages and trace the chat's
     * scout_marketplace tool runs, with the DB-backed gate injected instead of
     * the snapshot one. Research ranks (with the shared per-asset dossier when
     * the composition root wired it), fit weighs the person's own portfolio
     * and goals, suitability screens through their limits, compliance verifies
     * readiness and the firm relationship, and coordination sizes and routes;
     * every verdict lands in the trace the approval carries.
     */
    const outcome = await runProposalPipeline({
      candidates: universe.map((c) => ({
        instrumentId: c.id,
        name: c.name,
        partnerName: c.partnerName,
        risk: c.risk,
        minInvestmentMinor: c.minInvestmentMinor,
        currency: c.currency,
      })),
      excluded,
      fmt: fmtMinor,
      ...(deps.research
        ? {
            research: async (c: { instrumentId: string }) => {
              const row = universeById.get(c.instrumentId);
              if (!row) return null;
              const facts: InstrumentFacts = {
                instrumentId: row.id,
                name: row.name,
                type: row.type,
                region: row.region,
                risk: row.risk,
                term: row.term,
                currency: row.currency,
                minInvestment: fmtMinor(row.minInvestmentMinor, row.currency),
                metricLabel: row.metricLabel,
                metric: row.metric,
                partnerName: row.partnerName,
                regulator: row.regulator,
                description: row.description,
                agentNote: row.agentNote,
              };
              const dossier = await deps.research?.(facts);
              if (!dossier) return null;
              return {
                confidence: dossier.confidence,
                missing: dossier.criticalMissingItems,
                contradicted: dossier.hasContradictedEvidence,
                // The claims travel too, so the trace can cite what the
                // research actually found and how well each point is
                // supported, rather than a bare confidence number.
                sources: dossier.claims.map((cl) => ({
                  category: cl.category,
                  label: cl.label,
                  value: cl.value,
                  status: cl.evidenceStatus,
                  detail: cl.evidenceDetail,
                })),
              };
            },
          }
        : {}),
      fit: (c) => {
        const row = universeById.get(c.instrumentId);
        return assessPortfolioFit({
          candidate: {
            instrumentId: c.instrumentId,
            name: c.name,
            type: row?.type ?? null,
            region: row?.region ?? null,
            currency: c.currency,
            partnerName: c.partnerName,
            term: row?.term ?? null,
            minInvestmentMinor: c.minInvestmentMinor,
          },
          portfolio: { displayCurrency, cashMinor, netWorthMinor, positions },
          goals: goalRows,
          band,
          now: new Date(),
        });
      },
      compliance: (c) => {
        const row = universeById.get(c.instrumentId);
        return assessTransactionCompliance({
          identityVerified: kyc?.identityVerified ?? false,
          complianceConfirmed: kyc?.complianceConfirmed ?? false,
          riskCompleted: kyc?.riskCompleted ?? false,
          fundsConfirmed: kyc?.fundsConfirmed ?? false,
          isPep: kyc?.isPep ?? false,
          activeExecutingFirm: Boolean(row?.partnerId && activePartnerIds.has(row.partnerId)),
          executingFirmName: row?.partnerName ?? null,
        });
      },
      sizeFor,
      gate: async (c, amountMinor) => {
        const instrument = await loadInstrument(tx, c.instrumentId, deps.logger);
        if (!instrument || instrument.listingStatus !== 'live' || instrument.blocked) {
          return { decision: 'blocked', reasons: ['No longer live on the marketplace.'] };
        }
        const decision = await runGate(tx, {
          userId,
          instrument,
          amountMinor,
          currency: instrument.currency,
        });
        return decision.decision === 'blocked'
          ? { decision: 'blocked', reasons: decision.reasons }
          : { decision: decision.decision, code: decision.code };
      },
    });
    if (!outcome.chosen) return false;

    const { candidate, amountMinor, verdict, fit } = outcome.chosen;
    const name = candidate.name;
    const amount = fmtMinor(amountMinor, candidate.currency);
    const chosenRow = universeById.get(candidate.instrumentId);
    const diasporaComparison = buildDiasporaComparison(
      {
        type: chosenRow?.type ?? null,
        region: chosenRow?.region ?? null,
        currency: candidate.currency,
      },
      profileRow?.residencyCountry ?? null,
    );
    const [instrumentRow] = await tx
      .select({ partnerId: instruments.partnerId })
      .from(instruments)
      .where(eq(instruments.id, candidate.instrumentId));

    const sizedAboveMinimum = amountMinor > candidate.minInvestmentMinor;
    const body = [
      `Found by your agent's pipeline — research scanned the marketplace, portfolio fit weighed it against your holdings and goals, suitability screened it against your limits, compliance checked recorded onboarding readiness and the executing-firm relationship, and coordination sized it: ${name}`,
      candidate.partnerName ? ` at ${candidate.partnerName}` : '',
      candidate.risk ? `, ${RISK_WORD[candidate.risk] ?? candidate.risk} risk` : '',
      sizedAboveMinimum
        ? `. Proposed at ${amount} (minimum ${fmtMinor(candidate.minInvestmentMinor, candidate.currency)}), from your cash`
        : `. The minimum is ${amount}, from your cash`,
      limits.cashFloorEnabled
        ? `, and it clears your ${fmtMinor(limits.cashFloorMinor, candidate.currency)} cash floor`
        : '',
      '.',
      fit?.reasons[0] ? ` ${fit.reasons[0]}` : '',
      // The honest half travels with the pitch: the top concern is on the
      // card itself, not buried in the trace.
      fit?.concerns[0] ? ` Worth knowing: ${fit.concerns[0]}` : '',
      ` ${diasporaComparison}`,
      ' Nothing happens unless you approve.',
    ].join('');

    const [card] = await tx
      .insert(approvals)
      .values({
        userId,
        type: 'investment_rec',
        instrumentId: candidate.instrumentId,
        title: `${name} · ${amount}`,
        body,
        amountMinor,
        currency: candidate.currency as Currency,
        snapshot: {
          source: 'background_sweep',
          decision: verdict.decision,
          code: verdict.code,
          // "How this was decided": the stages' own records, verdicts on the
          // losers included. Rendered on the approval card.
          trace: outcome.trace,
        },
      })
      // The partial unique index (0029) is the backstop for the race the
      // pending-gate read cannot see: a chat raise or a second replica's
      // sweep committing between our read and this insert.
      .onConflictDoNothing()
      .returning({ id: approvals.id });
    // Lost the race — someone else's card exists. No card means no message
    // and no audit row; announcing a card that was never created is worse
    // than staying quiet this tick.
    if (!card) return false;

    // The finding, in the person's own conversation — so opening the agent
    // shows what it did while they were away, in its own words.
    await tx.insert(agentMessages).values({
      userId,
      role: 'agent',
      content: `While you were away my research agent scanned the marketplace, the portfolio-fit check weighed the shortlist against your holdings and goals, the suitability check screened it against your limits, and the compliance agent checked recorded onboarding readiness and the executing-firm relationship. ${name}${candidate.partnerName ? ` at ${candidate.partnerName}` : ''} came through. I've put it in your approvals — ${amount}, with the full stage-by-stage reasoning and a like-for-like diaspora comparison on the card. It stays there until you decide.`,
    });

    await auditAppend(tx, {
      actorType: 'agent',
      actorId: null,
      userId,
      partnerId: instrumentRow?.partnerId ?? null,
      action: 'agent.proposed',
      entityType: 'approval',
      entityId: card?.id ?? null,
      detail: {
        instrument: name,
        amount_minor: amountMinor.toString(),
        currency: candidate.currency,
        decision: verdict.decision,
        ...(fit ? { fit_score: fit.score } : {}),
        ...(outcome.chosen.research
          ? { research_confidence: outcome.chosen.research.confidence }
          : {}),
        stages: outcome.trace.map((t) => `${t.agent}: ${t.summary}`),
      },
    });
    return true;
  });
}

/**
 * The scheduler. Started from the composition root only — never from
 * createApp, so tests and one-off scripts get no timers they did not ask for.
 * Runs are serialized: a slow sweep skips the next tick rather than stacking.
 */
export function startAgentSweep(deps: SweepDeps): () => void {
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
