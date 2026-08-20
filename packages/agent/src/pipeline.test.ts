import { describe, expect, test } from 'bun:test';
import {
  type ComplianceVerdict,
  type PipelineCandidate,
  type PipelineInput,
  assessTransactionCompliance,
  runProposalPipeline as executeProposalPipeline,
} from './pipeline';

/**
 * The pipeline, deterministically. What matters: research
 * ranks gentlest-first and honours the quiet set; suitability keeps every
 * verdict including the losers'; coordination appears only when something was
 * chosen and always routes to an approval; and the trace tells the story a
 * person could actually check.
 */

const fmt = (minor: bigint) => `US$${(Number(minor) / 100).toLocaleString('en-US')}`;
const clearedCompliance = (): ComplianceVerdict => ({
  decision: 'clear',
  reasons: [],
  checks: ['Test readiness verified'],
});
const runProposalPipeline = (
  input: Omit<PipelineInput, 'compliance'> & Pick<Partial<PipelineInput>, 'compliance'>,
) => executeProposalPipeline({ ...input, compliance: input.compliance ?? clearedCompliance });

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
    expect(outcome.trace.map((t) => t.stage)).toEqual([
      'research',
      'suitability',
      'compliance',
      'coordination',
    ]);
    expect(outcome.trace[3]?.summary).toContain('approval');
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
    expect(outcome.trace[3]?.detail.join('\n')).toContain('approval card');
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
    expect(outcome.trace).toHaveLength(3); // compliance records the empty handoff; no coordination
    expect(outcome.trace[0]?.summary).toContain('resting after a recent proposal');
    expect(outcome.trace[1]?.summary).toContain('Nothing reached screening');
  });

  test('compliance clears after suitability and leaves its evidence in the trace', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund')],
      excluded: new Set(),
      fmt,
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
      compliance: () => ({
        decision: 'clear',
        reasons: [],
        checks: ['Identity verified', 'Active account with NCB'],
      }),
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('a');
    expect(outcome.trace.map((trace) => trace.stage)).toEqual([
      'research',
      'suitability',
      'compliance',
      'coordination',
    ]);
    expect(
      outcome.trace.find((trace) => trace.stage === 'compliance')?.detail.join('\n'),
    ).toContain('Identity verified');
  });

  test('a compliance refusal tries the next suitable candidate and records both handoffs', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund'), c('b', 'low', 200n, 'Beta Bond')],
      excluded: new Set(),
      fmt,
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
      compliance: (candidate) =>
        candidate.instrumentId === 'a'
          ? {
              decision: 'blocked',
              reasons: ['There is no active account with the executing firm.'],
              checks: ['Identity verified'],
            }
          : { decision: 'clear', reasons: [], checks: ['All checks clear'] },
    });
    expect(outcome.chosen?.candidate.instrumentId).toBe('b');
    const suitability = outcome.trace.find((trace) => trace.stage === 'suitability');
    expect(suitability?.detail.join('\n')).toContain('Alpha Fund: fits');
    expect(suitability?.detail.join('\n')).toContain('Beta Bond: fits');
    const compliance = outcome.trace.find((trace) => trace.stage === 'compliance');
    expect(compliance?.detail.join('\n')).toContain('Alpha Fund: stopped');
    expect(compliance?.detail.join('\n')).toContain('Beta Bond: cleared');
  });

  test('a compliance lookup failure fails closed without leaking the exception', async () => {
    const outcome = await runProposalPipeline({
      candidates: [c('a', 'low', 100n, 'Alpha Fund')],
      excluded: new Set(),
      fmt,
      gate: () => ({ decision: 'requires_approval', code: 'above_auto_invest' }),
      compliance: () => {
        throw new Error('database detail that must not be shown');
      },
    });
    expect(outcome.chosen).toBeNull();
    const detail = outcome.trace.find((trace) => trace.stage === 'compliance')?.detail.join('\n');
    expect(detail).toContain('Compliance readiness could not be verified');
    expect(detail).not.toContain('database detail');
  });
});

describe('KYC and AML readiness', () => {
  test('records a standard PEP declaration without inventing an external screen', () => {
    const verdict = assessTransactionCompliance({
      identityVerified: true,
      complianceConfirmed: true,
      riskCompleted: true,
      fundsConfirmed: true,
      isPep: false,
      activeExecutingFirm: true,
      executingFirmName: 'NCB',
    });

    expect(verdict.decision).toBe('clear');
    expect(verdict.checks).toContain('PEP declaration recorded; no PEP disclosed');
    expect(verdict.checks.join(' ')).not.toMatch(/sanctions|adverse.media/i);
  });

  test('fails closed when a PEP disclosure has not reached executing-firm review', () => {
    const verdict = assessTransactionCompliance({
      identityVerified: true,
      complianceConfirmed: true,
      riskCompleted: true,
      fundsConfirmed: true,
      isPep: true,
      activeExecutingFirm: false,
      executingFirmName: 'NCB',
    });

    expect(verdict.decision).toBe('blocked');
    expect(verdict.reasons.join(' ')).toContain('PEP disclosure requires executing-firm review');
  });

  test('keeps PEP handling attributable to an active licensed firm', () => {
    const verdict = assessTransactionCompliance({
      identityVerified: true,
      complianceConfirmed: true,
      riskCompleted: true,
      fundsConfirmed: true,
      isPep: true,
      activeExecutingFirm: true,
      executingFirmName: 'NCB',
    });

    expect(verdict.decision).toBe('clear');
    expect(verdict.checks).toContain(
      'PEP disclosed; the active executing firm owns enhanced due diligence',
    );
  });

  test('does not call a missing PEP declaration recorded', () => {
    const verdict = assessTransactionCompliance({
      identityVerified: false,
      complianceConfirmed: false,
      riskCompleted: false,
      fundsConfirmed: false,
      isPep: false,
      activeExecutingFirm: false,
      executingFirmName: null,
    });

    expect(verdict.decision).toBe('blocked');
    expect(verdict.checks).not.toContain('PEP declaration recorded; no PEP disclosed');
  });
});

/**
 * The injected enrichment specialists — research signal, portfolio fit and
 * sizing policy — are optional; compliance is always explicit. With the
 * enrichments, ranking runs on conviction, contradicted evidence is
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
      'compliance',
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
