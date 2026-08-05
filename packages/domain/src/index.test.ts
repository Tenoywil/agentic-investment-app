import { expect, describe as group, test } from 'bun:test';
import {
  BAND_MAX_RISK,
  type OrderEvent,
  type OrderStatus,
  type RiskBand,
  canApply,
  fitsSuitability,
  isTerminalStatus,
  legalEvents,
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
