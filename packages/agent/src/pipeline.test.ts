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
      'Alpha Fund: does not fit: Below your cash floor',
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

/**
 * The injected specialists — research signal, portfolio fit, sizing policy.
 * All optional (the tests above prove the caller that passes none is
 * untouched); with them, ranking runs on conviction, contradicted evidence is
 * a veto, low conviction is passed over even when the limits fit, and any
 * size above the minimum is re-gated before it is proposed.
 */
describe('proposal pipeline with research, fit and sizing', () => {
  const fitOf = (score: number, concerns: string[] = []) => ({
    score,
    reasons: score >= 60 ? ['Diversifies your portfolio.'] : [],
    concerns,
  });

  test('conviction (research × fit) outranks gentlest-first, and the fit stage joins the trace', async () => {
    const outcome = await runProposalPipeline({
      // Gentlest-first would pick lowRisk; conviction picks the researched,
      // better-fitting medium-risk fund instead.
      candidates: [
        c('lowRisk', 'low', 100n, 'Sleepy Bond'),
        c('strong', 'medium', 200n, 'Solid Fund'),
      ],
      excluded: new Set(),
      fmt,
      research: (cand) =>
        cand.instrumentId === 'strong'
          ? { confidence: 90, missing: [], contradicted: false }
          : { confidence: 30, missing: ['no issuer evidence found'], contradicted: false },
      fit: (cand) => fitOf(cand.instrumentId === 'strong' ? 90 : 60),
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('strong');
    expect(outcome.trace.map((t) => t.stage)).toEqual([
      'research',
      'fit',
      'suitability',
      'coordination',
    ]);
    expect(outcome.trace[0]?.summary).toContain('strongest conviction first');
    expect(outcome.trace[0]?.detail.join('\n')).toContain('research confidence 90/100');
    expect(outcome.trace[1]?.detail.join('\n')).toContain('Solid Fund: fit 90/100');
    // The chosen record carries what decided it.
    expect(outcome.chosen?.research?.confidence).toBe(90);
    expect(outcome.chosen?.fit?.score).toBe(90);
  });

  test("the research stage cites the dossier's claims as sources", async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('cited', 'low', 100n, 'Cited Fund')],
      excluded: new Set(),
      fmt,
      research: () => ({
        confidence: 80,
        missing: [],
        contradicted: false,
        sources: [
          {
            category: 'returns',
            label: 'Stated yield',
            value: '7.5% per year',
            status: 'self_reported',
            detail: 'Only the listing asserts it',
          },
        ],
      }),
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
    });
    const research = outcome.trace.find((t) => t.stage === 'research');
    expect(research?.sources?.[0]?.name).toBe('Cited Fund');
    expect(research?.sources?.[0]?.claims[0]?.status).toBe('self_reported');
    expect(research?.sources?.[0]?.claims[0]?.value).toContain('7.5%');
  });

  test('a signal without sources leaves the trace citation-free, not empty-cited', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('bare', 'low', 100n, 'Bare Fund')],
      excluded: new Set(),
      fmt,
      research: () => ({ confidence: 80, missing: [], contradicted: false }),
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
    });
    expect(outcome.trace.find((t) => t.stage === 'research')?.sources).toBeUndefined();
  });

  test('contradicted evidence is a veto, named in the trace, not a discount', async () => {
    const outcome = await runProposalPipeline({
      candidates: [
        c('shady', 'low', 100n, 'Too Good Fund'),
        c('ok', 'medium', 200n, 'Honest Fund'),
      ],
      excluded: new Set(),
      fmt,
      research: (cand) =>
        cand.instrumentId === 'shady'
          ? { confidence: 95, missing: [], contradicted: true }
          : { confidence: 70, missing: [], contradicted: false },
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('ok');
    expect(outcome.trace[0]?.detail.join('\n')).toContain(
      'Too Good Fund: set aside. Its research turned up contradicted evidence',
    );
  });

  test('low conviction is passed over even when the limits fit — proposing nothing beats mediocre', async () => {
    const gated: string[] = [];
    const outcome = await runProposalPipeline({
      candidates: [c('meh', 'low', 100n, 'Meh Fund')],
      excluded: new Set(),
      fmt,
      research: () => ({ confidence: 20, missing: [], contradicted: false }),
      fit: () => fitOf(40),
      gate: (cand) => {
        gated.push(cand.instrumentId);
        return { decision: 'auto_act', code: 'in_limit' };
      },
    });
    expect(gated).toEqual(['meh']); // it DID fit the limits…
    expect(outcome.chosen).toBeNull(); // …and was still passed over
    const suitability = outcome.trace.find((t) => t.stage === 'suitability');
    expect(suitability?.detail.join('\n')).toContain('conviction is low');
    expect(suitability?.summary).toContain('None worth proposing');
  });

  test('research returning null degrades to neutral — the pipeline still proposes, never fabricates', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund')],
      excluded: new Set(),
      fmt,
      research: () => null, // the pass failed or is disabled
      fit: () => fitOf(80),
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('a');
    expect(outcome.chosen?.research).toBeNull();
    // No invented confidence appears on the record.
    expect(outcome.trace[0]?.detail.join('\n')).not.toContain('research confidence');
  });

  test('a size above the minimum is re-gated and adopted with its rationale', async () => {
    const gatedAmounts: bigint[] = [];
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund')],
      excluded: new Set(),
      fmt,
      fit: () => fitOf(80),
      sizeFor: () => ({ amountMinor: 500n, rationale: 'sized toward your "House" goal' }),
      gate: (_cand, amountMinor) => {
        gatedAmounts.push(amountMinor);
        return { decision: 'requires_approval', code: 'above_auto_invest' };
      },
    });
    expect(outcome.chosen?.amountMinor).toBe(500n);
    expect(gatedAmounts).toEqual([100n, 500n]); // screened at the minimum, re-gated at size
    const coordination = outcome.trace.find((t) => t.stage === 'coordination');
    expect(coordination?.summary).toContain('sized toward your "House" goal');
    expect(coordination?.summary).toContain('re-checked against your limits');
  });

  test('a size the gate refuses falls back to the minimum it already cleared', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund')],
      excluded: new Set(),
      fmt,
      fit: () => fitOf(80),
      sizeFor: () => ({ amountMinor: 900n, rationale: 'sized toward your "House" goal' }),
      gate: (_cand, amountMinor) =>
        amountMinor > 100n
          ? { decision: 'blocked', reasons: ['Would breach your cash floor'] }
          : { decision: 'requires_approval', code: 'above_auto_invest' },
    });
    expect(outcome.chosen?.amountMinor).toBe(100n); // the cleared minimum, not the blocked size
    const coordination = outcome.trace.find((t) => t.stage === 'coordination');
    expect(coordination?.summary).toContain('did not clear your limits');
  });
});
