/**
 * The multi-agent proposal pipeline: four specialists, one visible record.
 *
 * The product says "your agent discovers, screens and coordinates execution" —
 * different jobs, and until now they were one interleaved loop whose working
 * was invisible. This module makes the claim literal:
 *
 *   1. RESEARCH  — ranks the candidate universe and shortlists what is worth
 *                  screening. With a research signal injected (the per-asset
 *                  claims pass in ./research.ts) it ranks by conviction —
 *                  research confidence × portfolio fit — and VETOES anything
 *                  with contradicted evidence; without one it falls back to
 *                  gentlest-viable-first (risk, then minimum).
 *   2. FIT       — weighs each shortlisted candidate against the person's own
 *                  portfolio and goals (./fit.ts): duplication, firm and type
 *                  concentration, currency mismatch, money locked past a
 *                  goal's horizon. Only runs when the caller provides it.
 *   3. SUITABILITY — runs each shortlisted candidate through the deterministic
 *                  Limits Engine gate — the person's own band, cash floor,
 *                  caps — and records every verdict, rejections included. A
 *                  candidate that fits the limits but carries low conviction
 *                  is PASSED OVER: proposing nothing beats proposing something
 *                  mediocre, and it is what keeps approval cards meaning
 *                  something.
 *   4. COORDINATION — sizes the chosen candidate (at its minimum, or toward a
 *                  goal when the caller provides a sizing policy — any size
 *                  above the minimum is re-gated before it is proposed),
 *                  decides the route (always an approval card; the pipeline
 *                  never moves money), and writes the plain-language case.
 *
 * Each stage hands the next a typed result and leaves a `StageTrace` behind.
 * The trace is stored on the approval's snapshot, so "How was this decided?"
 * has an answer a person can read — which stage saw what, and why the losers
 * lost. A pipeline that cannot show its handoffs is indistinguishable from a
 * single loop with a marketing name.
 *
 * The gate is INJECTED. The background sweep passes the DB-backed gate
 * (services/gate.ts); the chat passes the snapshot-backed Limits Engine
 * evaluate. The research signal, fit assessor, and sizing policy are injected
 * the same way and are all optional — a caller that provides none gets
 * exactly the original three-stage behavior. The pipeline itself touches no
 * database and calls no model, so it is deterministic and testable.
 */

import type { FitResult } from './fit';

export type PipelineStageName = 'research' | 'fit' | 'suitability' | 'coordination';

/** One cited research claim: what is asserted, and how well it is supported.
 *  The status vocabulary is research.ts's evidence labels, carried verbatim. */
export interface ResearchSourceClaim {
  category: string | null;
  label: string;
  value: string;
  /** verified | partially_verified | self_reported | unverified | contradicted */
  status: string;
  detail: string | null;
}

/** One stage's visible record: who ran, what it concluded, the facts behind it. */
export interface StageTrace {
  stage: PipelineStageName;
  /** The specialist's display name, e.g. "Research agent". */
  agent: string;
  /** One sentence a person reads. */
  summary: string;
  /** Supporting facts, one per line. */
  detail: string[];
  /**
   * Cited evidence, per candidate — today only the research stage writes it,
   * from the dossier's claims. Optional and additive: traces recorded before
   * citations existed simply have none, and no renderer invents any.
   */
  sources?: { name: string; claims: ResearchSourceClaim[] }[];
}

export interface PipelineCandidate {
  instrumentId: string;
  name: string;
  partnerName: string | null;
  risk: 'low' | 'medium' | 'high' | null;
  minInvestmentMinor: bigint;
  currency: string;
}

export interface GateVerdict {
  decision: 'auto_act' | 'requires_approval' | 'blocked';
  /** The engine's code (e.g. 'above_auto_invest') or block reasons. */
  code?: string | null;
  reasons?: string[];
}

/** What the research pass concluded about one candidate — mapped down from
 *  the full dossier so the pipeline stays decoupled from its shape. Null from
 *  the callback means "research unavailable": the pipeline degrades to a
 *  neutral confidence, it never fabricates one. */
export interface ResearchSignal {
  /** 0-100, computed deterministically from evidence labels — never by a model. */
  confidence: number;
  /** Named gaps, e.g. "no liquidity evidence found". */
  missing: string[];
  /** A single contradiction is a veto, not a discount. */
  contradicted: boolean;
  /** The dossier's claims, for the trace's citations. Optional: a signal
   *  without them still ranks and vetoes exactly as before. */
  sources?: ResearchSourceClaim[];
}

/** How the coordinator should size the chosen candidate above its minimum.
 *  Whatever it returns is re-gated before it is proposed — sizing never
 *  outruns screening. */
export interface SizingChoice {
  amountMinor: bigint;
  /** Why this size, e.g. `sized toward your "House deposit" goal`. */
  rationale: string;
}

export interface PipelineInput {
  /** The raw universe — live, unblocked products at firms the person holds
   *  accounts with. The research stage does the ranking and shortlisting. */
  candidates: PipelineCandidate[];
  /** Instruments in their quiet period (recently proposed or traded). */
  excluded: ReadonlySet<string>;
  /** How many survive research into screening. */
  shortlist?: number;
  /** The deterministic gate. May be async (DB-backed) or sync (snapshot). */
  gate: (c: PipelineCandidate, amountMinor: bigint) => Promise<GateVerdict> | GateVerdict;
  /** Money formatter in the caller's display conventions. */
  fmt: (minor: bigint, currency: string) => string;
  /** Per-asset research signal (shared dossier cache behind it). Optional —
   *  absent or null-returning, research ranks gentlest-first as before. */
  research?: (c: PipelineCandidate) => Promise<ResearchSignal | null> | ResearchSignal | null;
  /** Portfolio-fit assessor (pure, ./fit.ts). Optional — absent, the fit
   *  stage does not run and ranking ignores fit. */
  fit?: (c: PipelineCandidate) => FitResult;
  /** Sizing policy above the minimum. Optional — absent, size at the minimum. */
  sizeFor?: (c: PipelineCandidate) => SizingChoice | null;
  /** Combined-conviction floor (0-100) under which a candidate that fits the
   *  limits is still passed over. Applied only when research or fit is
   *  provided. Default 30. */
  proposalBar?: number;
}

export interface PipelineOutcome {
  /** The proposal, or null when nothing survived screening. */
  chosen: {
    candidate: PipelineCandidate;
    amountMinor: bigint;
    verdict: GateVerdict;
    fit: FitResult | null;
    research: ResearchSignal | null;
  } | null;
  /** The stages' records, in running order — research and suitability always
   *  present; fit only when a fit assessor was provided; coordination only
   *  when something was chosen. */
  trace: StageTrace[];
}

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };
const DEFAULT_SHORTLIST = 5;
const DEFAULT_PROPOSAL_BAR = 30;
/** Stand-ins when one half of the conviction score is unavailable — slightly
 *  below "good", so a fully-scored candidate outranks a degraded one but a
 *  degraded pipeline still proposes. */
const NEUTRAL_CONFIDENCE = 55;
const NEUTRAL_FIT = 60;

const byGentlest = (a: PipelineCandidate, b: PipelineCandidate): number => {
  const risk = (RISK_ORDER[a.risk ?? 'high'] ?? 2) - (RISK_ORDER[b.risk ?? 'high'] ?? 2);
  if (risk !== 0) return risk;
  return a.minInvestmentMinor < b.minInvestmentMinor
    ? -1
    : a.minInvestmentMinor > b.minInvestmentMinor
      ? 1
      : 0;
};

export async function runProposalPipeline(input: PipelineInput): Promise<PipelineOutcome> {
  const trace: StageTrace[] = [];
  const scored = input.research !== undefined || input.fit !== undefined;
  const bar = input.proposalBar ?? DEFAULT_PROPOSAL_BAR;

  // ---- 1. Research: signals, veto, rank, shortlist -----------------------
  const considered = input.candidates.filter((c) => !input.excluded.has(c.instrumentId));

  const signals = new Map<string, ResearchSignal | null>();
  if (input.research) {
    const results = await Promise.all(considered.map((c) => input.research?.(c) ?? null));
    considered.forEach((c, i) => signals.set(c.instrumentId, results[i] ?? null));
  }
  const fits = new Map<string, FitResult>();
  if (input.fit) {
    for (const c of considered) fits.set(c.instrumentId, input.fit(c));
  }
  const conviction = (c: PipelineCandidate): number => {
    const confidence = signals.get(c.instrumentId)?.confidence ?? NEUTRAL_CONFIDENCE;
    const fitScore = fits.get(c.instrumentId)?.score ?? NEUTRAL_FIT;
    return Math.round((confidence * fitScore) / 100);
  };

  const vetoed = considered.filter((c) => signals.get(c.instrumentId)?.contradicted === true);
  const eligible = considered.filter((c) => signals.get(c.instrumentId)?.contradicted !== true);

  const ranked = [...eligible].sort((a, b) =>
    scored ? conviction(b) - conviction(a) || byGentlest(a, b) : byGentlest(a, b),
  );
  const shortlist = ranked.slice(0, input.shortlist ?? DEFAULT_SHORTLIST);
  const rested = input.candidates.length - considered.length;

  const describeResearch = (c: PipelineCandidate): string => {
    const signal = signals.get(c.instrumentId);
    const base = `${c.name}${c.partnerName ? ` · ${c.partnerName}` : ''}: ${c.risk ?? 'unrated'} risk, minimum ${input.fmt(c.minInvestmentMinor, c.currency)}`;
    if (!signal) return base;
    const missing = signal.missing.length > 0 ? `; ${signal.missing.join(', ')}` : '';
    return `${base}; research confidence ${signal.confidence}/100${missing}`;
  };
  // The citations: each shortlisted candidate's claims, capped so the trace
  // stays a readable record rather than a dossier dump.
  const citedSources = shortlist
    .map((c) => ({
      name: c.name,
      claims: (signals.get(c.instrumentId)?.sources ?? []).slice(0, 6),
    }))
    .filter((s) => s.claims.length > 0)
    .slice(0, 3);
  trace.push({
    stage: 'research',
    agent: 'Research agent',
    summary: `Scanned ${input.candidates.length} live product${
      input.candidates.length === 1 ? '' : 's'
    } at your firms${rested > 0 ? ` (${rested} resting after a recent proposal or trade)` : ''} and shortlisted ${shortlist.length}, ${
      scored ? 'strongest conviction first' : 'gentlest first'
    }.`,
    detail: [
      ...shortlist.map(describeResearch),
      ...vetoed.map((c) => `${c.name}: set aside. Its research turned up contradicted evidence.`),
    ],
    ...(citedSources.length > 0 ? { sources: citedSources } : {}),
  });

  // ---- 2. Fit: the person's own portfolio and goals ----------------------
  if (input.fit) {
    trace.push({
      stage: 'fit',
      agent: 'Portfolio fit agent',
      summary: `Weighed ${shortlist.length === 1 ? 'it' : `each of the ${shortlist.length}`} against your holdings, currencies and goals.`,
      detail: shortlist.map((c) => {
        const fit = fits.get(c.instrumentId);
        if (!fit) return `${c.name}: not assessed`;
        const notes = [...fit.reasons, ...fit.concerns];
        return `${c.name}: fit ${fit.score}/100${notes.length > 0 ? `. ${notes.join(' ')}` : ''}`;
      }),
    });
  }

  // ---- 3. Suitability: the gate decides, and every verdict is kept -------
  const verdicts: string[] = [];
  let chosen: PipelineOutcome['chosen'] = null;
  for (const c of shortlist) {
    const amountMinor = c.minInvestmentMinor;
    const verdict = await input.gate(c, amountMinor);
    if (verdict.decision === 'blocked') {
      verdicts.push(
        `${c.name}: does not fit: ${verdict.reasons?.join('; ') ?? verdict.code ?? 'outside your limits'}`,
      );
      continue;
    }
    if (scored && conviction(c) < bar) {
      verdicts.push(
        `${c.name}: fits your limits, but conviction is low (${conviction(c)}/100), so it was passed over rather than proposed.`,
      );
      continue;
    }
    verdicts.push(
      `${c.name}: fits your limits${verdict.code ? ` (${verdict.code.replace(/_/g, ' ')})` : ''}`,
    );
    chosen = {
      candidate: c,
      amountMinor,
      verdict,
      fit: fits.get(c.instrumentId) ?? null,
      research: signals.get(c.instrumentId) ?? null,
    };
    break;
  }
  trace.push({
    stage: 'suitability',
    agent: 'Suitability agent',
    summary: chosen
      ? `Screened ${verdicts.length} against your band, cash floor and caps. ${chosen.candidate.name} fits.`
      : shortlist.length === 0
        ? 'Nothing reached screening.'
        : `Screened ${verdicts.length} against your band, cash floor and caps. None ${
            scored ? 'worth proposing' : 'fit'
          } right now.`,
    detail: verdicts,
  });

  // ---- 4. Coordination: size it, route it, say it plainly ----------------
  if (chosen) {
    const minimum = chosen.candidate.minInvestmentMinor;
    let sizingNote = `at its ${input.fmt(minimum, chosen.candidate.currency)} minimum`;
    const sized = input.sizeFor?.(chosen.candidate) ?? null;
    if (sized && sized.amountMinor > minimum) {
      // Sizing never outruns screening: the larger amount passes the same
      // gate, or the proposal falls back to the minimum it already cleared.
      const verdictAtSize = await input.gate(chosen.candidate, sized.amountMinor);
      if (verdictAtSize.decision !== 'blocked') {
        chosen = { ...chosen, amountMinor: sized.amountMinor, verdict: verdictAtSize };
        sizingNote = `at ${input.fmt(sized.amountMinor, chosen.candidate.currency)} (${sized.rationale}; above the ${input.fmt(minimum, chosen.candidate.currency)} minimum and re-checked against your limits)`;
      } else {
        sizingNote = `at its ${input.fmt(minimum, chosen.candidate.currency)} minimum (${sized.rationale}, but the larger size did not clear your limits)`;
      }
    }
    trace.push({
      stage: 'coordination',
      agent: 'Coordinator',
      summary: `Sized ${chosen.candidate.name} ${sizingNote} and raised it as an approval. Nothing moves unless you say so.`,
      detail: [
        `Route: approval card${
          chosen.verdict.decision === 'auto_act'
            ? ' (inside your auto-act limit, but a background finding always asks)'
            : ''
        }`,
        `Executing firm: ${chosen.candidate.partnerName ?? 'your connected firm'}`,
      ],
    });
  }

  return { chosen, trace };
}
