import { describe, expect, test } from 'bun:test';
import type { RiskBand } from './suitability';
import { MIX_KEYS, TARGET_MIX, allocationGaps, mixKeyFor } from './target-mix';

/**
 * The target mixes are policy data — the one table a compliance review reads
 * to answer "what combination is this band steered toward". Every band must
 * account for exactly 100% of a portfolio, and the gap math must rank the
 * largest shortfall first.
 */

describe('target mix policy', () => {
  test('every band sums to exactly 100 points', () => {
    for (const [band, mix] of Object.entries(TARGET_MIX)) {
      const total = MIX_KEYS.reduce((sum, k) => sum + mix[k], 0);
      expect(`${band}:${total}`).toBe(`${band}:100`);
    }
  });

  test('risk appetite moves money out of cash and bonds into growth', () => {
    expect(TARGET_MIX.low.bond).toBeGreaterThan(TARGET_MIX.high.bond);
    expect(TARGET_MIX.high.equity).toBeGreaterThan(TARGET_MIX.low.equity);
    expect(TARGET_MIX.low.private).toBe(0);
  });

  test('mixKeyFor maps holdings honestly: null is cash, unknown is nothing', () => {
    expect(mixKeyFor(null)).toBe('cash');
    expect(mixKeyFor('bond')).toBe('bond');
    expect(mixKeyFor('Bond')).toBe('bond');
    expect(mixKeyFor('crypto')).toBeNull();
  });

  test('allocationGaps ranks the largest shortfall first, over-target negative', () => {
    const band: RiskBand = 'high_moderate'; // target: bond 30, cash 10 …
    const gaps = allocationGaps({ cash: 100 }, band);
    expect(gaps[0]?.key).toBe('bond');
    expect(gaps[0]?.gapPts).toBe(30);
    const cash = gaps.find((g) => g.key === 'cash');
    expect(cash?.gapPts).toBe(-90);
  });
});
