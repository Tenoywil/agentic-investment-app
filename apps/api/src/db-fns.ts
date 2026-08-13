import type { Transaction } from '@ccn/db';
import { sql } from 'drizzle-orm';

/**
 * Thin, typed wrappers over the SECURITY DEFINER database functions
 * (packages/db/migrations/0001_security.sql). These are the ONLY way the app
 * writes orders or the audit log — direct INSERT/UPDATE is denied to the app
 * role. Each runs inside the caller's RLS transaction; the function body runs as
 * its privileged owner, audits, and emits a pg_notify('ccn_events', …).
 */

/** The `orders` row shape returned by the order functions (snake_case columns). */
export interface OrderRow {
  id: string;
  user_id: string;
  partner_id: string;
  instrument_id: string | null;
  approval_id: string | null;
  status: 'created' | 'accepted' | 'settled' | 'rejected' | 'expired';
  amount_minor: string; // bigint → string over the wire
  currency: 'USD' | 'JMD' | 'TTD';
  idempotency_key: string;
  client_ref: string | null;
  settlement_eta: string | null;
  rejected_reason: string | null;
  created_by: 'user' | 'agent' | 'compliance' | 'system';
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  settled_at: string | null;
}

function firstRow(result: unknown): OrderRow {
  const row = (result as OrderRow[])[0];
  if (!row) throw new Error('database function returned no row');
  return row;
}

export interface CreateOrderArgs {
  userId: string;
  partnerId: string;
  instrumentId: string | null;
  approvalId: string | null;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  clientRef: string | null;
  createdBy: 'user' | 'agent' | 'compliance' | 'system';
}

/** The single order-creation choke point. Idempotent on idempotencyKey. */
export async function createOrder(tx: Transaction, a: CreateOrderArgs): Promise<OrderRow> {
  const result = await tx.execute(
    sql`select * from create_order(
      ${a.userId}::uuid, ${a.partnerId}::uuid, ${a.instrumentId}::uuid, ${a.approvalId}::uuid,
      ${a.amountMinor}::bigint, ${a.currency}::currency, ${a.idempotencyKey}::text,
      ${a.clientRef}::text, ${a.createdBy}::actor_type)`,
  );
  return firstRow(result);
}

export async function acceptOrder(
  tx: Transaction,
  orderId: string,
  partnerId: string,
): Promise<OrderRow> {
  return firstRow(
    await tx.execute(sql`select * from accept_order(${orderId}::uuid, ${partnerId}::uuid)`),
  );
}

export async function settleOrder(
  tx: Transaction,
  orderId: string,
  partnerId: string,
): Promise<OrderRow> {
  return firstRow(
    await tx.execute(sql`select * from settle_order(${orderId}::uuid, ${partnerId}::uuid)`),
  );
}

export async function rejectOrder(
  tx: Transaction,
  orderId: string,
  partnerId: string,
  reason: string,
): Promise<OrderRow> {
  return firstRow(
    await tx.execute(
      sql`select * from reject_order(${orderId}::uuid, ${partnerId}::uuid, ${reason}::text)`,
    ),
  );
}

export interface AuditArgs {
  actorType: 'user' | 'agent' | 'compliance' | 'system';
  actorId: string | null;
  userId: string | null;
  partnerId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail?: Record<string, unknown>;
}

/** Append one immutable, hash-chained audit row via the SECURITY DEFINER fn. */
export async function auditAppend(tx: Transaction, a: AuditArgs): Promise<void> {
  await tx.execute(
    sql`select audit_append(${a.actorType}::actor_type, ${a.actorId}::uuid, ${a.userId}::uuid,
      ${a.partnerId}::uuid, ${a.action}::text, ${a.entityType}::text, ${a.entityId}::uuid,
      ${JSON.stringify(a.detail ?? {})}::jsonb)`,
  );
}

/**
 * Match a pending reconciliation item → a holding, via the SECURITY DEFINER
 * choke point. Returns the new holding id. Imported holdings are written ONLY
 * through this function, never a direct INSERT by the app role.
 */
export async function reconcileMatch(tx: Transaction, itemId: string): Promise<string> {
  const result = await tx.execute(sql`select reconcile_match(${itemId}::uuid) as holding_id`);
  const row = (result as unknown as { holding_id: string }[])[0];
  if (!row) throw new Error('reconcile_match returned no holding');
  return row.holding_id;
}

/** Dismiss a pending reconciliation item without creating a holding. */
export async function reconcileReject(
  tx: Transaction,
  itemId: string,
  reason: string,
): Promise<void> {
  await tx.execute(sql`select reconcile_reject(${itemId}::uuid, ${reason}::text)`);
}
