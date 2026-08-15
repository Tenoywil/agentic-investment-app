/**
 * The multi-agent proposal pipeline: three specialists, one visible record.
 *
 * The product says "your agent discovers, screens and coordinates execution" —
 * three different jobs, and until now they were one interleaved loop whose
 * working was invisible. This module makes the claim literal:
 *
 *   1. RESEARCH  — ranks the candidate universe and shortlists what is worth
 *                  screening (gentlest viable first: risk, then minimum).
 *   2. SUITABILITY — runs each shortlisted candidate through the deterministic
 *                  Limits Engine gate — the person's own band, cash floor,
 *                  caps — and records every verdict, rejections included.
 *   3. COORDINATION — sizes the first passing candidate, decides the route
 *                  (always an approval card; the pipeline never moves money),
 *                  and writes the plain-language case.
 *
 * Each stage hands the next a typed result and leaves a `StageTrace` behind.
 * The trace is stored on the approval's snapshot, so "How was this decided?"
 * has an answer a person can read — which stage saw what, and why the losers
 * lost. A pipeline that cannot show its handoffs is indistinguishable from a
 * single loop with a marketing name.
 *
 * The gate is INJECTED. The background sweep passes the DB-backed gate
 * (services/gate.ts); the chat passes the snapshot-backed Limits Engine
 * evaluate. Same stages, same trace shape, both callers — the pipeline itself
 * touches no database and calls no model, so it is deterministic and testable.
 */

export type PipelineStageName = 'research' | 'suitability' | 'coordination';

/** One stage's visible record: who ran, what it concluded, the facts behind it. */
export interface StageTrace {
  stage: PipelineStageName;
  /** The specialist's display name, e.g. "Research agent". */
  agent: string;
  /** One sentence a person reads. */
  summary: string;
  /** Supporting facts, one per line. */
  detail: string[];
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
}

export interface PipelineOutcome {
  /** The proposal, or null when nothing survived screening. */
  chosen: {
    candidate: PipelineCandidate;
    amountMinor: bigint;
    verdict: GateVerdict;
  } | null;
  /** The three stages' records, in running order — research and suitability
   *  always present; coordination only when something was chosen. */
  trace: StageTrace[];
}

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };
const DEFAULT_SHORTLIST = 5;

export async function runProposalPipeline(input: PipelineInput): Promise<PipelineOutcome> {
  const trace: StageTrace[] = [];

  // ---- 1. Research: rank and shortlist -----------------------------------
  const considered = input.candidates.filter((c) => !input.excluded.has(c.instrumentId));
  const ranked = [...considered].sort((a, b) => {
    const risk = (RISK_ORDER[a.risk ?? 'high'] ?? 2) - (RISK_ORDER[b.risk ?? 'high'] ?? 2);
    if (risk !== 0) return risk;
    return a.minInvestmentMinor < b.minInvestmentMinor
      ? -1
      : a.minInvestmentMinor > b.minInvestmentMinor
        ? 1
        : 0;
  });
  const shortlist = ranked.slice(0, input.shortlist ?? DEFAULT_SHORTLIST);
  const rested = input.candidates.length - considered.length;
  trace.push({
    stage: 'research',
    agent: 'Research agent',
    summary: `Scanned ${input.candidates.length} live product${
      input.candidates.length === 1 ? '' : 's'
    } at your firms${rested > 0 ? ` (${rested} resting after a recent proposal or trade)` : ''} and shortlisted ${shortlist.length}, gentlest first.`,
    detail: shortlist.map(
      (c) =>
        `${c.name}${c.partnerName ? ` · ${c.partnerName}` : ''} — ${c.risk ?? 'unrated'} risk, minimum ${input.fmt(c.minInvestmentMinor, c.currency)}`,
    ),
  });

  // ---- 2. Suitability: the gate decides, and every verdict is kept -------
  const verdicts: string[] = [];
  let chosen: PipelineOutcome['chosen'] = null;
  for (const c of shortlist) {
    const amountMinor = c.minInvestmentMinor;
    const verdict = await input.gate(c, amountMinor);
    if (verdict.decision === 'blocked') {
      verdicts.push(
        `${c.name}: does not fit — ${verdict.reasons?.join('; ') ?? verdict.code ?? 'outside your limits'}`,
      );
      continue;
    }
    verdicts.push(
      `${c.name}: fits your limits${verdict.code ? ` (${verdict.code.replace(/_/g, ' ')})` : ''}`,
    );
    chosen = { candidate: c, amountMinor, verdict };
    break;
  }
  trace.push({
    stage: 'suitability',
    agent: 'Suitability agent',
    summary: chosen
      ? `Screened ${verdicts.length} against your band, cash floor and caps — ${chosen.candidate.name} fits.`
      : shortlist.length === 0
        ? 'Nothing reached screening.'
        : `Screened ${verdicts.length} against your band, cash floor and caps — none fit right now.`,
    detail: verdicts,
  });

  // ---- 3. Coordination: size it, route it, say it plainly ----------------
  if (chosen) {
    trace.push({
      stage: 'coordination',
      agent: 'Coordinator',
      summary: `Sized ${chosen.candidate.name} at its ${input.fmt(
        chosen.amountMinor,
        chosen.candidate.currency,
      )} minimum and raised it as an approval — nothing moves unless you say so.`,
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
