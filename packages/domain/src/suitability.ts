/**
 * Suitability: does an instrument's risk rating fit a user's risk band? Pure
 * policy table. The onboarding quiz (riskQuestions, avg of 3 answers → band)
 * assigns the band; the marketplace tags each instrument low/medium/high.
 */

export type RiskRating = 'low' | 'medium' | 'high';
export type RiskBand = 'low' | 'low_moderate' | 'high_moderate' | 'low_high' | 'high';

/** Ordinal rank so risks can be compared. */
export const RISK_RANK: Record<RiskRating, number> = { low: 1, medium: 2, high: 3 };

/**
 * The most aggressive instrument risk each band may hold. Conservative bands cap
 * lower; only the top two bands admit high-risk instruments. This is a policy
 * decision, tuned here rather than scattered across the engine.
 */
export const BAND_MAX_RISK: Record<RiskBand, RiskRating> = {
  low: 'low',
  low_moderate: 'medium',
  high_moderate: 'medium',
  low_high: 'high',
  high: 'high',
};

/** True when an instrument of `risk` is suitable for a user in `band`. */
export function fitsSuitability(band: RiskBand, risk: RiskRating): boolean {
  return RISK_RANK[risk] <= RISK_RANK[BAND_MAX_RISK[band]];
}

/**
 * Map an onboarding risk score to a band. Three questions, each 1–5, summed
 * (3–15); the average drives the band the way the prototype's quiz does.
 */
export function scoreToBand(score: number, questions = 3): RiskBand {
  const avg = score / questions;
  if (avg < 1.8) return 'low';
  if (avg < 2.6) return 'low_moderate';
  if (avg < 3.4) return 'high_moderate';
  if (avg < 4.2) return 'low_high';
  return 'high';
}
