import { describe, expect, test } from 'bun:test';
import {
  type GuardrailInput,
  type GuardrailOpportunity,
  type GuardrailPolicy,
  evaluate,
} from './index';

const POLICY: GuardrailPolicy = {
  permittedJurisdictions: ['Jamaica', 'Trinidad and Tobago', 'Barbados'],
  permittedSectors: ['Renewable Energy', 'Technology', 'Tourism'],
  readinessAllowThreshold: 80,
  readinessDisclosureThreshold: 60,
  requireInvestorReady: true,
};

const READY_OPPORTUNITY: GuardrailOpportunity = {
  jurisdiction: 'Jamaica',
  sector: 'Renewable Energy',
  readinessScore: 90,
  criticalMissingItems: [],
  hasContradictedEvidence: false,
};

const input = (overrides: Partial<GuardrailInput> = {}): GuardrailInput => ({
  policy: POLICY,
  opportunity: READY_OPPORTUNITY,
  investor: { mandateComplete: true, kycComplete: true },
  ...overrides,
});

describe('evaluate — allow', () => {
  test('fully ready opportunity, ready investor: allow', () => {
    expect(evaluate(input())).toEqual({ decision: 'allow', code: 'ready' });
  });

  test('readiness exactly at the allow threshold is allow, not disclosure', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 80 } }));
    expect(result.decision).toBe('allow');
  });

  test('investor readiness is not checked when requireInvestorReady is false', () => {
    const result = evaluate(
      input({
        policy: { ...POLICY, requireInvestorReady: false },
        investor: { mandateComplete: false, kycComplete: false },
      }),
    );
    expect(result.decision).toBe('allow');
  });
});

describe('evaluate — block (integrity / eligibility, never a judgment call)', () => {
  test('incomplete mandate blocks, naming the specific gap', () => {
    const result = evaluate(input({ investor: { mandateComplete: false, kycComplete: true } }));
    expect(result.decision).toBe('block');
    expect(result.decision === 'block' && result.code).toBe('mandate_incomplete');
    expect(result.decision === 'block' && result.reasons).toEqual([
      'Investor mandate is incomplete',
    ]);
  });

  test('incomplete KYC blocks, naming the specific gap', () => {
    const result = evaluate(input({ investor: { mandateComplete: true, kycComplete: false } }));
    expect(result.decision === 'block' && result.reasons).toEqual(['Investor KYC is incomplete']);
  });

  test('both mandate and KYC incomplete names both gaps', () => {
    const result = evaluate(input({ investor: { mandateComplete: false, kycComplete: false } }));
    expect(result.decision === 'block' && result.reasons).toHaveLength(2);
  });

  test('contradicted evidence blocks regardless of readiness score', () => {
    const result = evaluate(
      input({
        opportunity: { ...READY_OPPORTUNITY, readinessScore: 100, hasContradictedEvidence: true },
      }),
    );
    expect(result.decision).toBe('block');
    expect(result.decision === 'block' && result.code).toBe('evidence_contradicted');
  });

  test('jurisdiction not on the allowlist blocks', () => {
    const result = evaluate(
      input({ opportunity: { ...READY_OPPORTUNITY, jurisdiction: 'Cayman Islands' } }),
    );
    expect(result.decision).toBe('block');
    expect(result.decision === 'block' && result.code).toBe('jurisdiction_not_permitted');
    expect(result.decision === 'block' && result.reasons[0]).toContain('Cayman Islands');
  });

  test('sector not on the allowlist blocks', () => {
    const result = evaluate(
      input({ opportunity: { ...READY_OPPORTUNITY, sector: 'Cryptocurrency Mining' } }),
    );
    expect(result.decision).toBe('block');
    expect(result.decision === 'block' && result.code).toBe('sector_not_permitted');
  });

  test('eligibility blocks take priority over a low readiness score', () => {
    // Bad jurisdiction AND bad readiness — the eligibility block wins, since the
    // ordered checks stop at the first decision.
    const result = evaluate(
      input({
        opportunity: { ...READY_OPPORTUNITY, jurisdiction: 'Cayman Islands', readinessScore: 10 },
      }),
    );
    expect(result.decision === 'block' && result.code).toBe('jurisdiction_not_permitted');
  });
});

describe('evaluate — human_review', () => {
  test('outstanding critical missing items triggers review, listing each one', () => {
    const result = evaluate(
      input({
        opportunity: {
          ...READY_OPPORTUNITY,
          criticalMissingItems: ['Audited accounts', 'Planning approval'],
        },
      }),
    );
    expect(result.decision).toBe('human_review');
    expect(result.decision === 'human_review' && result.code).toBe('critical_items_outstanding');
    expect(result.decision === 'human_review' && result.reasons).toEqual([
      'Missing: Audited accounts',
      'Missing: Planning approval',
    ]);
  });

  test('readiness strictly below the review threshold triggers review, not a block', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 59 } }));
    expect(result.decision).toBe('human_review');
    expect(result.decision === 'human_review' && result.code).toBe(
      'readiness_below_review_threshold',
    );
  });

  test('readiness exactly at the review threshold is NOT review (only strictly below is)', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 60 } }));
    expect(result.decision).not.toBe('human_review');
  });

  test('missing items take priority over a merely-low readiness score', () => {
    const result = evaluate(
      input({
        opportunity: {
          ...READY_OPPORTUNITY,
          readinessScore: 10,
          criticalMissingItems: ['Audited accounts'],
        },
      }),
    );
    expect(result.decision === 'human_review' && result.code).toBe('critical_items_outstanding');
  });
});

describe('evaluate — allow_with_disclosure', () => {
  test('readiness in the disclosure band (>= review threshold, < allow threshold)', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 70 } }));
    expect(result.decision).toBe('allow_with_disclosure');
    expect(result.decision === 'allow_with_disclosure' && result.code).toBe(
      'readiness_below_disclosure_threshold',
    );
    expect(result.decision === 'allow_with_disclosure' && result.disclosures[0]).toContain('70');
  });

  test('boundary just below the allow threshold is disclosure, not plain allow', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 79 } }));
    expect(result.decision).toBe('allow_with_disclosure');
  });

  test('boundary exactly at the disclosure threshold is disclosure, not review', () => {
    const result = evaluate(input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 60 } }));
    expect(result.decision).toBe('allow_with_disclosure');
  });
});

describe('ordering: every eligibility/integrity check outranks readiness scoring', () => {
  test.each([
    ['hasContradictedEvidence', { hasContradictedEvidence: true }],
    ['jurisdiction', { jurisdiction: 'Nowhere' }],
    ['sector', { sector: 'Nothing' }],
  ] as const)('%s beats a perfect readiness score', (_label, patch) => {
    const result = evaluate(
      input({ opportunity: { ...READY_OPPORTUNITY, readinessScore: 100, ...patch } }),
    );
    expect(result.decision).toBe('block');
  });
});
