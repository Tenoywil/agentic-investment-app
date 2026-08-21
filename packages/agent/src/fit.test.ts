import { describe, expect, test } from 'bun:test';
import {
  type FitInput,
  assessPortfolioFit,
  buildDiasporaComparison,
  parseEtaMonths,
  parseTermMonths,
} from './fit';

/**
 * The Portfolio Fit agent, deterministically. What matters: a first exposure
 * diversifies and a duplicate deepens; concentration at one firm or in one
 * type is named with its number; a currency mismatch is a concern in the
 * currency the person actually reads; money locked past a dated goal's
 * horizon is caught; and every score movement leaves a sentence a person can
 * check.
 */

const NOW = new Date('2026-08-16T00:00:00Z');

const base = (over?: Partial<FitInput>): FitInput => ({
  candidate: {
    instrumentId: 'bond-1',
    name: 'GOJ USD Global Bond',
    type: 'bond',
    region: 'Jamaica',
    currency: 'USD',
    partnerName: 'NCB Capital',
    term: '8 yr · USD',
    minInvestmentMinor: 50_000n,
  },
  portfolio: {
    displayCurrency: 'USD',
    cashMinor: 500_000n,
    netWorthMinor: 500_000n,
    positions: [
      { instrumentId: null, name: 'Cash', valueMinor: 500_000n, type: null, partnerName: null },
    ],
  },
  goals: [],
  now: NOW,
  ...over,
});

describe('term and eta parsing', () => {
  test('parses years and months, refuses to guess the rest', () => {
    expect(parseTermMonths('8 yr · USD')).toBe(96);
    expect(parseTermMonths('5 yr')).toBe(60);
    expect(parseTermMonths('18 months')).toBe(18);
    expect(parseTermMonths('Open-ended')).toBeNull();
    expect(parseTermMonths('Equity')).toBeNull();
    expect(parseTermMonths(null)).toBeNull();
  });

  test('reads a year out of a free-text goal eta', () => {
    expect(parseEtaMonths('On track · mid-2028', NOW)).toBe(22); // to mid-2028
    expect(parseEtaMonths('Projected 2044', NOW)).toBeGreaterThan(200);
    expect(parseEtaMonths('Complete', NOW)).toBeNull();
    expect(parseEtaMonths(null, NOW)).toBeNull();
    // A year already behind us clamps to zero, it does not go negative.
    expect(parseEtaMonths('2020', NOW)).toBe(0);
  });
});

describe('portfolio fit', () => {
  test('a first exposure of a new type on a cash portfolio scores high, with reasons', () => {
    const fit = assessPortfolioFit(base());
    expect(fit.score).toBeGreaterThanOrEqual(90);
    expect(fit.reasons.join(' ')).toContain('first bond exposure');
    expect(fit.reasons.join(' ')).toContain('% of your cash');
    expect(fit.concerns).toHaveLength(0);
  });

  test('holding the same instrument already is a concern, not a diversification', () => {
    const fit = assessPortfolioFit(
      base({
        portfolio: {
          displayCurrency: 'USD',
          cashMinor: 300_000n,
          netWorthMinor: 500_000n,
          positions: [
            {
              instrumentId: null,
              name: 'Cash',
              valueMinor: 300_000n,
              type: null,
              partnerName: null,
            },
            {
              instrumentId: 'bond-1',
              name: 'GOJ USD Global Bond',
              valueMinor: 200_000n,
              type: 'bond',
              partnerName: 'NCB Capital',
            },
          ],
        },
      }),
    );
    expect(fit.concerns.join(' ')).toContain('already hold');
    expect(fit.score).toBeLessThan(assessPortfolioFit(base()).score);
  });

  test('concentration at one firm is named with its number', () => {
    const fit = assessPortfolioFit(
      base({
        portfolio: {
          displayCurrency: 'USD',
          cashMinor: 100_000n,
          netWorthMinor: 1_000_000n,
          positions: [
            {
              instrumentId: null,
              name: 'Cash',
              valueMinor: 100_000n,
              type: null,
              partnerName: null,
            },
            {
              instrumentId: 'fund-9',
              name: 'NCB Money Market',
              valueMinor: 900_000n,
              type: 'fund',
              partnerName: 'NCB Capital',
            },
          ],
        },
      }),
    );
    expect(fit.concerns.join(' ')).toContain('90% of your portfolio already sits at NCB Capital');
  });

  test('a currency mismatch against the display currency is a concern', () => {
    const fit = assessPortfolioFit(
      base({
        candidate: { ...base().candidate, currency: 'JMD' },
      }),
    );
    expect(fit.concerns.join(' ')).toContain('Priced in JMD while your portfolio reads in USD');
  });

  test('locking money past a dated goal the remaining cash cannot cover is caught', () => {
    const fit = assessPortfolioFit(
      base({
        // 8-year term vs. a mid-2028 goal still missing US$4,800 — and after
        // the US$500 buy only US$4,500 of cash remains.
        goals: [
          {
            name: 'House deposit',
            targetMinor: 1_000_000n,
            currentMinor: 520_000n,
            eta: 'mid-2028',
          },
        ],
      }),
    );
    expect(fit.concerns.join(' ')).toContain('runs past your "House deposit" goal');
  });

  test('an open-ended term never triggers the goal-liquidity concern', () => {
    const fit = assessPortfolioFit(
      base({
        candidate: { ...base().candidate, term: 'Open-ended' },
        goals: [
          {
            name: 'House deposit',
            targetMinor: 1_000_000n,
            currentMinor: 520_000n,
            eta: 'mid-2028',
          },
        ],
      }),
    );
    expect(fit.concerns.join(' ')).not.toContain('runs past');
  });

  test('a minimum that swallows most of the cash is a concern', () => {
    const fit = assessPortfolioFit(
      base({
        candidate: { ...base().candidate, minInvestmentMinor: 400_000n },
      }),
    );
    expect(fit.concerns.join(' ')).toContain('80% of your cash in one move');
  });

  test('closing the band target-mix gap is a named reason', () => {
    // high_moderate targets 30% bonds; a cash-only portfolio is 30 points
    // under, and this bond is the move that closes it.
    const fit = assessPortfolioFit(base({ band: 'high_moderate' }));
    expect(fit.reasons.join(' ')).toContain('biggest allocation gap');
    expect(fit.score).toBeGreaterThan(assessPortfolioFit(base()).score);
  });

  test('deepening an over-target bucket is a named concern', () => {
    const fit = assessPortfolioFit(
      base({
        band: 'low', // bonds target 50%
        portfolio: {
          displayCurrency: 'USD',
          cashMinor: 50_000n,
          netWorthMinor: 1_000_000n,
          positions: [
            {
              instrumentId: null,
              name: 'Cash',
              valueMinor: 50_000n,
              type: null,
              partnerName: null,
            },
            {
              instrumentId: 'bond-2',
              name: 'Barbados Treasury Note',
              valueMinor: 950_000n,
              type: 'bond',
              partnerName: 'Barita',
            },
          ],
        },
      }),
    );
    expect(fit.concerns.join(' ')).toContain("over your band's bond target");
  });

  test('score stays clamped to 0..100', () => {
    const best = assessPortfolioFit(base());
    expect(best.score).toBeLessThanOrEqual(100);
    const worst = assessPortfolioFit(
      base({
        candidate: {
          ...base().candidate,
          currency: 'JMD',
          minInvestmentMinor: 450_000n,
        },
        portfolio: {
          displayCurrency: 'USD',
          cashMinor: 500_000n,
          netWorthMinor: 5_000_000n,
          positions: [
            {
              instrumentId: null,
              name: 'Cash',
              valueMinor: 500_000n,
              type: null,
              partnerName: null,
            },
            {
              instrumentId: 'bond-1',
              name: 'GOJ USD Global Bond',
              valueMinor: 4_500_000n,
              type: 'bond',
              partnerName: 'NCB Capital',
            },
          ],
        },
        goals: [{ name: 'Tuition', targetMinor: 2_000_000n, currentMinor: 100_000n, eta: '2027' }],
      }),
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(best.score);
    expect(worst.concerns.length).toBeGreaterThanOrEqual(3);
  });

  test('builds an honest like-for-like diaspora comparison without invented market data', () => {
    const comparison = buildDiasporaComparison(base().candidate);
    expect(comparison).toContain('US, Canadian or UK bond');
    expect(comparison).toContain('Jamaica exposure');
    expect(comparison).toContain('USD currency risk');
    expect(comparison).toContain('not automatically better');
    expect(comparison).toMatch(/fees.*tax.*liquidity.*investor protections/i);
    expect(comparison).not.toMatch(/\d+(?:\.\d+)?%/);
  });
});
