import { expect, describe as group, test } from 'bun:test';
import { buildContext } from './context';
import { sampleSnapshot } from './eval-fixtures';

/**
 * Agent-eval golden set (deterministic — no live model). Exercises the read/
 * propose tools' behavior: suitability, blocked-deal detection, and that
 * propose_move surfaces the Limits Engine verdict truthfully.
 */
const ctx = buildContext(sampleSnapshot());

group('read tools', () => {
  test('get_portfolio reports formatted net worth and cash', () => {
    const p = ctx.getPortfolio();
    expect(p.netWorth).toBe('US$28,600');
    expect(p.cash).toBe('US$8,000');
    expect(p.holdings.length).toBe(3);
  });

  test('get_limits surfaces enabled guardrails', () => {
    const l = ctx.getLimits();
    expect(l.autoInvest).toBe('US$500');
    expect(l.cashFloor).toBe('US$1,000');
    expect(l.singlePositionMaxPct).toBe(15);
    expect(l.dailyCap).toBeNull(); // disabled
  });

  test('search_opportunities filters by type and risk, and flags screen-outs', () => {
    expect(ctx.searchOpportunities({ type: 'bond' }).map((o) => o.slug)).toEqual(['goj32']);
    const lowOnly = ctx.searchOpportunities({ maxRisk: 'low' });
    expect(lowOnly.every((o) => o.risk === 'low')).toBe(true);
    const all = ctx.searchOpportunities({});
    const villa = all.find((o) => o.slug === 'slbd');
    expect(villa?.screenedOut).toBe(true); // listed, not hidden
    expect(villa?.suitable).toBe(false);
  });

  test('search_opportunities free-text query matches name/region', () => {
    expect(ctx.searchOpportunities({ query: 'money market' }).map((o) => o.slug)).toEqual([
      'ncbmm',
    ]);
  });
});

group('suitability golden set (band high_moderate)', () => {
  test('low- and medium-risk instruments are suitable; high-risk is not', () => {
    expect(ctx.scoreSuitability({ instrumentId: 'goj' }).suitable).toBe(true); // low
    expect(ctx.scoreSuitability({ instrumentId: 'sig' }).suitable).toBe(true); // medium
    expect(ctx.scoreSuitability({ instrumentId: 'syg' }).suitable).toBe(false); // high
  });

  test('a screened-out instrument is never suitable and says so', () => {
    const s = ctx.scoreSuitability({ instrumentId: 'villa' });
    expect(s.suitable).toBe(false);
    expect(s.note).toMatch(/screened out/i);
  });
});

group('propose_move — the verdict is the Limits Engine, surfaced honestly', () => {
  test('a small low-risk sweep is auto-act (still requires human approval to execute)', () => {
    const p = ctx.proposeMove({ instrumentId: 'mmf', amountMinor: 40_000 });
    expect(p.decision).toBe('auto_act');
    expect(p.requiresHumanApproval).toBe(true);
  });

  test('above the approval threshold requires approval', () => {
    const p = ctx.proposeMove({ instrumentId: 'goj', amountMinor: 150_000 });
    expect(p.decision).toBe('requires_approval');
  });

  test('blocked-deal detection: the villa note is blocked with its reasons', () => {
    const p = ctx.proposeMove({ instrumentId: 'villa', amountMinor: 2_500_000 });
    expect(p.decision).toBe('blocked');
    expect(p.code).toBe('instrument_blocked');
    expect(p.reasons.length).toBe(4);
    expect(p.summary).toMatch(/will not prepare/i);
  });

  test('below the instrument minimum is blocked', () => {
    const p = ctx.proposeMove({ instrumentId: 'goj', amountMinor: 5_000 });
    expect(p.decision).toBe('blocked');
    expect(p.code).toBe('below_minimum');
  });

  test('an unknown instrument is refused, not invented', () => {
    const p = ctx.proposeMove({ instrumentId: 'does-not-exist', amountMinor: 1000 });
    expect(p.decision).toBe('blocked');
  });
});

group('explain', () => {
  test('safety explanation states CCN never holds money or executes', () => {
    expect(ctx.explain({ topic: 'safety' }).explanation).toMatch(/never holds|never executes/i);
  });
});
