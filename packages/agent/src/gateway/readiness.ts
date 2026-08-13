/**
 * Deterministic readiness scoring from evidence trust labels (Gateway handoff
 * doc §15/§25's evidence graph). Same discipline as ./matching.ts: the LLM's
 * readiness-assessment pass (packages/agent/src/gateway/orchestrator.ts)
 * extracts claims and labels each one's evidence — a real judgment call, well
 * suited to a language model — but the aggregate 0-100 score that
 * `packages/gateway-guardrail` gates on is computed HERE, in pure arithmetic.
 * The LLM never invents the final number, only the per-claim trust label.
 *
 * No I/O, no clock, no randomness.
 */

export type EvidenceStatus =
  | 'verified'
  | 'partially_verified'
  | 'self_reported'
  | 'unverified'
  | 'contradicted';

/** Per-status contribution to the average, on a 0-1 scale. Contradicted is
 *  negative — a single contradiction should pull the score down hard, not
 *  merely fail to help it, since `gateway-guardrail` also hard-blocks on any
 *  contradicted evidence regardless of this score. */
const STATUS_WEIGHT: Record<EvidenceStatus, number> = {
  verified: 1,
  partially_verified: 0.6,
  self_reported: 0.3,
  unverified: 0.1,
  contradicted: -1,
};

/** A claim category the assessment pass may or may not have found evidence for. */
export type ClaimCategory = 'financial' | 'legal' | 'market' | 'team' | 'other';

export interface ReadinessClaim {
  category: ClaimCategory | null;
  evidenceStatus: EvidenceStatus;
}

/** Categories a private-deal opportunity should have at least one claim for
 *  before it's considered ready to show an investor. Missing ones are named
 *  explicitly rather than silently lowering the score, per doc §42.20. */
export const REQUIRED_CLAIM_CATEGORIES: readonly ClaimCategory[] = ['financial', 'market', 'team'];

export interface ReadinessResult {
  /** 0-100, clamped. */
  score: number;
  criticalMissingItems: string[];
  hasContradictedEvidence: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Score an opportunity's readiness from its extracted claims. An opportunity
 * with no claims at all scores 0 (nothing has been substantiated), not NaN.
 */
export function computeReadinessScore(claims: readonly ReadinessClaim[]): ReadinessResult {
  const hasContradictedEvidence = claims.some((c) => c.evidenceStatus === 'contradicted');

  const average =
    claims.length === 0
      ? 0
      : claims.reduce((sum, c) => sum + STATUS_WEIGHT[c.evidenceStatus], 0) / claims.length;
  const score = Math.round(clamp(average, 0, 1) * 100);

  const present = new Set(
    claims.map((c) => c.category).filter((c): c is ClaimCategory => c !== null),
  );
  const criticalMissingItems = REQUIRED_CLAIM_CATEGORIES.filter((c) => !present.has(c)).map(
    (c) => `no ${c} evidence provided`,
  );

  return { score, criticalMissingItems, hasContradictedEvidence };
}
