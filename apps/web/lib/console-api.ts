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

export interface ConsoleKpi {
  id: string;
  partnerId: string;
  label: string;
  value: string; // already display-formatted, e.g. "US$4.2M" — do not reparse
  sub: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface ConsoleFunnelStage {
  id: string;
  partnerId: string;
  label: string;
  count: number;
  pct: number;
  sortOrder: number;
  createdAt: string;
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
export function toggleProductLive(id: string): Promise<{ status: ConsoleProductStatus }> {
  return consoleFetch(`/products/${id}/live`, { method: 'POST' });
}

export function getKpis(): Promise<{ kpis: ConsoleKpi[] }> {
  return consoleFetch('/kpis');
}

export function getFunnel(): Promise<{ stages: ConsoleFunnelStage[] }> {
  return consoleFetch('/funnel');
}
