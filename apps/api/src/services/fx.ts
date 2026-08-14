import { fxRates } from '@ccn/db';
import { type FetchLike, allSources, fetchRate } from '@ccn/fx-rates/sources';
import { CURRENCIES, type Currency, DEFAULT_FX, FX_SCALE, type FxTable } from '@ccn/money';
import type { AppDeps } from '../context';
import { isDatabaseBehind } from '../migrations';

/**
 * Exchange rates, from the banks that publish them.
 *
 * `convert()` takes an optional FX table and defaults to `DEFAULT_FX` — three
 * bigints written into @ccn/money from the prototype. Every call site omitted
 * the argument, so that default was the only rate the product ever used, and the
 * seeded `fx_rates` table was read by nothing but a `count(*)`. An investor
 * switching to JMD saw their net worth restated at a rate nobody had checked in
 * months, rendered as confidently as the balance itself.
 *
 * This reads the table instead, and carries the publisher and the publication
 * date alongside it so a screen can say how old the number is. CCN routes orders
 * and holds no money; the rate is the central bank's, and so is the date.
 */

/** How old a published rate may be before a screen should say so. */
export const STALE_AFTER_DAYS = 4;

export interface RateMeta {
  currency: Currency;
  /** The publisher's date, `YYYY-MM-DD`. Null for a seeded fallback. */
  asOf: string | null;
  /** `BOJ`, `CBTT`, or `seed` when no bank stands behind it. */
  source: string | null;
  stale: boolean;
  /**
   * No rate could be read at all — the table is unreadable because this database
   * is behind the code. Distinct from `stale`, which means an old rate that is
   * still a real published one. A currency marked this way must not be converted
   * to; the caller serves the base currency instead.
   */
  unavailable: boolean;
}

export interface FxSnapshot {
  table: FxTable;
  rates: RateMeta[];
  /** True when the rate table could not be read and USD is all that is safe. */
  degraded: boolean;
}

/** Whole days between a published date and now. */
function ageInDays(asOf: string, now: Date): number {
  const published = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(published)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - published) / 86_400_000);
}

/**
 * Read the current table.
 *
 * A currency with no row falls back to `DEFAULT_FX` and is reported as having no
 * source and being stale, which is the truth about it. Falling back silently is
 * what this module exists to stop.
 *
 * A table that cannot be read at all is a different failure and gets a different
 * answer. When this database is behind the code — no `as_of` column, because
 * `0016_fx_as_of` was never applied — every non-base currency is marked
 * `unavailable` and the caller serves USD. That was worth building because the
 * alternative is what actually happened: one missing column 500ing the main
 * investor screen for everybody. It is deliberately *not* a quiet fall back to
 * `DEFAULT_FX`; converting somebody's net worth at a rate nobody published is
 * the failure this module was written to end, and doing it during an incident
 * would be the worst moment to start.
 */
export async function loadFxTable(tx: AnyTx, now: Date = new Date()): Promise<FxSnapshot> {
  let rows: {
    quote: Currency;
    rate: string;
    asOf: string | null;
    source: string | null;
  }[];

  try {
    rows = (await tx
      .select({
        quote: fxRates.quoteCurrency,
        rate: fxRates.rate,
        asOf: fxRates.asOf,
        source: fxRates.source,
      })
      .from(fxRates)) as typeof rows;
  } catch (error) {
    if (!isDatabaseBehind(error)) throw error;
    return {
      table: { ...DEFAULT_FX },
      rates: CURRENCIES.map((currency) => ({
        currency,
        asOf: null,
        source: null,
        // USD is the base: no rate is read for it and none is needed, so it is
        // never unavailable however far behind the database is.
        stale: currency !== 'USD',
        unavailable: currency !== 'USD',
      })),
      degraded: true,
    };
  }

  const table: FxTable = { ...DEFAULT_FX };
  const rates: RateMeta[] = [];

  for (const currency of ['USD', 'JMD', 'TTD'] as const) {
    if (currency === 'USD') {
      // The base. Always exactly one, never stale, nobody publishes it.
      rates.push({ currency, asOf: null, source: null, stale: false, unavailable: false });
      continue;
    }
    const row = rows.find((r) => r.quote === currency);
    if (row) {
      // `rate` is numeric(18,6) and arrives as a string; scaling through the
      // decimal string rather than a float keeps the conversion integer, which
      // is the whole point of carrying money in minor units.
      table[currency] = toMicros(row.rate);
    }
    rates.push({
      currency,
      asOf: row?.asOf ?? null,
      source: row?.source ?? null,
      stale: !row?.asOf || ageInDays(row.asOf, now) > STALE_AFTER_DAYS,
      // A missing row is a rate nobody has loaded yet, not an unreadable table.
      // The seeded fallback still converts; it is reported as `seed` and stale.
      unavailable: false,
    });
  }

  return { table, rates, degraded: false };
}

/** `"157.903400"` → `157_903_400n`, without going through a float. */
export function toMicros(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.trim().split('.');
  const micros = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * FX_SCALE + BigInt(micros || '0');
}

/**
 * Pull today's rates and store them.
 *
 * Each source is independent: one bank being unreachable must not cost the
 * other its update. A failure leaves the stored rate exactly as it was — the
 * screen then reports it as stale, which is accurate — rather than substituting
 * anything.
 */
export async function refreshFxRates(
  deps: Pick<AppDeps, 'db' | 'logger' | 'config'>,
  doFetch: FetchLike,
): Promise<{ updated: string[]; failed: { source: string; error: string }[] }> {
  const sources = allSources({
    bojUrl: deps.config.FX_BOJ_URL || undefined,
    cbttUrl: deps.config.FX_CBTT_URL || undefined,
  });

  const updated: string[] = [];
  const failed: { source: string; error: string }[] = [];

  const results = await Promise.allSettled(sources.map((s) => fetchRate(s, doFetch)));

  for (const [i, result] of results.entries()) {
    const source = sources[i];
    if (!source) continue;
    if (result.status === 'rejected') {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      deps.logger.error(
        `could not refresh the ${source.publisher} rate; the stored rate stands and will be shown as stale`,
        { source: source.source, url: source.url, error },
      );
      failed.push({ source: source.source, error });
      continue;
    }

    const { quote, rate, asOf, source: code } = result.value;
    await deps.db
      .insert(fxRates)
      .values({
        baseCurrency: 'USD',
        quoteCurrency: quote,
        rate: rate.toFixed(6),
        asOf,
        source: code,
      })
      .onConflictDoUpdate({
        target: [fxRates.baseCurrency, fxRates.quoteCurrency],
        set: { rate: rate.toFixed(6), asOf, source: code },
      });

    deps.logger.info('fx rate refreshed', { source: code, quote, rate, asOf });
    updated.push(quote);
  }

  return { updated, failed };
}

/** The narrow slice of a Drizzle transaction this module needs. */
// biome-ignore lint/suspicious/noExplicitAny: the tx type is generic over the whole schema
type AnyTx = { select: (...args: any[]) => any };
