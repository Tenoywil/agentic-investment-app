import { API_URL } from './config';

/**
 * Typed client for /api/console/* — the partner console (institutions
 * screen). Every request carries `credentials: 'include'` so the Better Auth
 * session cookie rides along — CORS on the API is scoped to APP_WEB_ORIGIN
 * with `credentials: true`, so this is required, not optional.
 *
 * Every route requires the caller to hold the `partner_operator` role bound
 * to a partner (see apps/api/src/routes/console.ts's `partnerScope()`); a
 * signed-in `customer` gets a 403 `{ error: 'partner operator role
 * required' }` from all of them. The console screen no longer infers access
 * from a 403 — `(institution)/layout.tsx` guards the surface and redirects
 * before any of this runs — so a 403 here is a genuine failure to report,
 * not a state to render.
 *
 * Money fields: `orders.amountMinor` and `products.aumMinor` cross the wire
 * as numeric STRINGS (raw minor units) — the API's bigintSafeJson middleware
 * stringifies bigints automatically, and neither route does its own
 * major-unit formatting. `kpis[].value` is the opposite: it arrives already
 * display-formatted (e.g. "US$4.2M") — render it as-is, never reparse it.
 */

export type ConsoleCurrency = 'USD' | 'JMD' | 'TTD';
export type ConsoleOrderStatus = 'created' | 'accepted' | 'settled' | 'rejected' | 'expired';
export type ConsoleActorType = 'user' | 'agent' | 'compliance' | 'system';
export type ConsoleProductStatus = 'live' | 'paused';
export type ConsoleReconciliationStatus = 'pending' | 'matched' | 'rejected';

export type ConsoleAgreementStatus = 'prospect' | 'dpa_pending' | 'sandbox' | 'live' | 'suspended';

/** The caller's own partner row. Same shape as `me.partner`, from the
 *  console's own partner-scoped route. */
export interface ConsolePartner {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  regulator: string | null;
  agreementStatus: ConsoleAgreementStatus | null;
  residency: string | null;
}

/** One row of the immutable, hash-chained audit log, scoped to this partner.
 *  `seq` is a bigserial and arrives as a numeric string. */
export interface ConsoleAuditEntry {
  id: string;
  seq: string;
  action: string;
  entityType: string | null;
  actorType: ConsoleActorType;
  detail: unknown;
  createdAt: string;
}

export interface ConsoleOrder {
  id: string;
  userId: string;
  partnerId: string;
  instrumentId: string | null;
  /** From a LEFT JOIN on `instruments`; null when the order has no instrument. */
  instrumentName: string | null;
  instrumentAbbr: string | null;
  approvalId: string | null;
  status: ConsoleOrderStatus;
  amountMinor: string; // raw minor units, numeric string
  currency: ConsoleCurrency;
  idempotencyKey: string;
  clientRef: string | null;
  settlementEta: string | null;
  rejectedReason: string | null;
  createdBy: ConsoleActorType;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
}

export interface ConsoleReconciliationItem {
  id: string;
  userId: string | null;
  partnerId: string | null;
  source: string;
  storagePath: string | null;
  raw: unknown;
  parsed: unknown;
  status: ConsoleReconciliationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A listed product. No `clients`, `aumMinor` or `trend`: CCN measures none of
 * them, the API no longer returns them, and the columns behind them held the
 * prototype's invented figures. Adding them back means building the
 * attribution first.
 */
export interface ConsoleProduct {
  id: string;
  partnerId: string;
  name: string;
  type: string | null;
  status: ConsoleProductStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A KPI tile, computed from the partner's own rows rather than read from a
 * table. `partner_kpis` had a reader and no writer, so these never appeared at
 * all; they are derived server-side now, which is also why there is no id from
 * a database or a createdAt to show.
 */
export interface ConsoleKpi {
  id: string;
  label: string;
  value: string; // already display-formatted, e.g. "US$4,200" — do not reparse
  sub: string | null;
  sortOrder: number;
}

/**
 * One client of this firm, and the KYC package CCN passes across with their
 * consent. Columns are snake_case because this row comes straight from a
 * database function (`partner_clients`, 0014) rather than a Drizzle select —
 * renaming them in the handler would put the wire shape one edit away from
 * disagreeing with the function that defines it.
 *
 * `holdings_value_minor` is a bigint and arrives as a numeric string.
 */
export interface ConsoleClient {
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
  holdings_value_minor: string;
}

/** One stage of the referral funnel, computed from connected accounts. */
export interface ConsoleFunnelStage {
  id: string;
  label: string;
  count: number;
  /** Share of everyone who asked to connect, not of the previous stage. */
  pct: number;
  sortOrder: number;
}

export class ConsoleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ConsoleApiError';
    this.status = status;
  }
}

async function consoleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/console${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new ConsoleApiError(message, res.status);
  }
  return body as T;
}

// ---- Identity & audit ----

/**
 * The caller's own partner. The console screen itself reads `me.partner` from
 * the session context (one fetch per surface, and the branding then cannot
 * disagree with the surface guard that let the operator in); this is the
 * console-scoped route behind the same data, and what
 * apps/api/test/console-surface.test.ts asserts against.
 */
export function getPartner(): Promise<{ partner: ConsolePartner }> {
  return consoleFetch('/partner');
}

/** Real audit rows for this partner, newest first. Server clamps limit to 200. */
export function getAudit(limit = 50): Promise<{ entries: ConsoleAuditEntry[] }> {
  return consoleFetch(`/audit?limit=${limit}`);
}

// ---- Orders ----

export function getOrders(): Promise<{ orders: ConsoleOrder[] }> {
  return consoleFetch('/orders');
}

export function acceptOrder(id: string): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/accept`, { method: 'POST' });
}

export function settleOrder(id: string): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/settle`, { method: 'POST' });
}

export function rejectOrder(id: string, reason?: string): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ---- Clients ----

/** This firm's clients, pending reviews first. */
export function getClients(): Promise<{ clients: ConsoleClient[] }> {
  return consoleFetch('/clients');
}

/**
 * Accept or decline one pending client. The server returns the status the
 * connection moved to, so the screen reconciles to that rather than to its own
 * guess about what the press did.
 */
export function reviewClient(
  id: string,
  accept: boolean,
  reason?: string,
): Promise<{ status: 'active' | 'declined' }> {
  return consoleFetch(`/clients/${id}/${accept ? 'accept' : 'decline'}`, {
    method: 'POST',
    body: JSON.stringify(!accept && reason ? { reason } : {}),
  });
}

// ---- Reconciliation ----

export function getReconciliation(): Promise<{ items: ConsoleReconciliationItem[] }> {
  return consoleFetch('/reconciliation');
}

export function matchReconciliation(id: string): Promise<{ holdingId: string }> {
  return consoleFetch(`/reconciliation/${id}/match`, { method: 'POST' });
}

export function rejectReconciliation(id: string, reason?: string): Promise<{ ok: true }> {
  return consoleFetch(`/reconciliation/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ---- Reference data (overview / products / clients / compliance tabs) ----

export function getProducts(): Promise<{ products: ConsoleProduct[] }> {
  return consoleFetch('/products');
}

/**
 * Flip one listing between `live` and `paused`. The server does the flip in a
 * single guarded UPDATE and returns the resulting status, so the caller
 * reconciles to that value rather than assuming its optimistic guess held.
 */
/**
 * List a product.
 *
 * The console could read its catalogue and pause a listing and never create
 * one, so a newly onboarded partner signed in to an empty screen. `partnerId`
 * is deliberately absent: the server takes it from the caller's own scope, so
 * an operator lists for their firm or not at all.
 */
export async function createProduct(input: {
  name: string;
  type?: string;
}): Promise<{ product: ConsoleProduct }> {
  const res = await fetch(`${API_URL}/api/console/products`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `request failed (${res.status})`,
    );
  }
  return body;
}

export function toggleProductLive(id: string): Promise<{ status: ConsoleProductStatus }> {
  return consoleFetch(`/products/${id}/live`, { method: 'POST' });
}

export function getKpis(): Promise<{ kpis: ConsoleKpi[] }> {
  return consoleFetch('/kpis');
}

export function getFunnel(): Promise<{ stages: ConsoleFunnelStage[] }> {
  return consoleFetch('/funnel');
}
