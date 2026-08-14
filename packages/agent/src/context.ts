import { RISK_RANK, type RiskRating, fitsSuitability } from '@ccn/domain';
import { type LimitsDecision, evaluate } from '@ccn/limits-engine';
import { type Currency, convert, formatMoney, money } from '@ccn/money';
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
  getLimits(): LimitsView;
  searchOpportunities(input: SearchInput): OpportunityView[];
  scoreSuitability(input: { instrumentId: string }): SuitabilityView;
  proposeMove(input: { instrumentId: string; amountMinor: number }): ProposalView;
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

  return {
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

    explain({ topic }) {
      return { topic, explanation: EXPLANATIONS[topic] };
    },
  };
}
