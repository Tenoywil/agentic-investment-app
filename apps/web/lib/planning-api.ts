import { API_URL } from './config';

/**
 * Typed client for /api/planning/* (products catalog + the caller's own goal
 * rings). Every request carries `credentials: 'include'` so the Better Auth
 * session cookie rides along — CORS on the API is scoped to APP_WEB_ORIGIN
 * with `credentials: true`, so this is required, not optional. Goal money
 * fields (`targetMinor`/`currentMinor`) arrive as raw minor-unit strings (the
 * route doesn't pre-format them), so this module converts to major units at
 * the display boundary via `formatUSDMinor` — this screen is USD-only per the
 * current fixture, there is no per-goal currency field yet.
 */

export type PlanningProductStatus = 'recommended' | 'available' | 'explore';

export interface PlanningProduct {
  id: string;
  code: string;
  title: string;
  provider: string | null;
  description: string | null;
  status: PlanningProductStatus;
  accent: string | null;
  tint: string | null;
  createdAt: string;
}

export interface Goal {
  id: string;
  userId: string;
  name: string;
  targetMinor: string;
  currentMinor: string;
  fromLabel: string | null;
  pct: number;
  eta: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalInput {
  name: string;
  targetMinor: number | string;
  fromLabel?: string;
  eta?: string;
  color?: string;
}

export class PlanningApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlanningApiError';
    this.status = status;
  }
}

async function planningFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/planning${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new PlanningApiError(message, res.status);
  }
  return body as T;
}

export function getProducts(): Promise<{ products: PlanningProduct[] }> {
  return planningFetch('/products');
}

export function getGoals(): Promise<{ goals: Goal[] }> {
  return planningFetch('/goals');
}

export function createGoal(input: CreateGoalInput): Promise<{ goal: Goal }> {
  return planningFetch('/goals', { method: 'POST', body: JSON.stringify(input) });
}

/** Format a raw minor-unit string (e.g. `"4100000"`) as `"US$41,000"`. USD-only
 *  for this screen — whole dollars, en-US grouped, matching @ccn/money's
 *  `formatMoney` default (no cents). */
export function formatUSDMinor(minor: string): string {
  const major = Number(minor) / 100;
  return `US$${major.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
