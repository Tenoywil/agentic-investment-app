/**
 * @ccn/money — pure minor-unit money + FX/spread arithmetic.
 *
 * Money is an integer number of MINOR units (cents) carried in a `bigint`,
 * tagged with its currency — never a float, so precision cannot silently erode.
 * This is the only module that does money math; everything else (limits engine,
 * orders, portfolio) composes these functions. No I/O, no clock, no randomness.
 *
 * Ported from the prototype's `rates = {USD:1, JMD:157.2, TTD:6.79}` and its
 * `fmt()` (whole-major-unit, en-US grouped).
 */

export type Currency = 'USD' | 'JMD' | 'TTD' | 'GYD' | 'BBD' | 'XCD' | 'BSD';

export const CURRENCIES: readonly Currency[] = [
  'USD',
  'JMD',
  'TTD',
  'GYD',
  'BBD',
  'XCD',
  'BSD',
] as const;

/** Minor units per major unit. All corridor currencies use cents. */
export const MINOR_PER_MAJOR = 100n;

/** Display symbol per currency (matches the prototype's `cursym`). */
export const SYMBOL: Record<Currency, string> = {
  USD: 'US$',
  JMD: 'J$',
  TTD: 'TT$',
  GYD: 'G$',
  BBD: 'Bds$',
  XCD: 'EC$',
  BSD: 'B$',
};

/** Full name per currency, for pickers where a code alone is unhelpful. */
export const CURRENCY_NAME: Record<Currency, string> = {
  USD: 'US dollar',
  JMD: 'Jamaican dollar',
  TTD: 'Trinidad & Tobago dollar',
  GYD: 'Guyanese dollar',
  BBD: 'Barbadian dollar',
  XCD: 'Eastern Caribbean dollar',
  BSD: 'Bahamian dollar',
};

/** A money amount: integer minor units + its currency. Immutable. */
export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

/** FX scale: rates are carried as micro-units (×1e6) so the math stays integer. */
export const FX_SCALE = 1_000_000n;

/**
 * USD-base FX table: `quoteMicros[C]` = how many micro-units of C equal 1 USD.
 * From the prototype rates. A rate of 1 USD → 157.2 JMD is `157_200_000n`.
 */
export type FxTable = Record<Currency, bigint>;

export const DEFAULT_FX: FxTable = {
  USD: 1_000_000n,
  JMD: 157_200_000n,
  TTD: 6_790_000n,
  // The four below are long-standing pegs (GYD is managed near 209), so the
  // seeded fallback is less wrong for them than for a floating rate — but a
  // screen still reports `seed` rows as unpublished and stale.
  GYD: 209_000_000n,
  BBD: 2_000_000n,
  XCD: 2_700_000n,
  BSD: 1_000_000n,
};

function isCurrency(x: string): x is Currency {
  return (CURRENCIES as readonly string[]).includes(x);
}

/** Round-half-up on magnitude (symmetric for negatives): 2.5→3, -2.5→-3. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('money: division by zero');
  const neg = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const q = (a + b / 2n) / b;
  return neg ? -q : q;
}

/** Construct money from minor units (bigint | integer number). */
export function money(minor: bigint | number, currency: Currency): Money {
  const m = typeof minor === 'bigint' ? minor : BigInt(Math.trunc(minor));
  return { minor: m, currency };
}

/** Construct money from a major-unit amount (e.g. 13_400 dollars). Rounds. */
export function fromMajor(major: number, currency: Currency): Money {
  return { minor: BigInt(Math.round(major * 100)), currency };
}

/** Minor units as a major-unit float. Lossy — for display/scoring only. */
export function toMajorNumber(m: Money): number {
  return Number(m.minor) / 100;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`money: currency mismatch ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

/** Sum a list; empty defaults to zero in `currency` (required to avoid ambiguity). */
export function sum(items: readonly Money[], currency: Currency): Money {
  let total = 0n;
  for (const it of items) {
    if (it.currency !== currency) {
      throw new Error(`money: cannot sum ${it.currency} into ${currency}`);
    }
    total += it.minor;
  }
  return { minor: total, currency };
}

/** -1 | 0 | 1 comparing a to b (same currency). */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export const isZero = (m: Money): boolean => m.minor === 0n;
export const isNegative = (m: Money): boolean => m.minor < 0n;
export const isPositive = (m: Money): boolean => m.minor > 0n;
export const gte = (a: Money, b: Money): boolean => compare(a, b) >= 0;
export const gt = (a: Money, b: Money): boolean => compare(a, b) > 0;
export const lte = (a: Money, b: Money): boolean => compare(a, b) <= 0;
export const lt = (a: Money, b: Money): boolean => compare(a, b) < 0;

/**
 * Convert money to another currency via the USD-base table. Cross rates go
 * through USD: minorTo = round(minorFrom × quote(to) / quote(from)). Integer
 * throughout; only the final unit is rounded half-up.
 */
export function convert(m: Money, to: Currency, fx: FxTable = DEFAULT_FX): Money {
  if (m.currency === to) return m;
  const from = fx[m.currency];
  const dest = fx[to];
  return { minor: divRound(m.minor * dest, from), currency: to };
}

/**
 * Basis points a quoted rate deviates from a reference (mid) rate:
 * round(|quoted − reference| / reference × 10_000). Rates may be any positive
 * unit as long as both share it. Used by the FX-spread guardrail.
 */
export function spreadBps(quotedMicros: bigint, referenceMicros: bigint): number {
  if (referenceMicros <= 0n) throw new Error('money: reference rate must be positive');
  const diff =
    quotedMicros > referenceMicros
      ? quotedMicros - referenceMicros
      : referenceMicros - quotedMicros;
  return Number(divRound(diff * 10_000n, referenceMicros));
}

/**
 * `part` as a percentage of `whole`, rounded to an integer percent (for display
 * and scoring). Returns 0 when `whole` is 0. Use `atMostPercent` for an exact
 * guardrail comparison — this rounds and must not gate money movement.
 */
export function percentOf(part: Money, whole: Money): number {
  assertSameCurrency(part, whole);
  if (whole.minor === 0n) return 0;
  return Number(divRound(part.minor * 100n, whole.minor));
}

/**
 * Exact guardrail check: is `part` at most `pct`% of `whole`? Pure integer
 * comparison (part×100 ≤ whole×pct) with no rounding, so a position exactly on
 * the cap passes and one cent over fails.
 */
export function atMostPercent(part: Money, whole: Money, pct: number): boolean {
  assertSameCurrency(part, whole);
  if (whole.minor <= 0n) return part.minor <= 0n;
  return part.minor * 100n <= whole.minor * BigInt(pct);
}

/**
 * Format money like the prototype: symbol + whole major units, en-US grouped
 * (e.g. `US$13,400`). Rounds to the nearest major unit; pass `{ minorDigits: 2 }`
 * for cents.
 */
export function formatMoney(m: Money, opts: { minorDigits?: 0 | 2 } = {}): string {
  const digits = opts.minorDigits ?? 0;
  const major = Number(m.minor) / 100;
  const value = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  return `${SYMBOL[m.currency]}${value}`;
}

/** Parse a minor-unit string/number (e.g. from the DB bigint column) safely. */
export function parseMinor(value: string | number | bigint, currency: string): Money {
  if (!isCurrency(currency)) throw new Error(`money: unknown currency ${currency}`);
  return { minor: BigInt(value), currency };
}
