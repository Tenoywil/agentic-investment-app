import { FxParseError, type FxSource, assertPlausible, findRateAndDate } from './index';

/**
 * The publishers.
 *
 * Both banks put out a dated daily selling rate against the USD. The URLs are
 * overridable because they are the part of this file most likely to be wrong:
 * they have not been exercised against the live sites from the build
 * environment, whose network policy refuses every outbound host. A wrong URL
 * must be correctable with an environment variable, not a deploy.
 *
 * The parsers look for a labelled row and take the first decimal number and the
 * first date on it. That is deliberately loose. A publisher who restyles a page
 * usually keeps the row and moves the markup, and a parser anchored to markup
 * breaks on a redesign that a parser anchored to the label survives. When it
 * does break, `assertPlausible` catches the wrong-number case that a null check
 * would not.
 */

export interface SourceOverrides {
  bojUrl?: string | undefined;
  cbttUrl?: string | undefined;
}

/** Bank of Jamaica — daily weighted average selling rate, USD/JMD. */
export function bojSource(url?: string): FxSource {
  return {
    quote: 'JMD',
    source: 'BOJ',
    publisher: 'Bank of Jamaica',
    url: url || 'https://boj.org.jm/market/foreign-exchange/counter-rates/',
    parse(body) {
      const { rate, asOf } = findRateAndDate(body, /USD|U\.S\.|selling/i);
      assertPlausible('JMD', rate);
      return { rate, asOf };
    },
  };
}

/** Central Bank of Trinidad and Tobago — daily selling rate, USD/TTD. */
export function cbttSource(url?: string): FxSource {
  return {
    quote: 'TTD',
    source: 'CBTT',
    publisher: 'Central Bank of Trinidad and Tobago',
    url: url || 'https://www.central-bank.org.tt/statistics/exchange-rates',
    parse(body) {
      const { rate, asOf } = findRateAndDate(body, /USD|U\.S\.|selling/i);
      assertPlausible('TTD', rate);
      return { rate, asOf };
    },
  };
}

export function allSources(overrides: SourceOverrides = {}): FxSource[] {
  return [bojSource(overrides.bojUrl), cbttSource(overrides.cbttUrl)];
}

/**
 * Anything that can perform an outbound request. The API passes the SSRF-guarded
 * fetch from @ccn/security, so a redirect to an internal address is refused at
 * every hop; tests pass a function over a fixture and never touch the network.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchedRate {
  quote: FxSource['quote'];
  rate: number;
  asOf: string;
  source: string;
}

/**
 * Fetch and parse one source.
 *
 * Throws rather than returning a fallback. The caller decides what a failure
 * means, and for this product it means "keep the rate we have and let the screen
 * say how old it is" — never "substitute a plausible number", which is the
 * behaviour that made the hardcoded table invisible for so long.
 */
export async function fetchRate(source: FxSource, doFetch: FetchLike): Promise<FetchedRate> {
  const res = await doFetch(source.url, {
    headers: { accept: 'text/csv, text/html, application/json;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new FxParseError(`${source.source}: ${source.url} answered ${res.status}`);
  }
  const body = await res.text();
  const { rate, asOf } = source.parse(body);
  return { quote: source.quote, rate, asOf, source: source.source };
}
