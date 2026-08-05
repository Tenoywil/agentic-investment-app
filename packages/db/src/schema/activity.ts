import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  actorType,
  approvalStatus,
  approvalType,
  currency,
  orderStatus,
  reconciliationStatus,
} from './enums';
import { createdAt, moneyMinor, updatedAt } from './helpers';
import { instruments, partners } from './market';

/**
 * Per-user guardrail policy — the exact input to the deterministic Limits Engine.
 * Each rule has a value plus an enabled flag (mirrors the prototype's ruleOn
 * array). Defaults come straight from the prototype's rulesData.
 */
export const limits = pgTable('limits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  autoInvestCapMinor: moneyMinor('auto_invest_cap_minor').notNull().default(sql`50000`), // US$500
  autoInvestEnabled: boolean('auto_invest_enabled').notNull().default(true),
  cashFloorMinor: moneyMinor('cash_floor_minor').notNull().default(sql`100000`), // US$1,000
  cashFloorEnabled: boolean('cash_floor_enabled').notNull().default(true),
  fxSpreadMaxBps: integer('fx_spread_max_bps').notNull().default(30), // 0.3%
  fxSpreadEnabled: boolean('fx_spread_enabled').notNull().default(true),
  requireApprovalAboveMinor: moneyMinor('require_approval_above_minor')
    .notNull()
    .default(sql`100000`), // US$1,000
  requireApprovalEnabled: boolean('require_approval_enabled').notNull().default(true),
  singlePositionMaxPct: integer('single_position_max_pct').notNull().default(15),
  singlePositionEnabled: boolean('single_position_enabled').notNull().default(true),
  dailyCapMinor: moneyMinor('daily_cap_minor'),
  dailyCapEnabled: boolean('daily_cap_enabled').notNull().default(false),
  updatedAt: updatedAt(),
});

/**
 * "Needs your approval" cards — the human-in-the-loop escalation. Created by the
 * Limits Engine's RequiresApproval branch; an approved card is one of only two
 * paths to an order. Snapshot freezes the proposal for the audit trail.
 */
export const approvals = pgTable('approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  type: approvalType('type').notNull(),
  status: approvalStatus('status').notNull().default('pending'),
  instrumentId: uuid('instrument_id').references(() => instruments.id),
  title: text('title').notNull(),
  body: text('body'),
  amountMinor: moneyMinor('amount_minor'),
  currency: currency('currency').notNull().default('USD'),
  snapshot: jsonb('snapshot').notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Orders. Rows are inserted ONLY via the SECURITY DEFINER `create_order`
 * function, called after the Limits Engine passes (auto-act) or an approval is
 * granted — the single order-creation choke point. `idempotencyKey` makes retries
 * safe; every state transition writes an audit entry and a pg_notify event.
 */
export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id')
    .notNull()
    .references(() => partners.id),
  instrumentId: uuid('instrument_id').references(() => instruments.id),
  approvalId: uuid('approval_id').references(() => approvals.id),
  status: orderStatus('status').notNull().default('created'),
  amountMinor: moneyMinor('amount_minor').notNull(),
  currency: currency('currency').notNull().default('USD'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  clientRef: text('client_ref'), // masked reference shown to partner operators, e.g. "Client ••7134"
  settlementEta: timestamp('settlement_eta', { withTimezone: true }), // T+2
  rejectedReason: text('rejected_reason'),
  createdBy: actorType('created_by').notNull().default('user'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});

/** Planning goals with progress rings. */
export const goals = pgTable('goals', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetMinor: moneyMinor('target_minor').notNull(),
  currentMinor: moneyMinor('current_minor').notNull().default(sql`0`),
  fromLabel: text('from_label'), // "NCB · Sagicor"
  pct: integer('pct').notNull().default(0),
  eta: text('eta'),
  color: text('color'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Agent chat transcript. role is 'agent' | 'user'. */
export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'agent' | 'user' (checked in migration)
  content: text('content').notNull(),
  createdAt: createdAt(),
});

/**
 * Statement-ingestion reconciliation queue. Ingested/partner text is DATA, never
 * instructions — it lands here for human review before becoming holdings, which
 * is also the prompt-injection firebreak.
 */
export const reconciliationItems = pgTable('reconciliation_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').references(() => partners.id),
  source: text('source').notNull().default('statement_ingestion'),
  storagePath: text('storage_path'),
  raw: jsonb('raw').notNull().default({}),
  parsed: jsonb('parsed').notNull().default({}),
  status: reconciliationStatus('status').notNull().default('pending'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Retrieval embeddings (bge-small-en-v1.5, 384-dim). HNSW index added in migration. */
export const embeddings = pgTable('embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  subjectType: text('subject_type').notNull(), // e.g. 'instrument'
  subjectId: uuid('subject_id'),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 384 }).notNull(),
  createdAt: createdAt(),
});
