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
 * required' }` from all of them. Callers should check `status === 403` on
 * ConsoleApiError to render a dedicated "access required" state rather than
 * treating it as a generic failure.
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

export interface ConsoleOrder {
  id: string;
  userId: string;
  partnerId: string;
  instrumentId: string | null;
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

export interface ConsoleProduct {
  id: string;
  partnerId: string;
  name: string;
  type: string | null;
  clients: number;
  aumMinor: string; // raw minor units, numeric string
  trend: string | null;
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

export function getKpis(): Promise<{ kpis: ConsoleKpi[] }> {
  return consoleFetch('/kpis');
}

export function getFunnel(): Promise<{ stages: ConsoleFunnelStage[] }> {
  return consoleFetch('/funnel');
}
