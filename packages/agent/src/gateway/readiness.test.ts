import { describe, expect, test } from 'bun:test';
import { type ReadinessClaim, computeReadinessScore } from './readiness';

const claim = (over: Partial<ReadinessClaim>): ReadinessClaim => ({
  category: 'financial',
  evidenceStatus: 'verified',
  ...over,
});

describe('computeReadinessScore — the LLM never invents the number', () => {
  test('no claims at all scores 0, not NaN, and names every missing category', () => {
    const result = computeReadinessScore([]);
    expect(result.score).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
    expect(result.criticalMissingItems).toEqual([
      'no financial evidence provided',
      'no market evidence provided',
      'no team evidence provided',
    ]);
    expect(result.hasContradictedEvidence).toBe(false);
  });

  test('all-verified claims across every required category score 100 with nothing missing', () => {
    const result = computeReadinessScore([
      claim({ category: 'financial', evidenceStatus: 'verified' }),
      claim({ category: 'market', evidenceStatus: 'verified' }),
      claim({ category: 'team', evidenceStatus: 'verified' }),
    ]);
    expect(result.score).toBe(100);
    expect(result.criticalMissingItems).toEqual([]);
  });

  test('same inputs always produce the same result (pure, deterministic)', () => {
    const claims = [
      claim({ evidenceStatus: 'self_reported' }),
      claim({ evidenceStatus: 'unverified' }),
    ];
    expect(computeReadinessScore(claims)).toEqual(computeReadinessScore(claims));
  });
});

describe('computeReadinessScore — status weights', () => {
  test('partially_verified averages between verified and self_reported', () => {
    const result = computeReadinessScore([claim({ evidenceStatus: 'partially_verified' })]);
    expect(result.score).toBe(60);
  });

  test('self_reported scores modestly, not zero', () => {
    const result = computeReadinessScore([claim({ evidenceStatus: 'self_reported' })]);
    expect(result.score).toBe(30);
  });

  test('unverified scores near-zero but not negative', () => {
    const result = computeReadinessScore([claim({ evidenceStatus: 'unverified' })]);
    expect(result.score).toBe(10);
  });

  test('a single contradicted claim among otherwise-verified claims pulls the average down hard', () => {
    const result = computeReadinessScore([
      claim({ evidenceStatus: 'verified' }),
      claim({ evidenceStatus: 'verified' }),
      claim({ evidenceStatus: 'contradicted' }),
    ]);
    // (1 + 1 - 1) / 3 = 0.333 -> 33
    expect(result.score).toBe(33);
    expect(result.hasContradictedEvidence).toBe(true);
  });

  test('score is clamped to [0, 100] even when contradictions dominate', () => {
    const result = computeReadinessScore([
      claim({ evidenceStatus: 'contradicted' }),
      claim({ evidenceStatus: 'contradicted' }),
    ]);
    expect(result.score).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('computeReadinessScore — critical missing items', () => {
  test('names exactly the categories with no claims, regardless of evidence quality elsewhere', () => {
    const result = computeReadinessScore([
      claim({ category: 'financial', evidenceStatus: 'verified' }),
      claim({ category: 'other', evidenceStatus: 'verified' }),
    ]);
    expect(result.criticalMissingItems).toEqual([
      'no market evidence provided',
      'no team evidence provided',
    ]);
  });

  test('a claim with a null category does not count toward any required category', () => {
    const result = computeReadinessScore([claim({ category: null, evidenceStatus: 'verified' })]);
    expect(result.criticalMissingItems).toEqual([
      'no financial evidence provided',
      'no market evidence provided',
      'no team evidence provided',
    ]);
  });

  test('duplicate claims in the same category still only clear that one requirement', () => {
    const result = computeReadinessScore([
      claim({ category: 'financial', evidenceStatus: 'verified' }),
      claim({ category: 'financial', evidenceStatus: 'self_reported' }),
    ]);
    expect(result.criticalMissingItems).toEqual([
      'no market evidence provided',
      'no team evidence provided',
    ]);
  });
});
