import { expect, describe as group, test } from 'bun:test';
import {
  DEFAULT_FX,
  add,
  atMostPercent,
  compare,
  convert,
  formatMoney,
  fromMajor,
  gte,
  isNegative,
  money,
  parseMinor,
  percentOf,
  spreadBps,
  subtract,
  sum,
  toMajorNumber,
} from './index';

group('construction', () => {
  test('money() accepts bigint and integer minor units', () => {
    expect(money(1_340_000n, 'USD').minor).toBe(1_340_000n);
    expect(money(500, 'USD').minor).toBe(500n);
  });
  test('fromMajor rounds to minor units', () => {
    expect(fromMajor(13_400, 'USD').minor).toBe(1_340_000n);
    expect(fromMajor(19.99, 'USD').minor).toBe(1999n);
  });
  test('toMajorNumber is the major-unit view', () => {
    expect(toMajorNumber(money(1_340_000n, 'USD'))).toBe(13_400);
  });
});

group('arithmetic', () => {
  test('add/subtract stay in minor units', () => {
    expect(add(money(500n, 'USD'), money(250n, 'USD')).minor).toBe(750n);
    expect(subtract(money(500n, 'USD'), money(250n, 'USD')).minor).toBe(250n);
  });
  test('sum totals a list', () => {
    const total = sum(
      [money(1_340_000n, 'USD'), money(820_000n, 'USD'), money(415_000n, 'USD')],
      'USD',
    );
    expect(total.minor).toBe(2_575_000n);
  });
  test('mixing currencies throws', () => {
    expect(() => add(money(1n, 'USD'), money(1n, 'JMD'))).toThrow(/currency mismatch/);
    expect(() => sum([money(1n, 'JMD')], 'USD')).toThrow(/cannot sum/);
  });
  test('compare and helpers', () => {
    expect(compare(money(1n, 'USD'), money(2n, 'USD'))).toBe(-1);
    expect(compare(money(2n, 'USD'), money(2n, 'USD'))).toBe(0);
    expect(gte(money(2n, 'USD'), money(2n, 'USD'))).toBe(true);
    expect(isNegative(money(-1n, 'USD'))).toBe(true);
  });
});

group('FX conversion (prototype rates USD:1, JMD:157.2, TTD:6.79)', () => {
  test('USD → JMD', () => {
    // US$100 → J$15,720
    expect(convert(money(10_000n, 'USD'), 'JMD').minor).toBe(1_572_000n);
  });
  test('US$31,350 net worth across currencies (matches prototype fmt)', () => {
    const nw = money(3_135_000n, 'USD');
    expect(formatMoney(convert(nw, 'JMD'))).toBe('J$4,928,220');
    expect(formatMoney(convert(nw, 'TTD'))).toBe('TT$212,867'); // 212866.5 rounds up
    expect(formatMoney(nw)).toBe('US$31,350');
  });
  test('same-currency conversion is identity', () => {
    const m = money(1n, 'USD');
    expect(convert(m, 'USD')).toBe(m);
  });
  test('cross rate goes through USD (JMD → TTD)', () => {
    // J$157.20 = US$1.00 = TT$6.79
    expect(convert(money(15_720n, 'JMD'), 'TTD', DEFAULT_FX).minor).toBe(679n);
  });
  test('round-trip stays within a cent', () => {
    const usd = money(1_340_000n, 'USD');
    const back = convert(convert(usd, 'JMD'), 'USD');
    const drift = back.minor - usd.minor;
    expect(drift >= -1n && drift <= 1n).toBe(true);
  });
});

group('spreadBps (FX guardrail)', () => {
  test('3% deviation is 300 bps', () => {
    expect(spreadBps(103_000_000n, 100_000_000n)).toBe(300);
  });
  test('symmetric regardless of direction', () => {
    expect(spreadBps(97_000_000n, 100_000_000n)).toBe(300);
  });
  test('a 0.4% spread clears the prototype 0.3% rule only by rounding', () => {
    // 156.7 mid vs 157.2 quoted ≈ 31.9 bps → 32, above the 30 bps limit
    expect(spreadBps(157_200_000n, 156_700_000n)).toBe(32);
  });
  test('zero reference is rejected', () => {
    expect(() => spreadBps(1n, 0n)).toThrow(/positive/);
  });
});

group('percentages (single-position cap)', () => {
  test('percentOf rounds to whole percent', () => {
    expect(percentOf(money(1_500_000n, 'USD'), money(10_000_000n, 'USD'))).toBe(15);
    expect(percentOf(money(1n, 'USD'), money(0n, 'USD'))).toBe(0);
  });
  test('atMostPercent is exact at the boundary', () => {
    const whole = money(10_000_000n, 'USD'); // US$100,000
    expect(atMostPercent(money(1_500_000n, 'USD'), whole, 15)).toBe(true); // exactly 15%
    expect(atMostPercent(money(1_500_001n, 'USD'), whole, 15)).toBe(false); // one cent over
  });
  test('atMostPercent with a zero portfolio only passes a zero position', () => {
    expect(atMostPercent(money(0n, 'USD'), money(0n, 'USD'), 15)).toBe(true);
    expect(atMostPercent(money(1n, 'USD'), money(0n, 'USD'), 15)).toBe(false);
  });
});

group('formatting & parsing', () => {
  test('formatMoney matches prototype whole-unit format', () => {
    expect(formatMoney(money(3_135_000n, 'USD'))).toBe('US$31,350');
    expect(formatMoney(money(415_000n, 'JMD'))).toBe('J$4,150');
  });
  test('formatMoney can show cents', () => {
    expect(formatMoney(money(1999n, 'USD'), { minorDigits: 2 })).toBe('US$19.99');
  });
  test('parseMinor accepts DB bigint strings and rejects bad currencies', () => {
    expect(parseMinor('1340000', 'USD').minor).toBe(1_340_000n);
    expect(() => parseMinor('1', 'GBP')).toThrow(/unknown currency/);
  });
});
