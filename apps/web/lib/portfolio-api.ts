import { API_URL } from './config';

/**
 * Typed client for /api/portfolio, /api/approvals and /api/agent (read paths
 * consumed by the home + portfolio screens). Every request carries
 * `credentials: 'include'` so the Better Auth session cookie rides along —
 * CORS on the API is scoped to APP_WEB_ORIGIN with `credentials: true`, so
 * this is required, not optional. Portfolio money fields arrive pre-formatted
 * by @ccn/money server-side (e.g. "US$41,230") — render them as-is, never
 * reformat. Approval amounts arrive as raw minor-unit strings instead, since
 * approvals is a generic ledger route shared with the console.
 */

export type Currency = 'USD' | 'JMD' | 'TTD';

export interface Holding {
  name: string;
  value: string;
  ret: string | null;
}

export interface PortfolioPartner {
  code: string;
  name: string;
  total: string;
  holdings: Holding[];
}

/** Real allocation by asset class, derived server-side from each holding's
 *  instrument type. `pct` values will not always sum to exactly 100 (rounding);
 *  do not render the remainder as an "unallocated" slice. */
export interface AllocationSlice {
  type: string;
  label: string;
  value: string;
  valueMinor: string;
  pct: number;
}

export interface Portfolio {
  currency: Currency;
  netWorth: string;
  netWorthMinor: string;
  allocation: AllocationSlice[];
  partners: PortfolioPartner[];
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalType = 'investment_rec' | 'fund_transfer' | 'plan_enrollment';

export interface Approval {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  instrumentId: string | null;
  title: string;
  body: string | null;
  amountMinor: string | null;
  currency: Currency;
  snapshot: unknown;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type AgentMessageRole = 'agent' | 'user';

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  createdAt: string;
}

export class PortfolioApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PortfolioApiError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new PortfolioApiError(message, res.status);
  }
  return body as T;
}

export function getPortfolio(currency?: Currency): Promise<Portfolio> {
  const query = currency ? `?currency=${currency}` : '';
  return apiFetch(`/api/portfolio${query}`);
}

export function getApprovals(): Promise<{ approvals: Approval[] }> {
  return apiFetch('/api/approvals');
}

export function getAgentHistory(): Promise<{ messages: AgentMessage[] }> {
  return apiFetch('/api/agent/history');
}
