import {
  MIX_KEYS,
  type MixKey,
  RISK_RANK,
  type RiskRating,
  fitsSuitability,
  mixKeyFor,
  targetMixFor,
} from '@ccn/domain';
import { type LimitsDecision, evaluate } from '@ccn/limits-engine';
import { type Currency, convert, formatMoney, money } from '@ccn/money';
import { type FitResult, assessPortfolioFit } from './fit';
import { type StageTrace, runProposalPipeline } from './pipeline';
import type { AgentSnapshot, SnapshotInstrument } from './snapshot';

/**
 * The read/propose surface the agent's tools call. Every method is a PURE read or
 * a PROPOSE — none mutates state. `proposeMove` in particular returns the Limits
 * Engine's verdict as an approval *candidate*; it never creates an order or an
 * approval. There is deliberately no method here that can move money — that is
 * the structural half of the prompt-injection defense.
 */
export interface AgentContext {
  getPortfolio(): PortfolioView;
  getActivity(): ActivityView;
  getLimits(): LimitsView;
  /** Allocation by type / firm / currency, with the band's target mix and the
   *  gaps against it — the "what combination should I hold" answer, computed
   *  from policy data (@ccn/domain TARGET_MIX), never by the model. */
  getAllocation(): AllocationView;
  /** The person's goals: funding progress and horizon. */
  getGoals(): GoalsView;
  searchOpportunities(input: SearchInput): OpportunityView[];
  scoreSuitability(input: { instrumentId: string }): SuitabilityView;
  /** The portfolio-fit verdict for one instrument — score, reasons, concerns. */
  scoreFit(input: { instrumentId: string }): FitView;
  /** Side-by-side comparison of 2-4 instruments, fit scores included. */
  compareOpportunities(input: { instrumentIds: string[] }): ComparisonView;
  proposeMove(input: { instrumentId: string; amountMinor: number }): ProposalView;
  /** Run the multi-specialist pipeline (research → fit → suitability →
   *  coordination) over the whole marketplace snapshot. Read/propose only,
   *  like everything here — the outcome is a recommendation with its working
   *  shown. */
  scoutMarketplace(): Promise<ScoutView>;
  explain(input: { topic: ExplainTopic }): { topic: ExplainTopic; explanation: string };
}

export interface PortfolioView {
  netWorth: string;
  cash: string;
  holdings: { name: string; value: string; partner: string | null }[];
}
export interface LimitsView {
  autoInvest: string | null;
  cashFloor: string | null;
  fxSpreadMaxBps: number | null;
  requireApprovalAbove: string | null;
  singlePositionMaxPct: number | null;
  dailyCap: string | null;
}
export interface SearchInput {
  query?: string | undefined;
  type?: string | undefined;
  maxRisk?: RiskRating | undefined;
}
export interface OpportunityView {
  instrumentId: string;
  slug: string;
  name: string;
  type: string;
  region: string | null;
  risk: RiskRating;
  metricLabel: string | null;
  metric: string | null;
  minimum: string;
  partner: string | null;
  regulator: string | null;
  suitable: boolean;
  screenedOut: boolean;
}
export interface SuitabilityView {
  instrumentId: string;
  name: string;
  risk: RiskRating;
  band: string;
  suitable: boolean;
  note: string;
}
export interface ProposalView {
  instrumentId: string;
  name: string;
  amount: string;
  decision: LimitsDecision['decision'];
  code: string;
  reasons: string[];
  /** Always true — the agent proposes; a human tap (or the exec modal) executes. */
  requiresHumanApproval: boolean;
  summary: string;
}
/**
 * The caller's own activity, each item carrying a sentence saying where it
 * stands and what happens next. The agent could research and propose and then
 * had nothing to say at the moment a person actually worries — after they act.
 * The sentences are composed here, deterministically, so the process the model
 * narrates is the process the product runs and not an improvisation over ids.
 */
export interface ActivityView {
  orders: {
    name: string;
    amount: string;
    status: string;
    state: string;
  }[];
  approvals: { title: string; amount: string | null; waitingSince: string }[];
  connections: { partner: string; status: string; state: string }[];
}

/**
 * One allocation slice, chart-ready: the minor units survive as a string (for
 * anything that needs the number back), the formatted value reads on screen,
 * and pct is a real number a bar can be drawn from.
 */
export interface AllocationSliceView {
  key: string;
  label: string;
  valueMinor: string;
  value: string;
  pct: number;
}

export interface AllocationView {
  currency: string;
  total: string;
  band: string;
  /** By instrument type, each slice carrying the band's target and the gap —
   *  the current-vs-target picture the combination is steered by. */
  byType: (AllocationSliceView & { targetPct: number; gapPts: number })[];
  byPartner: AllocationSliceView[];
  byCurrency: AllocationSliceView[];
}

export interface GoalView {
  name: string;
  target: string;
  current: string;
  targetMinor: string;
  currentMinor: string;
  /** Funded percentage, 0-100, computed from the two amounts. */
  pct: number;
  eta: string | null;
}
export interface GoalsView {
  goals: GoalView[];
}

export interface FitView {
  instrumentId: string;
  name: string;
  score: number;
  reasons: string[];
  concerns: string[];
}

export interface ComparisonRow {
  instrumentId: string;
  name: string;
  type: string;
  region: string | null;
  risk: RiskRating;
  metricLabel: string | null;
  metric: string | null;
  minimum: string;
  partner: string | null;
  regulator: string | null;
  suitable: boolean;
  fitScore: number;
  topReason: string | null;
  topConcern: string | null;
}
export interface ComparisonView {
  rows: ComparisonRow[];
}

/** The pipeline's outcome for the chat: the stages' visible records plus the
 *  chosen candidate (or none), ready for the model to narrate faithfully. */
export interface ScoutView {
  trace: StageTrace[];
  proposal: {
    instrumentId: string;
    name: string;
    partner: string | null;
    amount: string;
    decision: string;
  } | null;
}

export type ExplainTopic = 'safety' | 'fees' | 'kyc' | 'how_it_works' | 'limits';

const EXPLANATIONS: Record<ExplainTopic, string> = {
  safety:
    'CCN research, screens and prepares; the licensed, FSC-regulated partners execute, custody and settle. CCN never holds your money and never executes a trade itself. Everything happens inside limits you set, and every action is written to an immutable audit log.',
  fees: 'CCN charges a flat platform fee. Each partner’s own product fees are shown on the deal card before you approve. There are no hidden spreads from CCN.',
  kyc: 'Your identity checks live with the licensed partners, not with CCN. With your consent CCN reuses a partner’s verified KYC status across the network, so there is no duplicate paperwork; each partner remains the regulated entity for its own accounts.',
  how_it_works:
    'The agent discovers regional opportunities, screens them against your suitability profile and limits, and prepares them for your approval. It can act alone only inside your auto-invest limit; anything larger becomes an approval card you decide on.',
  limits:
    'Your limits govern what the agent may do alone: an auto-invest cap, a cash floor it never breaches, an FX-spread guardrail, a require-approval threshold, and a single-position cap. Anything outside them is escalated to you, never executed silently.',
};

function toView(
  inst: SnapshotInstrument,
  display: Currency,
): Omit<OpportunityView, 'suitable' | 'screenedOut'> {
  return {
    instrumentId: inst.id,
    slug: inst.slug,
    name: inst.name,
    type: inst.type,
    region: inst.region,
    risk: inst.risk,
    metricLabel: inst.metricLabel,
    metric: inst.metric,
    minimum: formatMoney(convert(money(inst.minInvestmentMinor, inst.currency), display)),
    partner: inst.partnerName,
    regulator: inst.regulator,
  };
}

/** Build the pure read/propose context over a request-time snapshot. */
export function buildContext(snapshot: AgentSnapshot): AgentContext {
  const display = snapshot.portfolio.currency;
  const byId = new Map(snapshot.instruments.map((i) => [i.id, i]));
  const positionFor = (instrumentId: string): bigint =>
    snapshot.portfolio.positions
      .filter((p) => p.instrumentId === instrumentId)
      .reduce((sum, p) => sum + p.valueMinor, 0n);

  const fmt = (minor: bigint): string => formatMoney(money(minor, display));

  const day = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const pctOf = (part: bigint, whole: bigint): number =>
    whole > 0n ? Number((part * 10_000n) / whole) / 100 : 0;

  /** The fit agent over this snapshot — the same assessor the background
   *  sweep runs, with the snapshot's own goals and band. */
  const fitFor = (inst: SnapshotInstrument): FitResult =>
    assessPortfolioFit({
      candidate: {
        instrumentId: inst.id,
        name: inst.name,
        type: inst.type,
        region: inst.region,
        currency: inst.currency,
        partnerName: inst.partnerName,
        term: null,
        minInvestmentMinor: inst.minInvestmentMinor,
      },
      portfolio: {
        displayCurrency: display,
        cashMinor: snapshot.portfolio.cashMinor,
        netWorthMinor: snapshot.portfolio.netWorthMinor,
        positions: snapshot.portfolio.positions.map((p) => {
          const held = byId.get(p.instrumentId);
          return {
            instrumentId: p.instrumentId,
            name: held?.name ?? 'a holding',
            valueMinor: p.valueMinor,
            type: held?.type ?? null,
            partnerName: held?.partnerName ?? null,
          };
        }),
      },
      goals: snapshot.goals,
      band: snapshot.band,
      now: new Date(),
    });

  /** A pending card already exists for this instrument — the one thing the
   *  agent must never do is stack a second one on top of it. */
  const pendingCardFor = (instrumentId: string) =>
    snapshot.activity.approvals.find((a) => a.instrumentId === instrumentId);

  return {
    getActivity() {
      const a = snapshot.activity;
      return {
        orders: a.orders.map((o) => {
          const name = o.instrumentName ?? 'an instrument';
          const firm = o.partnerName ?? 'the executing firm';
          let state: string;
          switch (o.status) {
            case 'created':
              state = `Routed to ${firm} on ${day(o.createdAt)}; waiting for their desk to accept it.`;
              break;
            case 'accepted':
              state = o.settlementEta
                ? `${firm} accepted it and expects to settle it around ${day(o.settlementEta)}.`
                : `${firm} accepted it and is executing; they set the settlement date when known.`;
              break;
            case 'settled': {
              const at = o.unitPriceMinor !== null ? ` at ${fmt(o.unitPriceMinor)} per unit` : '';
              state = `Settled${o.settledAt ? ` on ${day(o.settledAt)}` : ''} by ${firm}${at}. The position appears in the portfolio once the firm next reports it.`;
              break;
            }
            case 'rejected':
              state = o.rejectedReason
                ? `${firm} declined it: ${o.rejectedReason}`
                : `${firm} declined it without giving a reason.`;
              break;
            default:
              state = 'It expired before the firm acted on it.';
          }
          return { name, amount: fmt(o.amountMinor), status: o.status, state };
        }),
        approvals: a.approvals.map((ap) => ({
          title: ap.title,
          amount: ap.amountMinor !== null ? fmt(ap.amountMinor) : null,
          waitingSince: day(ap.createdAt),
        })),
        connections: a.connections.map((cn) => ({
          partner: cn.partner,
          status: cn.status,
          state:
            cn.status === 'pending'
              ? `${cn.partner}'s compliance desk is still reviewing the request from ${day(cn.requestedAt)}. Nothing is read from them until they accept.`
              : cn.status === 'active'
                ? `${cn.partner} accepted the connection; their positions are read into the portfolio.`
                : cn.declineReason
                  ? `${cn.partner} declined: ${cn.declineReason}`
                  : `${cn.partner} declined the connection.`,
        })),
      };
    },

    getPortfolio() {
      return {
        netWorth: fmt(snapshot.portfolio.netWorthMinor),
        cash: fmt(snapshot.portfolio.cashMinor),
        holdings: snapshot.portfolio.holdings.map((h) => ({
          name: h.name,
          value: fmt(h.valueMinor),
          partner: h.partner,
        })),
      };
    },

    getAllocation() {
      const total = snapshot.portfolio.netWorthMinor;
      const target = targetMixFor(snapshot.band);

      const byTypeMinor = new Map<MixKey, bigint>([['cash', snapshot.portfolio.cashMinor]]);
      const byPartnerMinor = new Map<string, bigint>();
      const byCurrencyMinor = new Map<string, bigint>([[display, snapshot.portfolio.cashMinor]]);
      for (const p of snapshot.portfolio.positions) {
        const inst = byId.get(p.instrumentId);
        const key = mixKeyFor(inst?.type ?? null);
        if (key !== null) byTypeMinor.set(key, (byTypeMinor.get(key) ?? 0n) + p.valueMinor);
        const firm = inst?.partnerName ?? 'Unlinked holdings';
        byPartnerMinor.set(firm, (byPartnerMinor.get(firm) ?? 0n) + p.valueMinor);
        const ccy = inst?.currency ?? display;
        byCurrencyMinor.set(ccy, (byCurrencyMinor.get(ccy) ?? 0n) + p.valueMinor);
      }

      const TYPE_LABELS: Record<MixKey, string> = {
        cash: 'Cash',
        bond: 'Fixed income',
        fund: 'Funds',
        equity: 'Equities',
        real_estate: 'Real estate',
        private: 'Private markets',
      };
      const slice = (key: string, label: string, valueMinor: bigint): AllocationSliceView => ({
        key,
        label,
        valueMinor: valueMinor.toString(),
        value: fmt(valueMinor),
        pct: pctOf(valueMinor, total),
      });

      return {
        currency: display,
        total: fmt(total),
        band: snapshot.band,
        // Every mix key appears, held or not: a 0% row with a 30% target IS
        // the allocation gap, and hiding it hides the point.
        byType: MIX_KEYS.map((key) => {
          const valueMinor = byTypeMinor.get(key) ?? 0n;
          const base = slice(key, TYPE_LABELS[key], valueMinor);
          return {
            ...base,
            targetPct: target[key],
            gapPts: Math.round((target[key] - base.pct) * 10) / 10,
          };
        }),
        byPartner: [...byPartnerMinor.entries()]
          .sort((a, b) => (a[1] < b[1] ? 1 : -1))
          .map(([firm, valueMinor]) => slice(firm, firm, valueMinor)),
        byCurrency: [...byCurrencyMinor.entries()]
          .sort((a, b) => (a[1] < b[1] ? 1 : -1))
          .map(([ccy, valueMinor]) => slice(ccy, ccy, valueMinor)),
      };
    },

    getGoals() {
      return {
        goals: snapshot.goals.map((g) => ({
          name: g.name,
          target: fmt(g.targetMinor),
          current: fmt(g.currentMinor),
          targetMinor: g.targetMinor.toString(),
          currentMinor: g.currentMinor.toString(),
          pct: g.targetMinor > 0n ? Math.min(100, pctOf(g.currentMinor, g.targetMinor)) : 0,
          eta: g.eta,
        })),
      };
    },

    scoreFit({ instrumentId }) {
      const inst = byId.get(instrumentId);
      if (!inst) {
        return {
          instrumentId,
          name: 'unknown',
          score: 0,
          reasons: [],
          concerns: ['Instrument not found.'],
        };
      }
      const fit = fitFor(inst);
      return { instrumentId, name: inst.name, ...fit };
    },

    compareOpportunities({ instrumentIds }) {
      const rows: ComparisonRow[] = [];
      for (const id of instrumentIds.slice(0, 4)) {
        const inst = byId.get(id);
        if (!inst) continue;
        const fit = fitFor(inst);
        rows.push({
          instrumentId: inst.id,
          name: inst.name,
          type: inst.type,
          region: inst.region,
          risk: inst.risk,
          metricLabel: inst.metricLabel,
          metric: inst.metric,
          minimum: formatMoney(convert(money(inst.minInvestmentMinor, inst.currency), display)),
          partner: inst.partnerName,
          regulator: inst.regulator,
          suitable: !inst.blocked && fitsSuitability(snapshot.band, inst.risk),
          fitScore: fit.score,
          topReason: fit.reasons[0] ?? null,
          topConcern: fit.concerns[0] ?? null,
        });
      }
      return { rows };
    },

    getLimits() {
      const l = snapshot.limits;
      return {
        autoInvest: l.autoInvestEnabled ? fmt(l.autoInvestCapMinor) : null,
        cashFloor: l.cashFloorEnabled ? fmt(l.cashFloorMinor) : null,
        fxSpreadMaxBps: l.fxSpreadEnabled ? l.fxSpreadMaxBps : null,
        requireApprovalAbove: l.requireApprovalEnabled ? fmt(l.requireApprovalAboveMinor) : null,
        singlePositionMaxPct: l.singlePositionEnabled ? l.singlePositionMaxPct : null,
        dailyCap: l.dailyCapEnabled && l.dailyCapMinor !== null ? fmt(l.dailyCapMinor) : null,
      };
    },

    searchOpportunities(input) {
      const q = input.query?.toLowerCase().trim();
      const maxRank = input.maxRisk ? RISK_RANK[input.maxRisk] : Number.POSITIVE_INFINITY;
      return snapshot.instruments
        .filter((i) => (input.type ? i.type === input.type : true))
        .filter((i) => RISK_RANK[i.risk] <= maxRank)
        .filter((i) =>
          q
            ? `${i.name} ${i.region ?? ''} ${i.type} ${i.partnerName ?? ''}`
                .toLowerCase()
                .includes(q)
            : true,
        )
        .map((i) => ({
          ...toView(i, display),
          suitable: !i.blocked && fitsSuitability(snapshot.band, i.risk),
          screenedOut: i.blocked,
        }));
    },

    scoreSuitability({ instrumentId }) {
      const inst = byId.get(instrumentId);
      if (!inst) {
        return {
          instrumentId,
          name: 'unknown',
          risk: 'high',
          band: snapshot.band,
          suitable: false,
          note: 'Instrument not found.',
        };
      }
      const suitable = !inst.blocked && fitsSuitability(snapshot.band, inst.risk);
      const note = inst.blocked
        ? 'This instrument is screened out and will not be prepared.'
        : suitable
          ? `A ${inst.risk}-risk instrument fits your ${snapshot.band} band.`
          : `A ${inst.risk}-risk instrument is outside your ${snapshot.band} band.`;
      return {
        instrumentId,
        name: inst.name,
        risk: inst.risk,
        band: snapshot.band,
        suitable,
        note,
      };
    },

    proposeMove({ instrumentId, amountMinor }) {
      const inst = byId.get(instrumentId);
      const amount = money(BigInt(Math.trunc(amountMinor)), display);
      const pending = pendingCardFor(instrumentId);
      if (pending && inst) {
        return {
          instrumentId,
          name: inst.name,
          amount: formatMoney(amount),
          decision: 'blocked',
          code: 'already_pending',
          reasons: [`"${pending.title}" is already waiting in your approvals.`],
          requiresHumanApproval: true,
          summary: `This is already waiting in your approvals — decide that card first. I won't stack a second card for the same move.`,
        };
      }
      if (!inst) {
        return {
          instrumentId,
          name: 'unknown',
          amount: formatMoney(amount),
          decision: 'blocked',
          code: 'not_found',
          reasons: ['Instrument not found.'],
          requiresHumanApproval: true,
          summary: 'I could not find that instrument, so I will not prepare anything.',
        };
      }
      const decision = evaluate({
        proposal: {
          amountMinor: amount.minor,
          currency: display,
          instrument: {
            risk: inst.risk,
            minInvestmentMinor: inst.minInvestmentMinor,
            blocked: inst.blocked,
            blockReasons: inst.blockReasons,
          },
          isFxTransfer: false,
          fxSpreadBps: 0,
        },
        limits: snapshot.limits,
        portfolio: {
          cashMinor: snapshot.portfolio.cashMinor,
          portfolioTotalMinor: snapshot.portfolio.netWorthMinor,
          currentPositionMinor: positionFor(instrumentId),
          spentTodayMinor: snapshot.portfolio.spentTodayMinor,
        },
        band: snapshot.band,
      });
      const reasons =
        decision.decision === 'blocked'
          ? decision.reasons
          : decision.decision === 'requires_approval'
            ? [decision.reason]
            : [];
      const summary =
        decision.decision === 'blocked'
          ? `I will not prepare this: ${reasons.join('; ')}.`
          : decision.decision === 'requires_approval'
            ? `Prepared as an approval card for you to confirm — ${reasons.join('; ')}.`
            : 'Inside your limits; prepared for your one-tap approval.';
      return {
        instrumentId,
        name: inst.name,
        amount: formatMoney(amount),
        /**
         * The same amount in minor units, as a string.
         *
         * `amount` above is formatted for reading. A caller turning this
         * proposal into an approval needs the number the engine actually
         * weighed, and re-parsing "US$2,500" to get it back is how a currency
         * bug starts. Bigints do not survive JSON, hence the string.
         */
        amountMinor: amount.minor.toString(),
        decision: decision.decision,
        code: decision.code,
        reasons,
        requiresHumanApproval: true,
        summary,
      };
    },

    /**
     * The three-specialist pipeline over the snapshot — the same stages the
     * background sweep runs, gated by the same Limits Engine, with the same
     * visible trace. The chat's gate is the snapshot-backed evaluate; the
     * sweep's is the DB-backed one; the pipeline cannot tell them apart.
     */
    async scoutMarketplace() {
      const candidates = snapshot.instruments
        .filter((i) => !i.blocked)
        .map((i) => ({
          instrumentId: i.id,
          name: i.name,
          partnerName: i.partnerName,
          risk: i.risk,
          minInvestmentMinor: i.minInvestmentMinor,
          currency: i.currency as string,
        }));
      /**
       * The same quiet discipline as the background sweep: instruments with a
       * pending card or inside the 14-day window, plus everything already
       * held, are not candidates. A conversation must not recreate a deal
       * that already exists — deepening a held position stays possible, but
       * only when the person asks about that instrument directly.
       */
      const excluded = new Set<string>([
        ...snapshot.quietInstrumentIds,
        ...snapshot.portfolio.positions.map((p) => p.instrumentId),
      ]);
      const outcome = await runProposalPipeline({
        candidates,
        excluded,
        fmt: (minor, currency) => formatMoney(money(minor, currency as Currency)),
        /** The portfolio-fit assessor over the same snapshot — with the
         *  snapshot's own goals and band, so the liquidity and target-mix
         *  checks run here exactly as they do in the background sweep. */
        fit: (c) => {
          const inst = byId.get(c.instrumentId);
          if (!inst) return { score: 0, reasons: [], concerns: ['Unknown instrument.'] };
          return fitFor(inst);
        },
        gate: (c, amountMinor) => {
          const inst = byId.get(c.instrumentId);
          if (!inst) return { decision: 'blocked' as const, reasons: ['Instrument not found.'] };
          const decision = evaluate({
            proposal: {
              amountMinor,
              currency: inst.currency,
              instrument: {
                risk: inst.risk,
                minInvestmentMinor: inst.minInvestmentMinor,
                blocked: inst.blocked,
                blockReasons: inst.blockReasons,
              },
              isFxTransfer: false,
              fxSpreadBps: 0,
            },
            limits: snapshot.limits,
            portfolio: {
              cashMinor: snapshot.portfolio.cashMinor,
              portfolioTotalMinor: snapshot.portfolio.netWorthMinor,
              currentPositionMinor: positionFor(c.instrumentId),
              spentTodayMinor: snapshot.portfolio.spentTodayMinor,
            },
            band: snapshot.band,
          });
          if (decision.decision === 'blocked') {
            return { decision: 'blocked' as const, reasons: decision.reasons };
          }
          return { decision: decision.decision, code: decision.code };
        },
      });
      return {
        trace: outcome.trace,
        proposal: outcome.chosen
          ? {
              instrumentId: outcome.chosen.candidate.instrumentId,
              name: outcome.chosen.candidate.name,
              partner: outcome.chosen.candidate.partnerName,
              amount: formatMoney(
                money(outcome.chosen.amountMinor, outcome.chosen.candidate.currency as Currency),
              ),
              decision: outcome.chosen.verdict.decision,
            }
          : null,
      };
    },

    explain({ topic }) {
      return { topic, explanation: EXPLANATIONS[topic] };
    },
  };
}
