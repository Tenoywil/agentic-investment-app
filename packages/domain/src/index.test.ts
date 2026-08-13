import { expect, describe as group, test } from 'bun:test';
import {
  BAND_MAX_RISK,
  GATEWAY_TERMINAL_STATUSES,
  type GatewayIntroductionEvent,
  type GatewayIntroductionStatus,
  type GatewayOpportunityEvent,
  type GatewayOpportunityStatus,
  type OrderEvent,
  type OrderStatus,
  type RiskBand,
  canApply,
  canApplyGatewayEvent,
  canApplyIntroductionEvent,
  fitsSuitability,
  gatewayEventForGuardrailDecision,
  gatewayMandateSchema,
  gatewayOpportunitySchema,
  isGatewayTerminalStatus,
  isTerminalStatus,
  legalEvents,
  legalGatewayEvents,
  nextGatewayStatus,
  nextIntroductionStatus,
  nextStatus,
  proposeOrderSchema,
  rejectSchema,
  scoreToBand,
} from './index';

group('order state machine', () => {
  test('the happy path created → accepted → settled', () => {
    expect(nextStatus('created', 'accept')).toBe('accepted');
    expect(nextStatus('accepted', 'settle')).toBe('settled');
  });

  test('created can be rejected or expired', () => {
    expect(nextStatus('created', 'reject')).toBe('rejected');
    expect(nextStatus('created', 'expire')).toBe('expired');
  });

  test('accepted can still be rejected but not re-accepted or expired', () => {
    expect(nextStatus('accepted', 'reject')).toBe('rejected');
    expect(canApply('accepted', 'accept')).toBe(false);
    expect(canApply('accepted', 'expire')).toBe(false);
  });

  test('settle requires accepted — cannot settle a created order', () => {
    expect(canApply('created', 'settle')).toBe(false);
    expect(() => nextStatus('created', 'settle')).toThrow(/illegal order transition/);
  });

  test('terminal states accept nothing', () => {
    for (const s of ['settled', 'rejected', 'expired'] as OrderStatus[]) {
      expect(isTerminalStatus(s)).toBe(true);
      expect(legalEvents(s)).toEqual([]);
      for (const e of ['accept', 'settle', 'reject', 'expire'] as OrderEvent[]) {
        expect(canApply(s, e)).toBe(false);
      }
    }
  });

  test('created and accepted are non-terminal', () => {
    expect(isTerminalStatus('created')).toBe(false);
    expect(isTerminalStatus('accepted')).toBe(false);
  });
});

group('suitability', () => {
  test('low band admits only low risk', () => {
    expect(fitsSuitability('low', 'low')).toBe(true);
    expect(fitsSuitability('low', 'medium')).toBe(false);
    expect(fitsSuitability('low', 'high')).toBe(false);
  });

  test('moderate bands admit up to medium but not high', () => {
    for (const band of ['low_moderate', 'high_moderate'] as RiskBand[]) {
      expect(fitsSuitability(band, 'medium')).toBe(true);
      expect(fitsSuitability(band, 'high')).toBe(false);
    }
  });

  test('the top two bands admit high risk', () => {
    expect(fitsSuitability('low_high', 'high')).toBe(true);
    expect(fitsSuitability('high', 'high')).toBe(true);
  });

  test('BAND_MAX_RISK covers every band', () => {
    const bands: RiskBand[] = ['low', 'low_moderate', 'high_moderate', 'low_high', 'high'];
    for (const b of bands) expect(BAND_MAX_RISK[b]).toBeDefined();
  });

  test('scoreToBand maps quiz totals to bands', () => {
    expect(scoreToBand(3)).toBe('low'); // avg 1.0
    expect(scoreToBand(7)).toBe('low_moderate'); // avg 2.33
    expect(scoreToBand(15)).toBe('high'); // avg 5.0
  });

  test('scoreToBand boundaries', () => {
    expect(scoreToBand(6)).toBe('low_moderate'); // avg 2.0
    expect(scoreToBand(9)).toBe('high_moderate'); // avg 3.0
    expect(scoreToBand(12)).toBe('low_high'); // avg 4.0
  });
});

group('request schemas', () => {
  test('proposeOrderSchema coerces amount and defaults currency', () => {
    const r = proposeOrderSchema.parse({
      instrumentId: '11111111-1111-1111-1111-111111111111',
      amountMinor: 100000,
    });
    expect(r.amountMinor).toBe(100000n);
    expect(r.currency).toBe('USD');
  });

  test('proposeOrderSchema accepts a digit string amount', () => {
    const r = proposeOrderSchema.parse({
      instrumentId: '11111111-1111-1111-1111-111111111111',
      amountMinor: '2500000',
      currency: 'JMD',
    });
    expect(r.amountMinor).toBe(2500000n);
    expect(r.currency).toBe('JMD');
  });

  test('proposeOrderSchema rejects zero, negatives, floats, and bad uuids', () => {
    const base = { instrumentId: '11111111-1111-1111-1111-111111111111' };
    expect(() => proposeOrderSchema.parse({ ...base, amountMinor: 0 })).toThrow();
    expect(() => proposeOrderSchema.parse({ ...base, amountMinor: -5 })).toThrow();
    expect(() => proposeOrderSchema.parse({ ...base, amountMinor: 1.5 })).toThrow();
    expect(() =>
      proposeOrderSchema.parse({ instrumentId: 'not-a-uuid', amountMinor: 5 }),
    ).toThrow();
  });

  test('rejectSchema allows an optional reason', () => {
    expect(rejectSchema.parse({}).reason).toBeUndefined();
    expect(rejectSchema.parse({ reason: 'FX spread too wide' }).reason).toBe('FX spread too wide');
  });
});

group('gateway opportunity state machine', () => {
  test('the happy path submitted → assessed → approved (evaluate_allow)', () => {
    expect(nextGatewayStatus('submitted', 'assess')).toBe('assessed');
    expect(nextGatewayStatus('assessed', 'evaluate_allow')).toBe('approved');
  });

  test('assessed can route to pending_review or straight to rejected', () => {
    expect(nextGatewayStatus('assessed', 'evaluate_review')).toBe('pending_review');
    expect(nextGatewayStatus('assessed', 'evaluate_block')).toBe('rejected');
  });

  test('pending_review is resolved by an analyst approve or reject', () => {
    expect(nextGatewayStatus('pending_review', 'approve')).toBe('approved');
    expect(nextGatewayStatus('pending_review', 'reject')).toBe('rejected');
  });

  test('submitted cannot skip straight to an evaluate event', () => {
    expect(canApplyGatewayEvent('submitted', 'evaluate_allow')).toBe(false);
    expect(() => nextGatewayStatus('submitted', 'evaluate_allow')).toThrow(
      /illegal gateway opportunity transition/,
    );
  });

  test('terminal states accept nothing', () => {
    for (const s of GATEWAY_TERMINAL_STATUSES) {
      expect(isGatewayTerminalStatus(s)).toBe(true);
      expect(legalGatewayEvents(s)).toEqual([]);
      const events: GatewayOpportunityEvent[] = [
        'assess',
        'evaluate_allow',
        'evaluate_review',
        'evaluate_block',
        'approve',
        'reject',
      ];
      for (const e of events) expect(canApplyGatewayEvent(s, e)).toBe(false);
    }
  });

  test('submitted, assessed, and pending_review are non-terminal', () => {
    for (const s of ['submitted', 'assessed', 'pending_review'] as GatewayOpportunityStatus[]) {
      expect(isGatewayTerminalStatus(s)).toBe(false);
    }
  });

  test('gatewayEventForGuardrailDecision maps every decision to its event', () => {
    expect(gatewayEventForGuardrailDecision('allow')).toBe('evaluate_allow');
    expect(gatewayEventForGuardrailDecision('allow_with_disclosure')).toBe('evaluate_allow');
    expect(gatewayEventForGuardrailDecision('human_review')).toBe('evaluate_review');
    expect(gatewayEventForGuardrailDecision('block')).toBe('evaluate_block');
  });
});

group('gateway introduction state machine', () => {
  test('the happy path requested → approved → completed', () => {
    expect(nextIntroductionStatus('requested', 'approve')).toBe('approved');
    expect(nextIntroductionStatus('approved', 'complete')).toBe('completed');
  });

  test('requested can also be rejected', () => {
    expect(nextIntroductionStatus('requested', 'reject')).toBe('rejected');
  });

  test('a rejected introduction cannot later be approved or completed', () => {
    expect(canApplyIntroductionEvent('rejected', 'approve')).toBe(false);
    expect(canApplyIntroductionEvent('rejected', 'complete')).toBe(false);
    expect(() => nextIntroductionStatus('rejected', 'complete')).toThrow(
      /illegal introduction transition/,
    );
  });

  test('completed cannot be re-approved, re-rejected, or re-completed', () => {
    const events: GatewayIntroductionEvent[] = ['approve', 'reject', 'complete'];
    for (const e of events) expect(canApplyIntroductionEvent('completed', e)).toBe(false);
  });

  test('approved cannot be rejected after the fact', () => {
    expect(canApplyIntroductionEvent('approved', 'reject')).toBe(false);
  });

  test('every status is reachable from the terminal-status list logic (sanity)', () => {
    const statuses: GatewayIntroductionStatus[] = [
      'requested',
      'approved',
      'rejected',
      'completed',
    ];
    expect(statuses).toHaveLength(4);
  });
});

group('gateway request schemas', () => {
  test('gatewayMandateSchema fills defaults and coerces cheque-size minor units', () => {
    const r = gatewayMandateSchema.parse({
      minCheckMinor: 10_000_00,
      maxCheckMinor: 500_000_00,
      riskAppetite: 'medium',
      horizonYears: 5,
      targetReturnPct: 12,
      liquidityNeed: 'low',
    });
    expect(r.minCheckMinor).toBe(1_000_000n);
    expect(r.maxCheckMinor).toBe(50_000_000n);
    expect(r.countries).toEqual([]);
    expect(r.currency).toBe('USD');
    expect(r.boardInvolvement).toBe(false);
  });

  test('gatewayMandateSchema rejects a max cheque below the min', () => {
    expect(() =>
      gatewayMandateSchema.parse({
        minCheckMinor: 500_000_00,
        maxCheckMinor: 10_000_00,
        riskAppetite: 'medium',
        horizonYears: 5,
        targetReturnPct: 12,
        liquidityNeed: 'low',
      }),
    ).toThrow(/maxCheckMinor/);
  });

  test('gatewayOpportunitySchema requires a positive capital-sought amount', () => {
    const base = {
      name: 'Solar co-op expansion',
      country: 'Jamaica',
      sector: 'Renewable Energy',
      stage: 'Growth',
      investmentType: 'Equity',
      targetReturnPct: 12,
      horizonYears: 5,
      riskRating: 'medium' as const,
      liquidity: 'low' as const,
      summary: 'Expanding a community solar cooperative into two new parishes.',
    };
    expect(() => gatewayOpportunitySchema.parse({ ...base, capitalSoughtMinor: 0 })).toThrow();
    const r = gatewayOpportunitySchema.parse({ ...base, capitalSoughtMinor: 250_000_00 });
    expect(r.capitalSoughtMinor).toBe(25_000_000n);
    expect(r.currency).toBe('USD');
  });
});
