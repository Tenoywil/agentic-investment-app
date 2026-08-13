import { API_URL } from './config';
import { formatMinor } from './opportunities-api';

/**
 * Typed client for GET/PUT /api/limits — the caller's guardrail policy, which
 * is the exact input the deterministic Limits Engine evaluates every proposal
 * against.
 *
 * These values are not a UI preference. The agent screen used to render four
 * rules from a hardcoded constant and flip them in React state, so the switches
 * a user set and the rules the server enforced could disagree silently. Read
 * them from here, write them back through here, and never keep a copy in React
 * state that the server also holds.
 *
 * Money crosses the wire as raw minor-unit strings (Postgres bigint has no JSON
 * number form) in the base currency, USD. `formatLimitMinor` is the only place
 * that turns one into something a person reads.
 */

export interface Limits {
  autoInvestCapMinor: string;
  autoInvestEnabled: boolean;
  cashFloorMinor: string;
  cashFloorEnabled: boolean;
  fxSpreadMaxBps: number;
  fxSpreadEnabled: boolean;
  requireApprovalAboveMinor: string;
  requireApprovalEnabled: boolean;
  singlePositionMaxPct: number;
  singlePositionEnabled: boolean;
  dailyCapMinor: string | null;
  dailyCapEnabled: boolean;
}

/** Which switches exist — the keys a PUT may flip. */
export type LimitsFlag = {
  [K in keyof Limits]: Limits[K] extends boolean ? K : never;
}[keyof Limits];

export interface LimitsResponse {
  limits: Limits;
  /** When the user last changed a rule; null while they are still on defaults. */
  updatedAt: string | null;
  /** `defaults` means no row exists yet — the engine's own starting policy. */
  source: 'saved' | 'defaults';
}

export type LimitsUpdate = Partial<Limits>;

export class LimitsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LimitsApiError';
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
    throw new LimitsApiError(message, res.status);
  }
  return body as T;
}

export function getLimits(): Promise<LimitsResponse> {
  return apiFetch('/api/limits');
}

/** Send only the rule that changed; the server merges it over the rest. */
export function updateLimits(update: LimitsUpdate): Promise<LimitsResponse> {
  return apiFetch('/api/limits', { method: 'PUT', body: JSON.stringify(update) });
}

/** Limits are held in the base currency (USD minor units), not the viewer's
 *  display currency — there is no per-user currency on the row to convert from. */
export function formatLimitMinor(minor: string): string {
  return formatMinor(minor, 'USD');
}

/** Basis points as the percentage a person recognises: 30 -> "0.3%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}
