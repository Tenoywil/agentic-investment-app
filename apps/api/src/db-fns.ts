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

/**
 * One row of the client list a partner console shows: the person, and the KYC
 * package CCN passes across with their consent. Columns are snake_case, like
 * every other database function's result.
 */
export interface PartnerClientRow {
  account_id: string;
  status: 'pending' | 'active' | 'declined';
  label: string | null;
  requested_at: string;
  reviewed_at: string | null;
  decline_reason: string | null;
  user_id: string;
  client_name: string;
  client_email: string;
  residency_country: string | null;
  kyc_tier: 'none' | 'tier1' | 'tier2';
  identity_verified: boolean;
  compliance_confirmed: boolean;
  risk_completed: boolean;
  funds_confirmed: boolean;
  is_pep: boolean;
  tax_residency_declared: boolean;
  sources: string[];
  risk_band: string | null;
  holdings_count: number;
  holdings_value_minor: string; // bigint → string over the wire
}

/**
 * The clients who have linked an account at the caller's firm.
 *
 * Takes no partner argument: the function reads `app.current_partner_id` from
 * the transaction, so there is no id an operator could substitute for another
 * firm's. It is the only path to a client's KYC — `kyc_status` and `user` are
 * not readable by the app role on anyone but the caller.
 */
export async function partnerClients(tx: Transaction): Promise<PartnerClientRow[]> {
  return (await tx.execute(sql`select * from partner_clients()`)) as unknown as PartnerClientRow[];
}

/**
 * Accept or decline one pending connection. Returns the status it moved to.
 * Throws when the connection is not this partner's, is not pending, or (on
 * accept) when the client has no KYC at all to review.
 */
export async function partnerReviewClient(
  tx: Transaction,
  accountId: string,
  accept: boolean,
  reason: string | null,
): Promise<'active' | 'declined'> {
  const result = await tx.execute(
    sql`select partner_review_client(${accountId}::uuid, ${accept}::boolean, ${reason}::text) as status`,
  );
  const row = (result as unknown as { status: 'active' | 'declined' }[])[0];
  if (!row) throw new Error('partner_review_client returned no status');
  return row.status;
}

/**
 * One instrument as `partner_upsert_instrument` returns it.
 *
 * Snake_case and driver-shaped, because this is `RETURNS instruments` coming
 * back through a raw `execute` rather than a Drizzle select: postgres.js hands
 * back int8 as a string and timestamptz as a `Date`, and the caller maps both.
 */
export interface InstrumentRow {
  id: string;
  partner_id: string | null;
  slug: string;
  abbr: string;
  type: string;
  name: string;
  region: string | null;
  metric: string | null;
  metric_label: string | null;
  min_investment_minor: string;
  currency: string;
  term: string | null;
  risk: string | null;
  description: string | null;
  listing_status: 'live' | 'paused';
  blocked: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertInstrumentArgs {
  /** Null creates; otherwise amends, and only a row this partner already owns. */
  id: string | null;
  name: string;
  type: string;
  abbr: string;
  currency: string;
  minInvestmentMinor: bigint;
  term: string | null;
  metric: string | null;
  metricLabel: string | null;
  risk: string | null;
  description: string | null;
  region: string | null;
}

/**
 * List or amend one of the caller's own instruments.
 *
 * The partner comes from the transaction's GUC inside the function, never from
 * an argument — the same shape `partner_review_client` uses, and for the same
 * reason: `instruments` also holds the seeded reference catalogue, and a console
 * that could name its own partner id could edit somebody else's product. The
 * regulator and the slug are set by the function too; neither is a firm's to
 * type.
 */
export async function partnerUpsertInstrument(
  tx: Transaction,
  args: UpsertInstrumentArgs,
): Promise<InstrumentRow> {
  const rows = (await tx.execute(
    sql`select * from partner_upsert_instrument(
      ${args.id}::uuid,
      ${args.name}::text,
      ${args.type}::instrument_type,
      ${args.abbr}::text,
      ${args.currency}::currency,
      ${args.minInvestmentMinor.toString()}::bigint,
      ${args.term}::text,
      ${args.metric}::text,
      ${args.metricLabel}::text,
      ${args.risk}::risk_rating,
      ${args.description}::text,
      ${args.region}::text
    )`,
  )) as unknown as InstrumentRow[];
  const row = rows[0];
  if (!row) throw new Error('partner_upsert_instrument returned no row');
  return row;
}

/** Take one of the caller's instruments off the marketplace, or put it back. */
export async function partnerToggleInstrument(
  tx: Transaction,
  id: string,
): Promise<'live' | 'paused'> {
  const rows = (await tx.execute(
    sql`select partner_toggle_instrument(${id}::uuid) as status`,
  )) as unknown as { status: 'live' | 'paused' }[];
  const row = rows[0];
  if (!row) throw new Error('partner_toggle_instrument returned no row');
  return row.status;
}
