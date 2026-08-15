import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  agreementStatus,
  connectionStatus,
  currency,
  instrumentType,
  listingStatus,
  planningStatus,
  productListingStatus,
  regulator,
  riskRating,
  withdrawalStatus,
} from './enums';
import { createdAt, moneyMinor, updatedAt } from './helpers';

/**
 * FSC-licensed partners (custody + execution). Reference data, readable by all
 * authenticated users. `agreementStatus` gates live order routing — the adapter
 * registry refuses `placeOrder` unless a partner is `live` with trade scope.
 */
export const partners = pgTable('partners', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Text, not an enum: the set of licensed institutions is the business, not a
  // schema-time constant. Shape and uniqueness are enforced by the database
  // (0011_partner_onboarding.sql) — a code is a short uppercase identifier.
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind'),
  regulator: regulator('regulator'),
  agreementStatus: agreementStatus('agreement_status').notNull().default('prospect'),
  residency: text('residency'),
  /** The firm's own instructions for funding an account (bank, account,
   *  reference). Free text; shown to its accepted clients. */
  fundingInstructions: text('funding_instructions'),
  /** Flat per-withdrawal fee in minor units of the withdrawal currency. */
  withdrawalFeeFlatMinor: moneyMinor('withdrawal_fee_flat_minor').notNull().default(sql`0`),
  /** Percentage fee on the withdrawal amount, basis points (100 = 1%). */
  withdrawalFeeBps: integer('withdrawal_fee_bps').notNull().default(0),
  /** Consumption tax (e.g. Jamaica's GCT) applied to the fee, basis points. */
  gctBps: integer('gct_bps').notNull().default(0),
  color: text('color'),
  tint: text('tint'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * The opportunities marketplace. Reference data. `blocked` + `blockReasons`
 * encode deals the agent screens out (e.g. the Beachfront Villas note) — the
 * Limits Engine returns these reasons on the Blocked branch.
 */
export const instruments = pgTable('instruments', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(), // prototype id, e.g. "goj32", "slbd"
  abbr: text('abbr').notNull(),
  type: instrumentType('type').notNull(),
  partnerId: uuid('partner_id').references(() => partners.id),
  regulator: regulator('regulator'),
  name: text('name').notNull(),
  region: text('region'),
  metricLabel: text('metric_label'),
  metric: text('metric'),
  minInvestmentMinor: moneyMinor('min_investment_minor').notNull().default(sql`0`),
  currency: currency('currency').notNull().default('USD'),
  term: text('term'),
  risk: riskRating('risk'),
  description: text('description'),
  agentNote: text('agent_note'),
  /** Whether the marketplace offers it. Set by the listing partner's console. */
  listingStatus: listingStatus('listing_status').notNull().default('live'),
  blocked: boolean('blocked').notNull().default(false),
  blockReasons: text('block_reasons').array().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A user's connection to a partner institution (aggregated holdings source). */
export const connectedAccounts = pgTable('connected_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id),
  label: text('label'), // e.g. "GOJ Bond 2029 · Chequing"
  /**
   * The partner's side of the relationship. A connection an investor creates
   * starts `pending`: the firm reviews the KYC package CCN passes across and
   * accepts or declines it (partner_review_client, 0014). Holdings are pulled
   * only while it is `active`.
   */
  status: connectionStatus('status').notNull().default('pending'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  declineReason: text('decline_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Withdrawal requests: the investor asks their firm for money back; the firm
 * pays or declines. Rows are written ONLY through `request_withdrawal` and
 * `partner_decide_withdrawal` (0025) — the app role has SELECT alone. Paying
 * decrements the recorded cash holding, mirroring `partner_confirm_funds`.
 */
export const withdrawalRequests = pgTable('withdrawal_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id),
  connectedAccountId: uuid('connected_account_id')
    .notNull()
    .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
  amountMinor: moneyMinor('amount_minor').notNull(),
  /** The firm's fee, frozen at request time from its settings then (0026). */
  feeMinor: moneyMinor('fee_minor').notNull().default(sql`0`),
  /** Consumption tax on the fee, frozen at request time. */
  gctMinor: moneyMinor('gct_minor').notNull().default(sql`0`),
  currency: currency('currency').notNull().default('USD'),
  status: withdrawalStatus('status').notNull().default('pending'),
  /** The firm's words when it declines; the investor reads them. */
  reason: text('reason'),
  /** The firm's payment reference when it pays. */
  reference: text('reference'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Individual holdings under a connected account. Net worth = sum of value_minor. */
export const holdings = pgTable('holdings', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  connectedAccountId: uuid('connected_account_id')
    .notNull()
    .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id').references(() => instruments.id),
  name: text('name').notNull(),
  valueMinor: moneyMinor('value_minor').notNull().default(sql`0`),
  currency: currency('currency').notNull().default('USD'),
  returnLabel: text('return_label'), // e.g. "+6.8%", "settling", "—"
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * FX rates against a USD base, as published by the region's central banks.
 *
 * One current row per pair. `asOf` is the publisher's own date for the rate —
 * not when it was fetched — so a screen can say how old the number is instead of
 * implying it is live. `source` names who published it; `'seed'` marks the
 * fallback rows that no bank stands behind.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    baseCurrency: currency('base_currency').notNull().default('USD'),
    quoteCurrency: currency('quote_currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    /** The publisher's date for this rate. Null on a seeded fallback. */
    asOf: date('as_of'),
    /** Who published it, e.g. `BOJ`, `CBTT`, or `seed`. */
    source: text('source'),
    createdAt: createdAt(),
  },
  (t) => [unique('fx_rates_base_quote_uq').on(t.baseCurrency, t.quoteCurrency)],
);

/** Planning services catalog (life insurance, annuity, mortgage, …). Reference data. */
export const planningProducts = pgTable('planning_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(), // "LI", "RA", "CI", "ES", "MG", "ED"
  title: text('title').notNull(),
  provider: text('provider'),
  description: text('description'),
  status: planningStatus('status').notNull().default('available'),
  accent: text('accent'),
  tint: text('tint'),
  createdAt: createdAt(),
});

/** Console product listings, partner-scoped (RLS by partner_id). */
export const productListings = pgTable('product_listings', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type'),
  clients: integer('clients').notNull().default(0),
  aumMinor: moneyMinor('aum_minor').notNull().default(sql`0`),
  trend: text('trend'),
  status: productListingStatus('status').notNull().default('live'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Console KPI tiles, partner-scoped. */
export const partnerKpis = pgTable('partner_kpis', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  value: text('value').notNull(),
  sub: text('sub'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

/** Console onboarding funnel, partner-scoped. */
export const kycFunnelStages = pgTable('kyc_funnel_stages', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  count: integer('count').notNull().default(0),
  pct: integer('pct').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});
