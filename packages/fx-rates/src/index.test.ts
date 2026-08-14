import { describe, expect, it } from 'bun:test';
import { FxParseError, assertPlausible, findRateAndDate, normaliseDate } from './index';
import { bojSource, cbttSource, fetchRate } from './sources';

/**
 * The parsers are covered; the URLs are not, and cannot be from here.
 *
 * The build environment's network policy refuses every outbound host, so no test
 * in this repository can prove that boj.org.jm answers or that what it answers
 * has the shape below. What these fixtures do prove is the half that breaks
 * silently in production: that a published row is read correctly, that a
 * redesigned page fails loudly instead of yielding a wrong number, and that a
 * failure never becomes a substituted guess.
 *
 * The fixtures are the delimited daily-rate rows both banks publish. If a
 * publisher's real format differs, the right response is to replace the fixture
 * with a saved copy of the real response and let the parser fail here — where it
 * costs nothing — rather than in front of an investor.
 */

const BOJ_FIXTURE = `Bank of Jamaica — Daily Foreign Exchange Rates
Currency,Buying,Selling,Date
CAD,112.4010,114.9932,2026-08-14
GBP,198.2201,201.7788,2026-08-14
USD,156.8412,157.9034,2026-08-14
`;

const CBTT_FIXTURE = `Central Bank of Trinidad and Tobago
Daily Exchange Rates
Currency  Buying  Selling  Date
CAD       4.8901  4.9932   14/08/2026
USD       6.7320  6.7905   14/08/2026
`;

describe('reading a published rate', () => {
  it('reads the Bank of Jamaica USD row', () => {
    const { rate, asOf } = bojSource().parse(BOJ_FIXTURE);
    expect(rate).toBe(156.8412);
    expect(asOf).toBe('2026-08-14');
  });

  it('reads the CBTT USD row, with a day-first date', () => {
    const { rate, asOf } = cbttSource().parse(CBTT_FIXTURE);
    expect(rate).toBe(6.732);
    expect(asOf).toBe('2026-08-14');
  });
});

describe('dates, in whichever form the publisher uses', () => {
  it.each([
    ['2026-08-14', '2026-08-14'],
    ['14/08/2026', '2026-08-14'],
    ['14-08-2026', '2026-08-14'],
    ['14 August 2026', '2026-08-14'],
    ['1 Sep 2026', '2026-09-01'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseDate(raw)).toBe(expected);
  });

  it('refuses a row it cannot date rather than guessing today', () => {
    // Stamping "now" on an undated rate is how a stale number starts looking
    // fresh, which is the failure this whole package exists to prevent.
    expect(() => normaliseDate('no date here')).toThrow(FxParseError);
  });
});

describe('a redesigned page fails loudly', () => {
  it('throws when the labelled row is gone', () => {
    expect(() => bojSource().parse('Currency,Buying,Selling\nCAD,112.40,114.99\n')).toThrow(
      FxParseError,
    );
  });

  it('throws when the row carries no rate', () => {
    expect(() => findRateAndDate('USD rate unavailable today', /USD/)).toThrow(FxParseError);
  });

  /**
   * The case a null check misses. A page that still parses after a redesign can
   * yield a row index, a year, or a percentage — a number that is present and
   * wrong. At 2026 JMD to the dollar every Jamaican investor's net worth would
   * be restated by an order of magnitude, and nothing on screen would look
   * broken.
   */
  it('throws when the number parses but could not be a rate', () => {
    expect(() => assertPlausible('JMD', 2026)).toThrow(/plausible range/);
    expect(() => assertPlausible('TTD', 157.2)).toThrow(/plausible range/);
    expect(() => assertPlausible('JMD', 0)).toThrow(/positive number/);
  });

  it('accepts a rate in range', () => {
    expect(() => assertPlausible('JMD', 157.2)).not.toThrow();
    expect(() => assertPlausible('TTD', 6.79)).not.toThrow();
  });
});

describe('fetching', () => {
  const ok = (body: string): typeof fetch =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it('returns the parsed rate with its publisher', async () => {
    const result = await fetchRate(bojSource(), ok(BOJ_FIXTURE));
    expect(result).toEqual({
      quote: 'JMD',
      rate: 156.8412,
      asOf: '2026-08-14',
      source: 'BOJ',
    });
  });

  it('throws on a non-200 rather than returning a fallback', async () => {
    const down = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    // The caller keeps the rate it already has and lets the screen say how old
    // it is. Substituting a plausible number here is exactly the behaviour that
    // let a hardcoded table go unnoticed for months.
    await expect(fetchRate(bojSource(), down)).rejects.toThrow(/503/);
  });
});
