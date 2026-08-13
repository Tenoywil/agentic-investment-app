import { API_URL } from './config';

/**
 * Typed client for GET /api/opportunities (the marketplace grid) and POST
 * /api/orders (the exec dialog's "authorize & route" step). Every request
 * carries `credentials: 'include'` so the Better Auth session cookie rides
 * along — CORS on the API is scoped to APP_WEB_ORIGIN with `credentials:
 * true`, so this is required, not optional.
 *
 * Money crosses the wire as raw minor-unit strings (Postgres bigint can't
 * round-trip through JSON as a number). `formatMinor`/`majorToMinor` below are
 * the only places that convert between minor-unit wire values and the
 * major-unit, currency-prefixed strings the UI displays — do money math here,
 * never inline in a component.
 */

export type Currency = 'USD' | 'JMD' | 'TTD';
export type Risk = 'Low' | 'Medium' | 'High';

/** DB enum values for `instruments.type` (lowercase, underscore-separated). */
export type InstrumentType = 'bond' | 'fund' | 'equity' | 'real_estate' | 'private';

/** Display labels the marketplace UI's tone map and filter chips are keyed on. */
export type Kind = 'Bond' | 'Fund' | 'Equity' | 'Real Estate' | 'Private';

const TYPE_LABEL: Record<InstrumentType, Kind> = {
  bond: 'Bond',
  fund: 'Fund',
  equity: 'Equity',
  real_estate: 'Real Estate',
  private: 'Private',
};

/** Maps the DB's `real_estate` (etc.) enum value to the UI's `Real Estate` label. */
export function typeLabel(type: InstrumentType): Kind {
  return TYPE_LABEL[type] ?? ((type as string).replace(/_/g, ' ') as Kind);
}

const CURRENCY_SYMBOL: Record<Currency, string> = { USD: 'US$', JMD: 'J$', TTD: 'TT$' };

export function currencySymbol(currency: Currency): string {
  return CURRENCY_SYMBOL[currency] ?? '';
}

/** The single place a minor-unit wire string becomes a major-unit, currency
 *  prefixed display string, e.g. ("100000", "USD") -> "US$1,000". */
export function formatMinor(amountMinor: string, currency: Currency): string {
  const major = Number(amountMinor) / 100;
  return `${currencySymbol(currency)}${major.toLocaleString('en-US')}`;
}

/** Minor-unit string -> major-unit number, for numeric comparisons (e.g.
 *  validating a typed amount against an instrument's minimum). */
export function minorToMajor(amountMinor: string): number {
  return Number(amountMinor) / 100;
}

/** Major-unit number (e.g. a dollar amount typed into a form) -> minor-unit
 *  string suitable for `placeOrder`. */
export function majorToMinor(major: number): string {
  return String(Math.round(major * 100));
}

/** `FSC_JAMAICA` -> `FSC Jamaica`. Short (<=4 char) segments are treated as
 *  acronyms and left upper-cased; longer segments are title-cased. */
export function regulatorLabel(regulator: string | null): string {
  if (!regulator) return 'Unregulated';
  return regulator
    .split('_')
    .map((word) =>
      word.length <= 4 ? word.toUpperCase() : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

/** A short, human-shareable reference derived from a real order id, e.g.
 *  "CCN-8F42AC01". Not a fabricated value — just a display slice of the id. */
export function orderReference(orderId: string): string {
  return `CCN-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export interface OpportunityListItem {
  id: string;
  slug: string;
  abbr: string;
  type: InstrumentType;
  partner: string | null;
  regulator: string | null;
  name: string;
  region: string;
  metricLabel: string;
  metric: string;
  minInvestmentMinor: string;
  currency: Currency;
  term: string;
  risk: Risk | null;
  description: string;
  agentNote: string;
  blocked: boolean;
  blockReasons: string[];
}

export interface OpportunitiesResponse {
  suitabilityBand: string | null;
  opportunities: OpportunityListItem[];
}

export type OrderStatus = 'created' | 'accepted' | 'settled' | 'rejected' | 'expired';
export type OrderCreatedBy = 'user' | 'agent' | 'compliance' | 'system';

/** The `orders` row shape returned by POST /api/orders — snake_case columns,
 *  since it comes straight back from the `create_order` database function
 *  rather than through the ORM's camelCase mapping. */
export interface Order {
  id: string;
  user_id: string;
  partner_id: string;
  instrument_id: string | null;
  approval_id: string | null;
  status: OrderStatus;
  amount_minor: string;
  currency: Currency;
  idempotency_key: string;
  client_ref: string | null;
  settlement_eta: string | null;
  rejected_reason: string | null;
  created_by: OrderCreatedBy;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  settled_at: string | null;
}

export interface PlaceOrderInput {
  instrumentId: string;
  amountMinor: number | string;
  currency: Currency;
  idempotencyKey?: string;
}

export type PlaceOrderResult =
  | { decision: 'created'; gate?: string; order: Order }
  | { decision: 'blocked'; code?: string; reasons: string[] };

export class OpportunitiesApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpportunitiesApiError';
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
    throw new OpportunitiesApiError(message, res.status);
  }
  return body as T;
}

export function getOpportunities(): Promise<OpportunitiesResponse> {
  return apiFetch('/api/opportunities');
}

/** Proposes an investment. The deterministic Limits Engine may block it even
 *  for an instrument that isn't pre-flagged (e.g. it exceeds the caller's
 *  limits) — callers must handle `decision: 'blocked'` as a normal outcome,
 *  not an error. */
export function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  return apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(input) });
}
