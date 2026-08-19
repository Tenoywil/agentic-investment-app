import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorType, webhookDeliveryStatus } from './enums';
import { createdAt, updatedAt } from './helpers';

/**
 * Immutable, append-only audit log. Enforced in the DB (0004 migration): no
 * UPDATE/DELETE grants, a BEFORE UPDATE OR DELETE trigger that raises, appends
 * only via a SECURITY DEFINER function, and a SHA-256 hash chain (`prevHash` →
 * `hash`) so any tampering breaks verification. Rows are never mutated from
 * application code — inserts go through `audit_append(...)`.
 *
 * (Scale path: RANGE-partition by `created_at` monthly. Additive; does not change
 * the integrity properties above.)
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  seq: bigserial('seq', { mode: 'bigint' }).notNull(),
  actorType: actorType('actor_type').notNull(),
  actorId: uuid('actor_id'),
  userId: uuid('user_id'),
  partnerId: uuid('partner_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  detail: jsonb('detail').notNull().default({}),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  createdAt: createdAt(),
});

/** Nightly hash-chain checkpoints for tamper-evidence over the whole log. */
export const auditLogCheckpoints = pgTable('audit_log_checkpoints', {
  id: uuid('id').defaultRandom().primaryKey(),
  throughSeq: bigint('through_seq', { mode: 'bigint' }).notNull(),
  rowCount: bigint('row_count', { mode: 'bigint' }).notNull(),
  checkpointHash: text('checkpoint_hash').notNull(),
  createdAt: createdAt(),
});

/**
 * One optional outbound audit-event endpoint per partner. The signing secret
 * is AES-GCM ciphertext; plaintext is returned only when created or rotated.
 * Foreign keys and tenant RLS live in 0033 because they are security-critical
 * DDL rather than application conventions.
 */
export const partnerWebhookEndpoints = pgTable(
  'partner_webhook_endpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id').notNull(),
    url: text('url').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('partner_webhook_endpoints_partner_uq').on(table.partnerId)],
);

/**
 * Immutable event snapshots plus mutable delivery state. A database trigger
 * copies each partner audit row into this outbox in the same transaction, so a
 * process crash cannot create an unaudited gap between commit and enqueue.
 */
export const partnerWebhookDeliveries = pgTable(
  'partner_webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    endpointId: uuid('endpoint_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    auditLogId: uuid('audit_log_id'),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lockToken: uuid('lock_token'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('partner_webhook_deliveries_event_uq').on(table.endpointId, table.eventId),
    index('partner_webhook_deliveries_dispatch_idx').on(
      table.status,
      table.nextAttemptAt,
      table.lockedUntil,
    ),
    index('partner_webhook_deliveries_partner_idx').on(table.partnerId, table.createdAt),
  ],
);
