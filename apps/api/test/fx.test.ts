import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, fxRates } from '@ccn/db';
import { DEFAULT_FX, convert, money } from '@ccn/money';
import { and, eq } from 'drizzle-orm';
import { STALE_AFTER_DAYS, loadFxTable, toMicros } from '../src/services/fx';

/**
 * Conversion reads the rate the database holds, not the one compiled into
 * @ccn/money.
 *
 * `convert()` takes an optional FX table and falls back to `DEFAULT_FX` — three
 * bigints carried over from the prototype. Every call site omitted the argument,
 * so that fallback *was* the product's exchange rate, while the seeded
 * `fx_rates` table sat unread behind a `count(*)` on the admin overview. The bug
 * was invisible in the worst way: the screen looked right, the arithmetic was
 * correct, and only the rate was months old.
 *
 * These assert the two halves that keep it fixed — that a rate written to the
 * table actually reaches a conversion, and that an old or unattributed rate is
 * reported as such instead of being silently used.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

describe('scaling a published rate', () => {
  test('goes through the decimal string, never a float', () => {
    expect(toMicros('157.903400')).toBe(157_903_400n);
    expect(toMicros('6.79')).toBe(6_790_000n);
    expect(toMicros('1')).toBe(1_000_000n);
    // 0.1 + 0.2 arithmetic has no place anywhere near somebody's net worth.
    expect(toMicros('157.1')).toBe(157_100_000n);
  });
});

suite('fx rates come from the database', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 2 });
  const { db } = handle;

  /** Deliberately nothing like the compiled-in 157.2, so the two cannot be confused. */
  const PUBLISHED = '161.500000';
  let original: { rate: string; asOf: string | null; source: string | null } | null = null;

  beforeAll(async () => {
    const [row] = await db
      .select({ rate: fxRates.rate, asOf: fxRates.asOf, source: fxRates.source })
      .from(fxRates)
      .where(and(eq(fxRates.baseCurrency, 'USD'), eq(fxRates.quoteCurrency, 'JMD')));
    original = row ?? null;
  });

  afterAll(async () => {
    if (original) {
      await db
        .update(fxRates)
        .set(original)
        .where(and(eq(fxRates.baseCurrency, 'USD'), eq(fxRates.quoteCurrency, 'JMD')));
    }
    await handle.client.end();
  });

  test('a rate written to the table is the rate a conversion uses', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db
      .update(fxRates)
      .set({ rate: PUBLISHED, asOf: today, source: 'BOJ' })
      .where(and(eq(fxRates.baseCurrency, 'USD'), eq(fxRates.quoteCurrency, 'JMD')));

    const { table, rates } = await loadFxTable(db);

    expect(table.JMD).toBe(161_500_000n);
    expect(table.JMD).not.toBe(DEFAULT_FX.JMD);

    // The number on the screen, end to end: US$1,000 at the published rate.
    const converted = convert(money(100_000n, 'USD'), 'JMD', table);
    expect(converted.minor).toBe(16_150_000n);
    // And what it would have been on the compiled-in table, which is the
    // difference an investor was being shown without knowing it.
    expect(convert(money(100_000n, 'USD'), 'JMD').minor).toBe(15_720_000n);

    const jmd = rates.find((r) => r.currency === 'JMD');
    expect(jmd).toMatchObject({ source: 'BOJ', asOf: today, stale: false });
  });

  test('an old rate is reported stale rather than quietly used', async () => {
    const old = new Date(Date.now() - (STALE_AFTER_DAYS + 3) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db
      .update(fxRates)
      .set({ rate: PUBLISHED, asOf: old, source: 'BOJ' })
      .where(and(eq(fxRates.baseCurrency, 'USD'), eq(fxRates.quoteCurrency, 'JMD')));

    const { table, rates } = await loadFxTable(db);

    // Still used — an old published rate beats a made-up fresh one — but the
    // screen is told, and says so next to the figure.
    expect(table.JMD).toBe(161_500_000n);
    expect(rates.find((r) => r.currency === 'JMD')).toMatchObject({ stale: true, asOf: old });
  });

  test('a rate no bank published is never reported as fresh', async () => {
    await db
      .update(fxRates)
      .set({ asOf: null, source: 'seed' })
      .where(and(eq(fxRates.baseCurrency, 'USD'), eq(fxRates.quoteCurrency, 'JMD')));

    const { rates } = await loadFxTable(db);
    expect(rates.find((r) => r.currency === 'JMD')).toMatchObject({
      source: 'seed',
      asOf: null,
      stale: true,
    });
  });

  test('USD is the base and is never stale', async () => {
    const { table, rates } = await loadFxTable(db);
    expect(table.USD).toBe(1_000_000n);
    expect(rates.find((r) => r.currency === 'USD')).toMatchObject({ stale: false });
  });
});
