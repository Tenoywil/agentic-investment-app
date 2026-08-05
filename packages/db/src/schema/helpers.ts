import { bigint, timestamp } from 'drizzle-orm/pg-core';

/**
 * Money is stored as an integer number of MINOR units (e.g. USD cents) in a
 * bigint, never as a float — the `@ccn/money` package owns all arithmetic. Using
 * bigint mode surfaces the value as a JS BigInt so precision cannot silently be
 * lost the way it can with float dollars.
 */
export const moneyMinor = (name: string) => bigint(name, { mode: 'bigint' });

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
