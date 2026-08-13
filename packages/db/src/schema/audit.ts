import { bigint, bigserial, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { actorType } from './enums';
import { createdAt } from './helpers';

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
