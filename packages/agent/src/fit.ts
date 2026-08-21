/**
 * The Portfolio Fit agent — "does this make sense for THIS person", asked
 * properly. The Limits Engine checks limits; this checks SENSE. They are
 * different questions: a bond can clear every cap and still be the wrong idea
 * because the person already holds three instruments from the same firm, or
 * because the money it would lock up is the money a goal needs next year.
 *
 * It is also where the COMBINATION gets assembled: given the person's band,
 * the fit weighs each candidate against the band's TARGET_MIX (policy data in
 * @ccn/domain) — a move that closes the portfolio's largest allocation gap
 * earns points and a named reason; one that deepens an overweight bucket is a
 * named concern. Over successive approved proposals, single moves steer the
 * portfolio toward the right mix without any bulk reallocation.
 *
 * Pure: input in, verdict out, no I/O, no clock of its own (`now` is passed
 * in). The fit score can only NARROW what the gate allows — it never widens
 * it, and it never overrides a gate verdict. Every deduction and every credit
 * lands in `reasons`/`concerns` as a sentence a person can check, because a
 * score nobody can audit is a vibe with digits.
 */

import { type MixKey, type RiskBand, allocationGaps, mixKeyFor } from '@ccn/domain';

export interface FitCandidate {
  instrumentId: string;
  name: string;
  /** Instrument type label, e.g. bond / fund / equity — grouped as opaque text. */
  type: string | null;
  region: string | null;
  currency: string;
  partnerName: string | null;
  /** Free-text term, e.g. "8 yr · USD", "Open-ended". Parsed tolerantly. */
  term: string | null;
  minInvestmentMinor: bigint;
}

export interface FitPosition {
  /** Null ⇒ cash (the holdings-table convention). */
  instrumentId: string | null;
  name: string;
  valueMinor: bigint;
  type: string | null;
  partnerName: string | null;
}

export interface FitGoal {
  name: string;
  targetMinor: bigint;
  currentMinor: bigint;
  /** Free-text ETA, e.g. "On track · mid-2028", "Projected 2044", "Complete". */
  eta: string | null;
}

export interface FitInput {
  candidate: FitCandidate;
  portfolio: {
    /** The currency the person reads their money in. */
    displayCurrency: string;
    cashMinor: bigint;
    netWorthMinor: bigint;
    positions: FitPosition[];
  };
  goals: FitGoal[];
  /** The caller's suitability band. When present, the fit weighs the
   *  candidate against the band's TARGET_MIX — does this move assemble the
   *  right combination, or deepen an overweight? Absent, the check is
   *  skipped (backwards compatible). */
  band?: RiskBand;
  /** The caller's clock — this module reads no clock of its own. */
  now: Date;
}

export interface FitResult {
  /** 0-100. Higher = the candidate makes more sense against this portfolio. */
  score: number;
  reasons: string[];
  concerns: string[];
}

/**
 * The comparison a diaspora investor needs beside a regional proposal.
 *
 * This is intentionally qualitative. The snapshot has the product's own type,
 * region and currency, but it does not contain current US, Canadian or UK
 * market prices or the person's tax treatment. Naming the decision dimensions
 * is useful; inventing a foreign benchmark or tax advantage is not.
 */
export function buildDiasporaComparison(
  candidate: Pick<FitCandidate, 'type' | 'region' | 'currency'>,
): string {
  const type = candidate.type?.trim().toLowerCase() || 'investment';
  const region = candidate.region?.trim() || 'Caribbean';
  return `Diaspora comparison: relative to a like-for-like US, Canadian or UK ${type}, the potential value is ${region} exposure. It is not automatically better: compare net fees, tax and reporting for your residence, ${candidate.currency} currency risk, liquidity and settlement, diversification, and investor protections before deciding.`;
}

/** Above this share of the portfolio at one firm, more of it is a concern. */
const PARTNER_CONCENTRATION_MAX = 0.4;
/** Above this share of invested money in one instrument type, likewise. */
const TYPE_CONCENTRATION_MAX = 0.6;
/** A minimum this small relative to cash reads as a comfortable next step. */
const EASY_STEP_SHARE = 0.25;
/** A minimum this large relative to cash is a big single commitment. */
const BIG_STEP_SHARE = 0.6;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pct = (part: bigint, whole: bigint): number =>
  whole > 0n ? Number((part * 10_000n) / whole) / 100 : 0;

/**
 * Months implied by a free-text term label. "8 yr · USD" → 96, "18 months" →
 * 18, "Open-ended"/"Equity"/unknown → null (the check is skipped, never
 * guessed).
 */
export function parseTermMonths(term: string | null): number | null {
  if (!term) return null;
  const years = term.match(/(\d+)\s*(?:yr|year)/i);
  if (years?.[1]) return Number(years[1]) * 12;
  const months = term.match(/(\d+)\s*(?:mo|month)/i);
  if (months?.[1]) return Number(months[1]);
  return null;
}

/**
 * Months until a goal's free-text ETA, from `now`. Finds a 4-digit year
 * ("mid-2028", "Projected 2044") and counts to the middle of that year;
 * anything else ("Complete", null) → null. Tolerant on purpose — a goal ETA
 * is a label people type, not a date column.
 */
export function parseEtaMonths(eta: string | null, now: Date): number | null {
  if (!eta) return null;
  const year = eta.match(/\b(20\d{2})\b/);
  if (!year?.[1]) return null;
  const months = (Number(year[1]) - now.getUTCFullYear()) * 12 + (6 - (now.getUTCMonth() + 1));
  return Math.max(0, months);
}

/**
 * Weigh one candidate against the person's actual portfolio and goals.
 * Deterministic scoring from a 70-point base: duplication, firm and type
 * concentration, currency mismatch, locking money past a goal's horizon, and
 * the size of the step relative to cash on hand.
 */
export function assessPortfolioFit(input: FitInput): FitResult {
  const { candidate, portfolio, goals } = input;
  const reasons: string[] = [];
  const concerns: string[] = [];
  let score = 70;

  const invested = portfolio.positions.filter((p) => p.instrumentId !== null);
  const investedTotal = invested.reduce((sum, p) => sum + p.valueMinor, 0n);

  // Duplication vs. first-of-its-kind diversification.
  const existing = invested.filter((p) => p.instrumentId === candidate.instrumentId);
  const existingValue = existing.reduce((sum, p) => sum + p.valueMinor, 0n);
  if (existingValue > 0n) {
    score -= 25;
    concerns.push(
      `You already hold ${candidate.name}. Adding more deepens a position you have, it does not diversify.`,
    );
  } else if (
    candidate.type &&
    !invested.some((p) => p.type !== null && p.type.toLowerCase() === candidate.type?.toLowerCase())
  ) {
    score += 15;
    reasons.push(
      `Your first ${candidate.type.toLowerCase()} exposure, a return source your portfolio does not have yet.`,
    );
  }

  // Concentration at one firm. Small, correlated markets make one conglomerate
  // one risk however many products it lists.
  if (candidate.partnerName && portfolio.netWorthMinor > 0n) {
    const atPartner = invested
      .filter((p) => p.partnerName === candidate.partnerName)
      .reduce((sum, p) => sum + p.valueMinor, 0n);
    const share = pct(atPartner, portfolio.netWorthMinor);
    if (share >= PARTNER_CONCENTRATION_MAX * 100) {
      score -= 15;
      concerns.push(
        `${Math.round(share)}% of your portfolio already sits at ${candidate.partnerName}, and this adds to that concentration.`,
      );
    }
  }

  // Concentration in one instrument type.
  if (candidate.type && investedTotal > 0n) {
    const inType = invested
      .filter((p) => p.type !== null && p.type.toLowerCase() === candidate.type?.toLowerCase())
      .reduce((sum, p) => sum + p.valueMinor, 0n);
    const share = pct(inType, investedTotal);
    if (share >= TYPE_CONCENTRATION_MAX * 100) {
      score -= 10;
      concerns.push(
        `${Math.round(share)}% of your invested money is already in ${candidate.type.toLowerCase()}s, and this adds more of what you have most of.`,
      );
    }
  }

  // Currency vs. the currency the person actually reads their money in. A
  // "7% JMD" return can be negative in the currency someone spends.
  if (candidate.currency !== portfolio.displayCurrency) {
    score -= 10;
    concerns.push(
      `Priced in ${candidate.currency} while your portfolio reads in ${portfolio.displayCurrency}, so the return moves with the ${candidate.currency}/${portfolio.displayCurrency} rate as well as the asset.`,
    );
  }

  // Liquidity vs. goals: never quietly propose locking funds past a dated
  // goal's horizon when the cash left after buying could not cover its gap.
  const termMonths = parseTermMonths(candidate.term);
  if (termMonths !== null) {
    for (const goal of goals) {
      const gap = goal.targetMinor - goal.currentMinor;
      if (gap <= 0n) continue;
      const etaMonths = parseEtaMonths(goal.eta, input.now);
      if (etaMonths === null || termMonths <= etaMonths) continue;
      const cashAfter = portfolio.cashMinor - candidate.minInvestmentMinor;
      if (cashAfter < gap) {
        score -= 20;
        concerns.push(
          `Its ${candidate.term} term runs past your "${goal.name}" goal, and the cash left after buying would not cover that goal's remaining gap.`,
        );
        break; // One liquidity concern is the message; repeating it per goal is noise.
      }
    }
  }

  // The combination: does this move close the band's largest allocation gap,
  // or deepen a bucket that is already over target?
  if (input.band && portfolio.netWorthMinor > 0n) {
    const currentPct: Partial<Record<MixKey, number>> = {};
    const add = (key: MixKey | null, valueMinor: bigint) => {
      if (key === null) return;
      currentPct[key] = (currentPct[key] ?? 0) + pct(valueMinor, portfolio.netWorthMinor);
    };
    add('cash', portfolio.cashMinor);
    for (const p of invested) add(mixKeyFor(p.type), p.valueMinor);

    const gaps = allocationGaps(currentPct, input.band);
    const candidateKey = mixKeyFor(candidate.type);
    if (candidateKey !== null && candidateKey !== 'cash') {
      const largest = gaps[0];
      const own = gaps.find((g) => g.key === candidateKey);
      if (largest && largest.gapPts >= 10 && largest.key === candidateKey) {
        score += 10;
        reasons.push(
          `Closes your biggest allocation gap: your mix is about ${Math.round(largest.gapPts)} points under your band's ${candidateKey.replace('_', ' ')} target.`,
        );
      } else if (own && own.gapPts <= -10) {
        score -= 10;
        concerns.push(
          `Your mix is already about ${Math.round(-own.gapPts)} points over your band's ${candidateKey.replace('_', ' ')} target — this deepens the overweight.`,
        );
      }
    }
  }

  // The size of the step relative to cash on hand.
  if (portfolio.cashMinor > 0n) {
    const share = pct(candidate.minInvestmentMinor, portfolio.cashMinor);
    if (share <= EASY_STEP_SHARE * 100) {
      score += 10;
      reasons.push(
        `A measured step: the minimum is about ${Math.max(1, Math.round(share))}% of your cash.`,
      );
    } else if (share > BIG_STEP_SHARE * 100) {
      score -= 10;
      concerns.push(
        `The minimum takes about ${Math.round(share)}% of your cash in one move, a large single commitment.`,
      );
    }
  }

  return { score: clamp(Math.round(score), 0, 100), reasons, concerns };
}
