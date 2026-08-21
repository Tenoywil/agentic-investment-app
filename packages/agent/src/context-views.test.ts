import { describe, expect, test } from 'bun:test';
import { buildContext } from './context';
import { sampleSnapshot } from './eval-fixtures';

/**
 * The display views and the chat's dedupe discipline. What matters: the
 * allocation view carries the band's target mix and honest gaps (a 0% bucket
 * with a 30% target IS the finding); goals report real funding percentages;
 * fit and comparison expose numbers a chart can draw; and the chat can
 * neither re-propose something already pending nor re-scout something held
 * or quiet.
 */

describe('allocation view', () => {
  test('carries current, target and gap per type — including empty buckets', () => {
    const view = buildContext(sampleSnapshot()).getAllocation();
    expect(view.band).toBe('high_moderate');

    const cash = view.byType.find((s) => s.key === 'cash');
    // US$8,000 of US$28,600 ≈ 28%, against a 10% target → over by ~18 pts.
    expect(cash?.pct).toBeGreaterThan(27);
    expect(cash?.targetPct).toBe(10);
    expect(cash?.gapPts).toBeLessThan(-17);

    // No bonds held (positions carry none) against a 30% target: the gap is
    // the point, so the empty bucket must be present, not hidden.
    const bond = view.byType.find((s) => s.key === 'bond');
    expect(bond?.pct).toBe(0);
    expect(bond?.targetPct).toBe(30);
    expect(bond?.gapPts).toBe(30);
  });

  test('slices carry minor units and formatted money both', () => {
    const view = buildContext(sampleSnapshot()).getAllocation();
    const cash = view.byType.find((s) => s.key === 'cash');
    expect(cash?.valueMinor).toBe('800000');
    expect(cash?.value).toBe('US$8,000');
    expect(view.byCurrency.some((s) => s.key === 'USD')).toBe(true);
  });
});

describe('goals view', () => {
  test('reports funding percentage from the amounts', () => {
    const { goals } = buildContext(sampleSnapshot()).getGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0]?.pct).toBe(37.5); // US$15,000 of US$40,000
    expect(goals[0]?.eta).toContain('2028');
  });
});

describe('fit and comparison views', () => {
  test('score_fit returns the score with its sentences', () => {
    const fit = buildContext(sampleSnapshot()).scoreFit({ instrumentId: 'mmf' });
    expect(fit.name).toContain('Money Market');
    expect(fit.score).toBeGreaterThan(0);
    expect(fit.reasons.length + fit.concerns.length).toBeGreaterThan(0);
  });

  test('comparison rows align the facts and the fit score', () => {
    const { rows } = buildContext(sampleSnapshot()).compareOpportunities({
      instrumentIds: ['mmf', 'goj'],
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.minimum).toContain('US$');
      expect(row.fitScore).toBeGreaterThanOrEqual(0);
      expect(typeof row.suitable).toBe('boolean');
    }
  });
});

describe('chat dedupe discipline', () => {
  test('proposeMove refuses an instrument whose card is already waiting', () => {
    const snap = sampleSnapshot();
    snap.activity.approvals = [
      {
        id: 'approval-mmf',
        title: 'NCB USD Money Market Fund · US$500',
        instrumentId: 'mmf',
        amountMinor: 50_000n,
        currency: 'USD',
        createdAt: '2026-08-15T09:00:00.000Z',
      },
    ];
    const proposal = buildContext(snap).proposeMove({ instrumentId: 'mmf', amountMinor: 50_000 });
    expect(proposal.decision).toBe('blocked');
    expect(proposal.code).toBe('already_pending');
    expect(proposal.summary).toContain('already waiting in your approvals');
  });

  test('scoutMarketplace never re-proposes quiet or held instruments', async () => {
    const snap = sampleSnapshot();
    // Quiet: mmf (a recent card). Held: sig. Only goj should survive as the
    // gentle viable candidate (syg is high-risk but still a candidate — the
    // band gate screens it).
    snap.quietInstrumentIds = ['mmf'];
    const scout = await buildContext(snap).scoutMarketplace();
    expect(scout.proposal?.instrumentId).not.toBe('mmf');
    expect(scout.proposal?.instrumentId).not.toBe('sig');
    expect(scout.proposal?.diasporaComparison).toMatch(/US, Canadian or UK/);
    expect(scout.proposal?.diasporaComparison).toContain('not automatically better');
    const research = scout.trace.find((t) => t.stage === 'research');
    expect(research?.summary).toContain('resting after a recent proposal');
  });
});
