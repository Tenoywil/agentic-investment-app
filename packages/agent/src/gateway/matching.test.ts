import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_WEIGHTS,
  type MandateProfile,
  type OpportunityProfile,
  deterministicSemanticProxy,
  score,
} from './matching';

const MANDATE: MandateProfile = {
  countries: ['Jamaica', 'Trinidad and Tobago'],
  sectors: ['Renewable Energy', 'Technology'],
  minCheckMinor: 10_000_00n, // $10,000.00 in minor units
  maxCheckMinor: 500_000_00n, // $500,000.00
  stagePreferences: ['Growth', 'Series A'],
  riskAppetite: 'medium',
  horizonYears: 6,
  targetReturnPct: 12,
  liquidityNeed: 'low',
  boardInvolvement: true,
  impactPreference: true,
};

const PERFECT_OPPORTUNITY: OpportunityProfile = {
  country: 'Jamaica',
  sector: 'Renewable Energy',
  capitalSoughtMinor: 100_000_00n,
  stage: 'Growth',
  riskRating: 'medium',
  horizonYears: 6,
  targetReturnPct: 14,
  liquidity: 'low',
  offersBoardSeat: true,
  hasImpactFocus: true,
  semanticSimilarity: 1,
};

describe('score — weights', () => {
  test('DEFAULT_WEIGHTS sums to 1 (doc §29: 15/15/15/10/10/10/5/5/5/5/5)', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test('a perfect match scores 1', () => {
    const result = score(MANDATE, PERFECT_OPPORTUNITY);
    expect(result.score).toBeCloseTo(1, 10);
    for (const v of Object.values(result.componentScores)) expect(v).toBeCloseTo(1, 10);
  });

  test('every component score is always within [0, 1]', () => {
    const adversarial: OpportunityProfile = {
      country: 'Nowhere',
      sector: 'Nothing',
      capitalSoughtMinor: -1n,
      stage: 'Unknown',
      riskRating: 'high',
      horizonYears: -50,
      targetReturnPct: -100,
      liquidity: 'high',
      offersBoardSeat: false,
      hasImpactFocus: false,
    };
    const result = score(MANDATE, adversarial);
    for (const v of Object.values(result.componentScores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('score — set-membership components (country/sector/stage)', () => {
  test('country outside the preference list scores 0 on that component', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, country: 'Barbados' });
    expect(result.componentScores.country).toBe(0);
  });

  test('an empty preference list means no restriction (full fit)', () => {
    const openMandate: MandateProfile = { ...MANDATE, countries: [] };
    const result = score(openMandate, { ...PERFECT_OPPORTUNITY, country: 'Anywhere' });
    expect(result.componentScores.country).toBe(1);
  });

  test('sector and stage follow the same set-membership rule', () => {
    const wrongSector = score(MANDATE, { ...PERFECT_OPPORTUNITY, sector: 'Real Estate' });
    expect(wrongSector.componentScores.sector).toBe(0);
    const wrongStage = score(MANDATE, { ...PERFECT_OPPORTUNITY, stage: 'Seed' });
    expect(wrongStage.componentScores.stage).toBe(0);
  });
});

describe('score — cheque size', () => {
  test('within [min, max] scores 1', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: 250_000_00n });
    expect(result.componentScores.chequeSize).toBe(1);
  });

  test('at the exact boundaries scores 1', () => {
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: MANDATE.minCheckMinor })
        .componentScores.chequeSize,
    ).toBe(1);
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: MANDATE.maxCheckMinor })
        .componentScores.chequeSize,
    ).toBe(1);
  });

  test('below the minimum decays proportionally, never negative', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: 5_000_00n });
    expect(result.componentScores.chequeSize).toBeCloseTo(0.5, 5);
  });

  test('above the maximum decays proportionally, never negative', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: 1_000_000_00n });
    expect(result.componentScores.chequeSize).toBeCloseTo(0.5, 5);
  });

  test('zero sought against a positive minimum scores 0, not NaN', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, capitalSoughtMinor: 0n });
    expect(result.componentScores.chequeSize).toBe(0);
    expect(Number.isNaN(result.componentScores.chequeSize)).toBe(false);
  });
});

describe('score — ordinal fits (risk, liquidity)', () => {
  test('risk: exact match scores 1, adjacent bands score 0.5, opposite ends score 0', () => {
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, riskRating: 'medium' }).componentScores.risk,
    ).toBe(1);
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, riskRating: 'high' }).componentScores.risk,
    ).toBeCloseTo(0.5, 5);
    const lowRiskMandate: MandateProfile = { ...MANDATE, riskAppetite: 'low' };
    expect(
      score(lowRiskMandate, { ...PERFECT_OPPORTUNITY, riskRating: 'high' }).componentScores.risk,
    ).toBe(0);
  });

  test('liquidity: offering at least what is needed scores 1', () => {
    const needsLow: MandateProfile = { ...MANDATE, liquidityNeed: 'low' };
    expect(
      score(needsLow, { ...PERFECT_OPPORTUNITY, liquidity: 'low' }).componentScores.liquidity,
    ).toBe(1);
    expect(
      score(needsLow, { ...PERFECT_OPPORTUNITY, liquidity: 'high' }).componentScores.liquidity,
    ).toBe(1);
  });

  test('liquidity: offering less than needed is penalized by the gap', () => {
    const needsHigh: MandateProfile = { ...MANDATE, liquidityNeed: 'high' };
    expect(
      score(needsHigh, { ...PERFECT_OPPORTUNITY, liquidity: 'low' }).componentScores.liquidity,
    ).toBe(0);
    expect(
      score(needsHigh, { ...PERFECT_OPPORTUNITY, liquidity: 'medium' }).componentScores.liquidity,
    ).toBeCloseTo(0.5, 5);
  });
});

describe('score — horizon and return', () => {
  test('horizon: exact match scores 1; distance decays proportionally to the mandate horizon', () => {
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, horizonYears: 6 }).componentScores.horizon,
    ).toBe(1);
    // mandate horizon = 6, |6-3| = 3, 1 - 3/6 = 0.5
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, horizonYears: 3 }).componentScores.horizon,
    ).toBeCloseTo(0.5, 5);
  });

  test('horizon: a huge overshoot floors at 0, never negative', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, horizonYears: 100 });
    expect(result.componentScores.horizon).toBe(0);
  });

  test('return: meeting or beating the target scores 1', () => {
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, targetReturnPct: 12 }).componentScores.targetReturn,
    ).toBe(1);
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, targetReturnPct: 20 }).componentScores.targetReturn,
    ).toBe(1);
  });

  test('return: falling short decays proportionally to the target', () => {
    // target 12, offered 6 -> 6/12 = 0.5
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, targetReturnPct: 6 });
    expect(result.componentScores.targetReturn).toBeCloseTo(0.5, 5);
  });
});

describe('score — boolean requirements (governance, impact)', () => {
  test('a requirement the investor does not have is always satisfied', () => {
    const noBoardNeeded: MandateProfile = { ...MANDATE, boardInvolvement: false };
    expect(
      score(noBoardNeeded, { ...PERFECT_OPPORTUNITY, offersBoardSeat: false }).componentScores
        .governance,
    ).toBe(1);
  });

  test('a requirement the investor has is only satisfied when offered', () => {
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, offersBoardSeat: false }).componentScores.governance,
    ).toBe(0);
    expect(
      score(MANDATE, { ...PERFECT_OPPORTUNITY, hasImpactFocus: false }).componentScores.impact,
    ).toBe(0);
  });
});

describe('score — semantic similarity', () => {
  test('uses the precomputed similarity when provided', () => {
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, semanticSimilarity: 0.42 });
    expect(result.componentScores.semantic).toBeCloseTo(0.42, 5);
    expect(result.usedSemanticProxy).toBe(false);
  });

  test('falls back to the deterministic proxy when absent, and says so', () => {
    const { semanticSimilarity, ...withoutSimilarity } = PERFECT_OPPORTUNITY;
    const result = score(MANDATE, withoutSimilarity);
    expect(result.usedSemanticProxy).toBe(true);
    expect(result.componentScores.semantic).toBeCloseTo(
      deterministicSemanticProxy(MANDATE, withoutSimilarity),
      10,
    );
  });

  test('deterministicSemanticProxy is symmetJaccard-bounded [0,1] and handles empty sets', () => {
    const emptyMandate: MandateProfile = {
      ...MANDATE,
      countries: [],
      sectors: [],
      stagePreferences: [],
    };
    expect(deterministicSemanticProxy(emptyMandate, PERFECT_OPPORTUNITY)).toBe(0);
    const overlap = deterministicSemanticProxy(MANDATE, PERFECT_OPPORTUNITY);
    expect(overlap).toBeGreaterThanOrEqual(0);
    expect(overlap).toBeLessThanOrEqual(1);
  });
});

describe('score — the LLM never invents the number', () => {
  test('the same inputs always produce the same score (pure, deterministic)', () => {
    const a = score(MANDATE, PERFECT_OPPORTUNITY);
    const b = score(MANDATE, PERFECT_OPPORTUNITY);
    expect(a).toEqual(b);
  });

  test('custom weights change the total without touching component scores', () => {
    const skewed = {
      ...DEFAULT_WEIGHTS,
      country: 1,
      sector: 0,
      chequeSize: 0,
      stage: 0,
      risk: 0,
      horizon: 0,
      targetReturn: 0,
      liquidity: 0,
      governance: 0,
      impact: 0,
      semantic: 0,
    };
    const result = score(MANDATE, { ...PERFECT_OPPORTUNITY, country: 'Barbados' }, skewed);
    expect(result.componentScores.country).toBe(0);
    expect(result.score).toBe(0); // weight is entirely on the zeroed component
  });
});
