/**
 * @ccn/fx-rates — daily USD rates from the region's central banks.
 *
 * ## Why this package exists
 *
 * Currency conversion ran on `DEFAULT_FX` in @ccn/money: three bigints written
 * into source from the prototype, which every call site used because every call
 * site omitted the optional `fx` argument. The `fx_rates` table was seeded once
 * and read by nothing. So an investor switching their portfolio to JMD saw a
 * number converted at a rate nobody had checked in months, rendered with the
 * same authority as their balance.
 *
 * CCN routes orders and holds no money. It has no rate of its own to quote and
 * no business inventing one — the rate belongs to the central bank that
 * publishes it every day, and the honest thing to show is theirs, with their
 * date on it.
 *
 * ## Shape
 *
 * A source is a URL and a parser. Parsers are pure functions from a response
 * body to `{ rate, asOf }`, which is what makes them testable: the fetching is
 * somebody else's problem and the parsing — the part that breaks when a
 * publisher changes a page — is covered by fixtures.
 *
 * ## What is not proven
 *
 * The endpoints are configurable rather than compiled in, and default to the
 * pages each bank publishes its daily rates on. Those defaults have NOT been
 * exercised against the live sites from the build environment, whose network
 * policy refuses every outbound host. The parsers are proven against recorded
 * fixtures; the URLs are not proven at all, which is why they are overridable by
 * environment variable and why a fetch failure is designed to leave the previous
 * rate in place and visibly stale rather than to substitute a guess.
 */

export type FxCurrency = 'JMD' | 'TTD';

/** One published rate: how many units of `quote` equal one USD. */
export interface PublishedRate {
  quote: FxCurrency;
  /** Units of `quote` per 1 USD, as published. */
  rate: number;
  /** The publisher's own date for this rate, `YYYY-MM-DD`. */
  asOf: string;
  /** Short code of the publishing bank, e.g. `BOJ`. */
  source: string;
}

export interface FxSource {
  quote: FxCurrency;
  /** Short code stored against the rate. */
  source: string;
  /** Human name, for logs and for the "as of" line on screen. */
  publisher: string;
  url: string;
  parse(body: string): { rate: number; asOf: string };
}

export class FxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxParseError';
  }
}

/**
 * A rate must be a positive, finite number in a plausible range.
 *
 * The failure this guards against is not a malformed page — that throws on its
 * own — but a page that still parses after a redesign and yields something like
 * a row index or a year. A JMD rate of `2026` would sail through a null check
 * and quietly restate every Jamaican investor's net worth by an order of
 * magnitude, which is worse than showing yesterday's rate.
 */
const PLAUSIBLE: Record<FxCurrency, { min: number; max: number }> = {
  // JMD has traded roughly 120–200 to the USD for years; TTD is pegged near 6.8.
  JMD: { min: 80, max: 400 },
  TTD: { min: 3, max: 15 },
};

export function assertPlausible(quote: FxCurrency, rate: number): void {
  const range = PLAUSIBLE[quote];
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new FxParseError(`${quote}: parsed rate is not a positive number (${rate})`);
  }
  if (rate < range.min || rate > range.max) {
    throw new FxParseError(
      `${quote}: parsed rate ${rate} is outside the plausible range ${range.min}–${range.max}. The publisher has probably changed the page and the parser is reading the wrong number.`,
    );
  }
}

/** `14 August 2026`, `2026-08-14` and `14/08/2026` all reach the same place. */
export function normaliseDate(raw: string): string {
  const trimmed = raw.trim();

  const iso = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = trimmed.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const named = trimmed.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const [, d, monthName, y] = named;
    const month = MONTHS.indexOf((monthName ?? '').slice(0, 3).toLowerCase());
    if (month >= 0) {
      return `${y}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  throw new FxParseError(`could not read a date from "${raw}"`);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Pull the first `number, date` pair out of a delimited row.
 *
 * Both banks publish the same thing in the same shape — a dated row carrying a
 * selling rate — whether the page is served as CSV, as a table, or as JSON with
 * the numbers still formatted for humans. Rather than three parsers that each
 * break differently, this finds the rate and the date and lets the caller say
 * which is which.
 */
export function findRateAndDate(body: string, rateLabel: RegExp): { rate: number; asOf: string } {
  const candidates = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => rateLabel.test(l));

  if (candidates.length === 0) {
    throw new FxParseError(`no line matching ${rateLabel} — the published format has changed`);
  }

  // A label alone is not enough: "Currency,Buying,Selling,Date" matches every
  // sensible label pattern and is a header, not a rate. The first line that
  // yields both a decimal number and a date is the row that was wanted.
  for (const line of candidates) {
    const numbers = line.match(/\d+\.\d+/g);
    if (!numbers || numbers.length === 0) continue;
    try {
      return { rate: Number(numbers[0]), asOf: normaliseDate(line) };
    } catch {
      // Matched the label and carried a number, but no date on the row — keep
      // looking rather than dating it ourselves.
    }
  }

  throw new FxParseError(
    `matched ${candidates.length} line(s) for ${rateLabel} but none carried both a rate and a date`,
  );
}
