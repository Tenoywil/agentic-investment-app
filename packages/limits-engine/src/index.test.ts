import { expect, describe as group, test } from 'bun:test';
import {
  type EngineInput,
  type EngineInstrument,
  type EngineLimits,
  type EnginePortfolio,
  evaluate,
} from './index';

/** Prototype defaults (from the `limits` table): US$500 auto / US$1,000 floor
 *  & approval / 30 bps / 15% single-position / daily cap off. */
const LIMITS: EngineLimits = {
  autoInvestCapMinor: 50_000n, // US$500
  autoInvestEnabled: true,
  cashFloorMinor: 100_000n, // US$1,000
  cashFloorEnabled: true,
  fxSpreadMaxBps: 30,
  fxSpreadEnabled: true,
  requireApprovalAboveMinor: 100_000n, // US$1,000
  requireApprovalEnabled: true,
  singlePositionMaxPct: 15,
  singlePositionEnabled: true,
  dailyCapMinor: null,
  dailyCapEnabled: false,
};

/** Roomy portfolio so unrelated checks never trip in a focused test. */
const PORTFOLIO: EnginePortfolio = {
  cashMinor: 5_000_000n, // US$50,000 cash
  portfolioTotalMinor: 10_000_000n, // US$100,000
  currentPositionMinor: 0n,
  spentTodayMinor: 0n,
};

const LOW: EngineInstrument = {
  risk: 'low',
  minInvestmentMinor: 10_000n,
  blocked: false,
  blockReasons: [],
};

function makeInput(over: {
  amountMinor?: bigint;
  instrument?: Partial<EngineInstrument>;
  limits?: Partial<EngineLimits>;
  portfolio?: Partial<EnginePortfolio>;
  band?: EngineInput['band'];
  isFxTransfer?: boolean;
  fxSpreadBps?: number;
}): EngineInput {
  return {
    proposal: {
      amountMinor: over.amountMinor ?? 40_000n,
      currency: 'USD',
      instrument: { ...LOW, ...over.instrument },
      isFxTransfer: over.isFxTransfer ?? false,
      fxSpreadBps: over.fxSpreadBps ?? 0,
    },
    limits: { ...LIMITS, ...over.limits },
    portfolio: { ...PORTFOLIO, ...over.portfolio },
    band: over.band ?? 'high',
  };
}

group('auto_act — fully in limits', () => {
  test('a US$400 idle-cash sweep of a low-risk fund auto-acts', () => {
    const d = evaluate(makeInput({ amountMinor: 40_000n }));
    expect(d.decision).toBe('auto_act');
    expect(d.code).toBe('in_limit');
  });

  test('exactly at the auto-invest cap still auto-acts', () => {
    expect(evaluate(makeInput({ amountMinor: 50_000n })).decision).toBe('auto_act');
  });
});

group('requires_approval', () => {
  test('above the auto-invest cap but under the approval threshold', () => {
    const d = evaluate(makeInput({ amountMinor: 60_000n }));
    expect(d.decision).toBe('requires_approval');
    expect(d.code).toBe('above_auto_invest');
  });

  test('one minor unit over the auto-invest cap escalates', () => {
    expect(evaluate(makeInput({ amountMinor: 50_001n })).decision).toBe('requires_approval');
  });

  test('above the require-approval threshold', () => {
    const d = evaluate(makeInput({ amountMinor: 150_000n }));
    expect(d.decision).toBe('requires_approval');
    expect(d.code).toBe('above_approval_threshold');
  });

  test('auto-invest disabled means every in-limit move still asks', () => {
    const d = evaluate(makeInput({ amountMinor: 40_000n, limits: { autoInvestEnabled: false } }));
    expect(d.decision).toBe('requires_approval');
    expect(d.code).toBe('above_auto_invest');
  });
});

group('FX-spread guardrail (held for review)', () => {
  test('spread above the guardrail escalates to approval', () => {
    const d = evaluate(makeInput({ amountMinor: 40_000n, isFxTransfer: true, fxSpreadBps: 40 }));
    expect(d.decision).toBe('requires_approval');
    expect(d.code).toBe('fx_spread_review');
  });

  test('spread exactly at the guardrail is allowed through', () => {
    const d = evaluate(makeInput({ amountMinor: 40_000n, isFxTransfer: true, fxSpreadBps: 30 }));
    expect(d.decision).toBe('auto_act');
  });

  test('non-FX moves ignore the spread entirely', () => {
    const d = evaluate(makeInput({ amountMinor: 40_000n, isFxTransfer: false, fxSpreadBps: 999 }));
    expect(d.decision).toBe('auto_act');
  });

  test('disabling the guardrail skips the check', () => {
    const d = evaluate(
      makeInput({
        amountMinor: 40_000n,
        isFxTransfer: true,
        fxSpreadBps: 999,
        limits: { fxSpreadEnabled: false },
      }),
    );
    expect(d.decision).toBe('auto_act');
  });
});

group('blocked — hard stops', () => {
  test('a screened-out instrument returns its curated reasons (the Beachfront note)', () => {
    const reasons = [
      'High risk: your profile is balanced-income; this is a speculative development note',
      'Size: the US$25,000 minimum is 80% of your portfolio, far above your 15% single-position cap',
    ];
    const d = evaluate(
      makeInput({ amountMinor: 2_500_000n, instrument: { blocked: true, blockReasons: reasons } }),
    );
    expect(d.decision).toBe('blocked');
    expect(d.code).toBe('instrument_blocked');
    if (d.decision === 'blocked') expect(d.reasons).toEqual(reasons);
  });

  test('below the instrument minimum', () => {
    const d = evaluate(
      makeInput({ amountMinor: 5_000n, instrument: { minInvestmentMinor: 10_000n } }),
    );
    expect(d.decision).toBe('blocked');
    expect(d.code).toBe('below_minimum');
  });

  test('unsuitable: high-risk instrument for a high_moderate band', () => {
    const d = evaluate(
      makeInput({ amountMinor: 40_000n, instrument: { risk: 'high' }, band: 'high_moderate' }),
    );
    expect(d.decision).toBe('blocked');
    expect(d.code).toBe('unsuitable');
  });

  test('a high band admits a high-risk instrument (not blocked by suitability)', () => {
    const d = evaluate(
      makeInput({ amountMinor: 40_000n, instrument: { risk: 'high' }, band: 'high' }),
    );
    expect(d.decision).not.toBe('blocked');
  });

  test('cash floor: a move that would breach the floor is blocked', () => {
    const d = evaluate(makeInput({ amountMinor: 150_000n, portfolio: { cashMinor: 215_000n } }));
    expect(d.decision).toBe('blocked');
    expect(d.code).toBe('cash_floor');
  });

  test('cash floor boundary: leaving exactly the floor passes the floor check', () => {
    // cash 215,000 − 115,000 = 100,000 == floor → floor OK; amount > approval → asks.
    const d = evaluate(makeInput({ amountMinor: 115_000n, portfolio: { cashMinor: 215_000n } }));
    expect(d.decision).toBe('requires_approval');
    expect(d.code).toBe('above_approval_threshold');
  });

  test('cash floor disabled skips the check', () => {
    const d = evaluate(
      makeInput({
        amountMinor: 150_000n,
        portfolio: { cashMinor: 215_000n },
        limits: { cashFloorEnabled: false },
      }),
    );
    expect(d.decision).not.toBe('blocked');
  });

  test('single-position cap: over 15% is blocked', () => {
    const d = evaluate(
      makeInput({
        amountMinor: 50_000n,
        portfolio: { portfolioTotalMinor: 100_000n, cashMinor: 5_000_000n },
      }),
    );
    expect(d.decision).toBe('blocked');
    expect(d.code).toBe('single_position');
  });

  test('single-position boundary: exactly 15% passes, one unit over fails', () => {
    // 85X = 15T at X=15,000 → T=85,000; portfolioAfter=100,000; 15,000 == 15%.
    const at = evaluate(
      makeInput({ amountMinor: 15_000n, portfolio: { portfolioTotalMinor: 85_000n } }),
    );
    expect(at.decision).toBe('auto_act');
    const over = evaluate(
      makeInput({ amountMinor: 15_001n, portfolio: { portfolioTotalMinor: 85_000n } }),
    );
    expect(over.decision).toBe('blocked');
    expect(over.code).toBe('single_position');
  });

  test('daily cap: over the cap is blocked; disabled by default', () => {
    const on = evaluate(
      makeInput({
        amountMinor: 30_000n,
        limits: { dailyCapEnabled: true, dailyCapMinor: 100_000n },
        portfolio: { spentTodayMinor: 80_000n },
      }),
    );
    expect(on.decision).toBe('blocked');
    expect(on.code).toBe('daily_cap');

    const boundary = evaluate(
      makeInput({
        amountMinor: 30_000n,
        limits: { dailyCapEnabled: true, dailyCapMinor: 100_000n },
        portfolio: { spentTodayMinor: 70_000n }, // 100,000 == cap → allowed
      }),
    );
    expect(boundary.decision).toBe('auto_act');
  });
});

group('ordering — the first decisive check wins', () => {
  test('a blocked instrument beats a below-minimum amount', () => {
    const d = evaluate(
      makeInput({
        amountMinor: 1n,
        instrument: { blocked: true, blockReasons: ['nope'], minInvestmentMinor: 10_000n },
      }),
    );
    expect(d.code).toBe('instrument_blocked');
  });

  test('cash floor is evaluated before the approval threshold', () => {
    // Amount both breaches the floor and exceeds the approval threshold → floor wins.
    const d = evaluate(makeInput({ amountMinor: 200_000n, portfolio: { cashMinor: 215_000n } }));
    expect(d.code).toBe('cash_floor');
  });

  test('suitability is evaluated before the numeric guardrails', () => {
    const d = evaluate(
      makeInput({
        amountMinor: 40_000n,
        instrument: { risk: 'high' },
        band: 'low',
        portfolio: { cashMinor: 0n },
      }),
    );
    expect(d.code).toBe('unsuitable');
  });
});
