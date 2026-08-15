import { describe, expect, test } from 'bun:test';
import { type PipelineCandidate, runProposalPipeline } from './pipeline';

/**
 * The three-specialist pipeline, deterministically. What matters: research
 * ranks gentlest-first and honours the quiet set; suitability keeps every
 * verdict including the losers'; coordination appears only when something was
 * chosen and always routes to an approval; and the trace tells the story a
 * person could actually check.
 */

const fmt = (minor: bigint) => `US$${(Number(minor) / 100).toLocaleString('en-US')}`;

const c = (
  id: string,
  risk: 'low' | 'medium' | 'high',
  minMinor: bigint,
  name = id,
): PipelineCandidate => ({
  instrumentId: id,
  name,
  partnerName: 'Sagicor Investments',
  risk,
  minInvestmentMinor: minMinor,
  currency: 'USD',
});

describe('proposal pipeline', () => {
  test('research ranks gentlest-first and the first fit wins screening', async () => {
    const gated: string[] = [];
    const outcome = await runProposalPipeline({
      candidates: [
        c('spicy', 'high', 100_000n),
        c('mild', 'low', 250_000n),
        c('mid', 'medium', 50_000n),
      ],
      excluded: new Set(),
      fmt,
      gate: (cand) => {
        gated.push(cand.instrumentId);
        return { decision: 'requires_approval', code: 'above_auto_invest' };
      },
    });
    // Lowest risk screened first despite the larger minimum.
    expect(gated[0]).toBe('mild');
    expect(outcome.chosen?.candidate.instrumentId).toBe('mild');
    // First fit stops the screening — no need to gate the rest.
    expect(gated).toHaveLength(1);
    expect(outcome.trace.map((t) => t.stage)).toEqual(['research', 'suitability', 'coordination']);
    expect(outcome.trace[2]?.summary).toContain('approval');
  });

  test('rejections stay on the record and the next candidate is tried', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund'), c('b', 'low', 200n, 'Beta Bond')],
      excluded: new Set(),
      fmt,
      gate: (cand) =>
        cand.instrumentId === 'a'
          ? { decision: 'blocked', reasons: ['Below your cash floor'] }
          : { decision: 'auto_act', code: 'within_limits' },
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('b');
    const suitability = outcome.trace.find((t) => t.stage === 'suitability');
    expect(suitability?.detail.join('\n')).toContain(
      'Alpha Fund: does not fit — Below your cash floor',
    );
    expect(suitability?.detail.join('\n')).toContain('Beta Bond: fits');
    // Even an auto-act verdict routes to an approval on this path.
    expect(outcome.trace[2]?.detail.join('\n')).toContain('approval card');
  });

  test('the quiet set is honoured and an empty outcome still explains itself', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('resting', 'low', 100n)],
      excluded: new Set(['resting']),
      fmt,
      gate: () => {
        throw new Error('nothing should reach the gate');
      },
    });
    expect(outcome.chosen).toBeNull();
    expect(outcome.trace).toHaveLength(2); // no coordination stage without a choice
    expect(outcome.trace[0]?.summary).toContain('resting after a recent proposal');
    expect(outcome.trace[1]?.summary).toContain('Nothing reached screening');
  });
});
