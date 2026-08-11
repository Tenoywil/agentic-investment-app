/**
 * Deterministic investor↔opportunity matching (Gateway handoff doc §29/§52).
 *
 * The weighted score is computed HERE, in pure code — never by the LLM. The
 * agent orchestrator's match-narration pass only explains a score already
 * computed; it cannot change it. This is the same discipline as
 * `@ccn/limits-engine`: a number that gates or ranks something a human relies
 * on is arithmetic, not a language-model guess.
 *
 * No I/O, no clock, no randomness — every input is data the caller already
 * loaded. Component scores are returned alongside the total so the caller can
 * store them (`gateway_matches.component_scores`) and the UI can show "why it
 * matches you" without re-deriving anything.
 */

export type Ordinal = 'low' | 'medium' | 'high';

export interface MandateProfile {
  countries: readonly string[];
  sectors: readonly string[];
  minCheckMinor: bigint;
  maxCheckMinor: bigint;
  stagePreferences: readonly string[];
  riskAppetite: Ordinal;
  horizonYears: number;
  targetReturnPct: number;
  liquidityNeed: Ordinal;
  boardInvolvement: boolean;
  impactPreference: boolean;
}

export interface OpportunityProfile {
  country: string;
  sector: string;
  capitalSoughtMinor: bigint;
  stage: string;
  riskRating: Ordinal;
  horizonYears: number;
  targetReturnPct: number;
  liquidity: Ordinal;
  offersBoardSeat: boolean;
  hasImpactFocus: boolean;
  /**
   * Precomputed cosine similarity (0–1) between mandate and opportunity text
   * embeddings, when `AI_EMBED_MODEL` is wired. When absent, `score()` falls
   * back to `deterministicSemanticProxy` — a documented stand-in, not a silent
   * substitute; callers that care should check `usedSemanticProxy` on the result.
   */
  semanticSimilarity?: number;
}

export interface MatchWeights {
  country: number;
  sector: number;
  chequeSize: number;
  stage: number;
  risk: number;
  horizon: number;
  targetReturn: number;
  liquidity: number;
  governance: number;
  impact: number;
  semantic: number;
}

/** Doc §29's table, exactly: 15/15/15/10/10/10/5/5/5/5/5, sums to 1. */
export const DEFAULT_WEIGHTS: MatchWeights = {
  country: 0.15,
  sector: 0.15,
  chequeSize: 0.15,
  stage: 0.1,
  risk: 0.1,
  horizon: 0.1,
  targetReturn: 0.05,
  liquidity: 0.05,
  governance: 0.05,
  impact: 0.05,
  semantic: 0.05,
};

export interface MatchResult {
  /** 0–1. */
  score: number;
  componentScores: MatchWeights;
  usedSemanticProxy: boolean;
}

const RANK: Record<Ordinal, number> = { low: 0, medium: 1, high: 2 };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function setFit(preferred: readonly string[], actual: string): number {
  // An empty preference list means "no restriction" — full fit.
  if (preferred.length === 0) return 1;
  return preferred.includes(actual) ? 1 : 0;
}

function chequeSizeFit(mandate: MandateProfile, capitalSoughtMinor: bigint): number {
  const min = mandate.minCheckMinor;
  const max = mandate.maxCheckMinor;
  if (capitalSoughtMinor >= min && capitalSoughtMinor <= max) return 1;
  if (capitalSoughtMinor < min) {
    if (min <= 0n) return 0;
    return clamp01(Number(capitalSoughtMinor) / Number(min));
  }
  // capitalSoughtMinor > max
  if (capitalSoughtMinor <= 0n) return 0;
  return clamp01(Number(max) / Number(capitalSoughtMinor));
}

function ordinalDistanceFit(a: Ordinal, b: Ordinal): number {
  // Adjacent bands (e.g. medium vs high) score 0.5; opposite ends score 0.
  return clamp01(1 - Math.abs(RANK[a] - RANK[b]) / 2);
}

function horizonFit(mandateYears: number, opportunityYears: number): number {
  if (mandateYears <= 0) return opportunityYears <= 0 ? 1 : 0;
  return clamp01(1 - Math.abs(mandateYears - opportunityYears) / mandateYears);
}

function returnFit(targetPct: number, offeredPct: number): number {
  // Meeting or beating the investor's target is a full match; falling short
  // decays linearly to zero rather than penalizing a merely-lower number hard.
  if (targetPct <= 0) return 1;
  if (offeredPct >= targetPct) return 1;
  return clamp01(offeredPct / targetPct);
}

function liquidityFit(need: Ordinal, offered: Ordinal): number {
  // Offering at least as much liquidity as the investor needs is a full match;
  // offering less is penalized by how far short it falls.
  const gap = RANK[need] - RANK[offered];
  return gap <= 0 ? 1 : clamp01(1 - gap / 2);
}

function booleanRequirementFit(required: boolean, offered: boolean): number {
  // A requirement the investor doesn't have is always satisfied; one they do
  // have is only satisfied when the opportunity actually offers it.
  return !required || offered ? 1 : 0;
}

/**
 * Deterministic stand-in for semantic similarity when no embedding is
 * available: token-overlap (Jaccard) across country/sector/stage. Coarse by
 * design — it exists so the total score is never silently missing a term, not
 * as a real substitute for embeddings.
 */
export function deterministicSemanticProxy(
  mandate: MandateProfile,
  opportunity: OpportunityProfile,
): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const mandateTokens = new Set([
    ...mandate.countries.flatMap(tokenize),
    ...mandate.sectors.flatMap(tokenize),
    ...mandate.stagePreferences.flatMap(tokenize),
  ]);
  const oppTokens = new Set([
    ...tokenize(opportunity.country),
    ...tokenize(opportunity.sector),
    ...tokenize(opportunity.stage),
  ]);
  if (mandateTokens.size === 0 || oppTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of mandateTokens) if (oppTokens.has(token)) intersection++;
  const union = new Set([...mandateTokens, ...oppTokens]).size;
  return union === 0 ? 0 : clamp01(intersection / union);
}

/** Score a mandate against an opportunity. The LLM narrates this; it never computes it. */
export function score(
  mandate: MandateProfile,
  opportunity: OpportunityProfile,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): MatchResult {
  const usedSemanticProxy = opportunity.semanticSimilarity === undefined;
  const semantic = clamp01(
    opportunity.semanticSimilarity ?? deterministicSemanticProxy(mandate, opportunity),
  );

  const componentScores: MatchWeights = {
    country: setFit(mandate.countries, opportunity.country),
    sector: setFit(mandate.sectors, opportunity.sector),
    chequeSize: chequeSizeFit(mandate, opportunity.capitalSoughtMinor),
    stage: setFit(mandate.stagePreferences, opportunity.stage),
    risk: ordinalDistanceFit(mandate.riskAppetite, opportunity.riskRating),
    horizon: horizonFit(mandate.horizonYears, opportunity.horizonYears),
    targetReturn: returnFit(mandate.targetReturnPct, opportunity.targetReturnPct),
    liquidity: liquidityFit(mandate.liquidityNeed, opportunity.liquidity),
    governance: booleanRequirementFit(mandate.boardInvolvement, opportunity.offersBoardSeat),
    impact: booleanRequirementFit(mandate.impactPreference, opportunity.hasImpactFocus),
    semantic,
  };

  const total = (Object.keys(weights) as (keyof MatchWeights)[]).reduce(
    (sum, key) => sum + componentScores[key] * weights[key],
    0,
  );

  return { score: clamp01(total), componentScores, usedSemanticProxy };
}
