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

export type ConsoleCurrency = 'USD' | 'JMD' | 'TTD' | 'GYD' | 'BBD' | 'XCD' | 'BSD';
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
  /**
   * What the firm tells its clients about how to send money in — wire details,
   * branch reference format, whatever the firm chooses to say. Rendered
   * verbatim in the investor's "Add money" dialog. Null = never provided, and
   * the investor screen says so honestly instead of inventing bank details.
   */
  fundingInstructions: string | null;
  /**
   * Withdrawal charges (0026). The flat fee is minor units as a string; the
   * rates are basis points (100 = 1%). GCT is levied on the fee, not the
   * principal, and every request freezes these at request time.
   */
  withdrawalFeeFlatMinor: string;
  withdrawalFeeBps: number;
  gctBps: number;
}

/** One row of the immutable, hash-chained audit log, scoped to this partner.
 *  `seq` is a bigserial and arrives as a numeric string. */
export interface ConsoleAuditEntry {
  id: string;
  seq: string;
  action: string;
  entityType: string | null;
  actorType: ConsoleActorType;
  /**
   * WHO. The name behind `actor_id` — the operator who accepted the client or
   * paid the withdrawal, or the client who asked. Null for system and agent
   * rows, and for rows older than the column being written; the screen then
   * falls back to the actor-type word rather than inventing a person.
   */
  actorName: string | null;
  detail: unknown;
  createdAt: string;
}

export type ConsoleWebhookDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'dead';

export interface ConsoleWebhookEndpoint {
  id: string;
  url: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConsoleWebhookDelivery {
  id: string;
  eventId: string;
  eventType: string;
  status: ConsoleWebhookDeliveryStatus;
  attemptCount: number;
  responseStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ConsoleWebhookView {
  endpoint: ConsoleWebhookEndpoint | null;
  deliveries: ConsoleWebhookDelivery[];
  /** Exact hostnames deployment governance has approved for egress. */
  allowedHosts: string[];
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
  /**
   * What the settling firm reported. Null is "not reported", which the screens
   * say by leaving it out — a zero would be the firm stating there was no fee,
   * and on a record about someone's money those are different claims.
   */
  unitPriceMinor: string | null;
  units: string | null;
  feeMinor: string | null;
  externalRef: string | null;
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
 * A listed product — a row of `instruments`, the table the marketplace reads.
 *
 * It used to be a row of `product_listings`, a table with no relationship to
 * the marketplace in either direction: a firm could list a fund, watch it
 * appear here, and no investor would ever be shown it. These are the fields a
 * deal card renders, which is why the form now asks for all of them.
 *
 * No `clients`, `aumMinor` or `trend`: CCN measures none of them, and the
 * columns behind them held the prototype's invented figures.
 */
export interface ConsoleProduct {
  id: string;
  name: string;
  type: string | null;
  abbr: string;
  currency: string;
  /** Minor units as a string — bigint has no JSON form. */
  minInvestmentMinor: string;
  term: string | null;
  metric: string | null;
  metricLabel: string | null;
  risk: 'low' | 'medium' | 'high' | null;
  description: string | null;
  region: string | null;
  status: ConsoleProductStatus;
  /** Screened out of suitability for some investors. Not the same as paused. */
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the console form sends. Mirrors `listInstrumentSchema` in @ccn/domain. */
export interface ProductInput {
  /** Present to amend a listing, absent to create one. */
  id?: string;
  name: string;
  type: string;
  abbr?: string;
  currency?: string;
  minInvestmentMinor?: string;
  term?: string;
  metric?: string;
  metricLabel?: string;
  risk: 'low' | 'medium' | 'high';
  description?: string;
  region?: string;
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
  /** When the firm last asked this person to finish KYC; null = never asked. */
  kyc_requested_at: string | null;
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

/**
 * The firm corrects its own record.
 *
 * Three fields only, and the omissions are deliberate: `code` resolves the
 * executing adapter, `regulator` is a compliance claim rendered to investors on
 * every deal card, and `agreementStatus` gates live order routing. The server
 * function takes no parameter for any of them, so this path cannot reach them
 * whatever a client sends.
 */
export function updatePartner(input: {
  name: string;
  kind?: string;
  residency?: string;
  /** Omit = keep what is stored; empty string = clear it. */
  fundingInstructions?: string;
  /** Withdrawal charges. Omit any of them = keep the stored value. */
  withdrawalFeeFlatMinor?: string;
  withdrawalFeeBps?: number;
  gctBps?: number;
}): Promise<{ partner: ConsolePartner }> {
  return consoleFetch('/partner', { method: 'PATCH', body: JSON.stringify(input) });
}

/**
 * The firm's logo, the one piece of brand identity an operator owns outright.
 * `data` is base64 with no `data:` prefix (PNG/JPEG/SVG/WebP, ≤256KB — the
 * server enforces both and this client checks them first for a kinder error);
 * `{ data: null }` clears the logo and the monogram mark returns everywhere.
 */
export function putPartnerLogo(
  input: { mime: string; data: string } | { data: null },
): Promise<{ ok: true; hasLogo: boolean }> {
  return consoleFetch('/partner/logo', { method: 'PUT', body: JSON.stringify(input) });
}

/** Real audit rows for this partner, newest first. Server clamps limit to 200. */
export function getAudit(limit = 50): Promise<{ entries: ConsoleAuditEntry[] }> {
  return consoleFetch(`/audit?limit=${limit}`);
}

/** The partner's optional audit-event export and its last 20 deliveries. */
export function getPartnerWebhook(): Promise<ConsoleWebhookView> {
  return consoleFetch('/webhook');
}

/** A signing secret is returned only when created or explicitly rotated. */
export function savePartnerWebhook(input: {
  url: string;
  active: boolean;
  rotateSecret?: boolean;
}): Promise<{ endpoint: ConsoleWebhookEndpoint; signingSecret: string | null }> {
  return consoleFetch('/webhook', { method: 'PUT', body: JSON.stringify(input) });
}

/** Queue a test through the same transactional outbox and dispatcher as real events. */
export function queuePartnerWebhookTest(): Promise<{ queued: true; eventId: string }> {
  return consoleFetch('/webhook/test', { method: 'POST' });
}

// ---- Orders ----

/** How a list is narrowed. Every field optional; omitted means unfiltered. */
export interface ConsoleQuery {
  status?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function queryString(query: ConsoleQuery = {}): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * The order queue, a page at a time.
 *
 * This used to return every order the firm had ever received, unbounded, and
 * re-fetch the lot on every realtime event. `total` is what the pager needs and
 * the only thing it cannot work out for itself once the rows are truncated.
 */
export function getOrders(
  query: ConsoleQuery = {},
): Promise<{ orders: ConsoleOrder[]; total: number }> {
  return consoleFetch(`/orders${queryString(query)}`);
}

/**
 * Take the order onto the desk, optionally committing to a settlement date.
 *
 * The exec dialog tells investors the date is set by the firm on acceptance,
 * and `settlement_eta` has existed since the first migration with no writer at
 * all. Optional here for the same reason it is optional in the schema: a desk
 * that cannot yet commit to a date must still be able to accept.
 */
export function acceptOrder(id: string, settlementEta?: string): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify(settlementEta ? { settlementEta } : {}),
  });
}

/** What a firm reports about an execution. Minor units as strings. */
export interface SettlementInput {
  unitPriceMinor?: string;
  units?: string;
  feeMinor?: string;
  externalRef?: string;
}

/**
 * Confirm the trade back to the client, with what was actually executed.
 *
 * Settling used to write status, settled_at and updated_at and nothing else, so
 * an investor was told "settled" and never at what price. Every field is
 * optional — the alternative to an empty column is an invented number.
 */
export function settleOrder(
  id: string,
  detail?: SettlementInput,
): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/settle`, {
    method: 'POST',
    body: JSON.stringify(detail ?? {}),
  });
}

/** The desk's copy of a settled order's contract note — a printable page from
 *  the same renderer as the client's. Plain link target, new tab. */
export function consoleContractNoteUrl(orderId: string): string {
  return `${API_URL}/api/console/orders/${orderId}/contract-note`;
}

export function rejectOrder(id: string, reason?: string): Promise<{ order: ConsoleOrder }> {
  return consoleFetch(`/orders/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ---- Clients ----

/** This firm's clients, pending reviews first. */
export function getClients(
  query: ConsoleQuery = {},
): Promise<{ clients: ConsoleClient[]; total: number }> {
  return consoleFetch(`/clients${queryString(query)}`);
}

/** One position a client holds through this firm. */
export interface ConsoleClientHolding {
  id: string;
  name: string;
  instrument_id: string | null;
  instrument_name: string | null;
  instrument_abbr: string | null;
  value_minor: string;
  currency: ConsoleCurrency;
  return_label: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One client, opened.
 *
 * The list row carries a holdings count and a total; this carries the rows
 * behind them, the orders this firm has taken for the person, and their own
 * thread of the firm's audit log.
 */
/** One KYC document in the package this person consented to share. */
export interface ConsoleClientDocument {
  id: string;
  step: 'identity' | 'compliance' | 'risk' | 'funds';
  label: string;
  mime: string | null;
  createdAt: string;
}

/** One day of a client's value held through this firm, minor units as string. */
export interface ClientEquityPoint {
  takenOn: string;
  heldMinor: string;
}

export interface ConsoleClientDetail {
  client: ConsoleClient;
  holdings: ConsoleClientHolding[];
  orders: ConsoleOrder[];
  audit: ConsoleAuditEntry[];
  /** What stands behind the declarations. Empty = they uploaded nothing yet,
   *  and the review screen says so rather than hiding the section. */
  documents: ConsoleClientDocument[];
  /** The relationship's curve: value held through THIS firm, one point per
   *  day since 0032 shipped. Never the client's cross-firm net worth. */
  equity: ClientEquityPoint[];
}

export function getClient(accountId: string): Promise<ConsoleClientDetail> {
  return consoleFetch(`/clients/${accountId}`);
}

/**
 * Ask a client to finish their KYC. Returns the request's timestamp; the
 * server refuses a repeat ask within a day, and refuses when the package is
 * already complete — both surface as ConsoleApiError with the reason.
 */
export function requestClientKyc(accountId: string): Promise<{ requestedAt: string }> {
  return consoleFetch(`/clients/${accountId}/request-kyc`, { method: 'POST' });
}

/** Download target for one document — a plain link; the session cookie rides
 *  on navigation. Serves with Content-Disposition: attachment. */
export function clientDocumentUrl(accountId: string, docId: string): string {
  return `${API_URL}/api/console/clients/${accountId}/documents/${docId}`;
}

/**
 * Move one client along: accept, decline, revoke or reinstate.
 *
 * `accept` is also how a declined client is reinstated and the decline path is
 * also how an active one is revoked — one guarded transition underneath, and
 * the database names the audit action from where the row actually was. The
 * server returns the status the connection moved to, so the screen reconciles
 * to that rather than to its own guess about what the press did.
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

/**
 * Confirm that a client's off-platform funding has settled.
 *
 * The money moved between the investor and the firm — a wire, a branch deposit
 * — and CCN never touched it. This records the firm's confirmation: the
 * client's cash balance at this firm grows by the stated amount and shows on
 * their portfolio at once, with the firm's own reference on the audit trail.
 */
export function confirmFunds(
  accountId: string,
  input: { amountMinor: string; currency: ConsoleCurrency; reference?: string },
): Promise<{ holdingId: string }> {
  return consoleFetch(`/clients/${accountId}/funds`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---- Withdrawals ----

/** One client request for money back, as the desk sees it. */
export interface ConsoleWithdrawal {
  id: string;
  clientName: string;
  accountId: string;
  amountMinor: string; // raw minor units, numeric string
  /** The firm's fee and the GCT on it, frozen when the client asked. */
  feeMinor: string;
  gctMinor: string;
  /** amount − fee − GCT: the figure the firm actually pays the client. */
  netMinor: string;
  currency: ConsoleCurrency;
  status: 'pending' | 'paid' | 'declined';
  /** The firm's words when it declined. */
  reason: string | null;
  /** The firm's payment reference when it paid. */
  reference: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** The withdrawal queue, pending first. Server caps at 50 rows. */
export function getWithdrawals(): Promise<{ withdrawals: ConsoleWithdrawal[] }> {
  return consoleFetch('/withdrawals');
}

/**
 * Decide a withdrawal. Paying decrements CCN's record of the client's cash at
 * this firm — the actual transfer happens off-platform, like funding does —
 * and the optional reference is the firm's own payment trace. Declining
 * requires a reason, because "no" with no words is not something a client can
 * act on. A 409 means CCN's cash record no longer covers the amount (an order
 * may have settled first): record the client's funding, or decline.
 */
export function decideWithdrawal(
  id: string,
  input: { paid: true; reference?: string } | { paid: false; reason: string },
): Promise<{ withdrawal: unknown }> {
  return consoleFetch(`/withdrawals/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---- Reconciliation ----

/**
 * Pull statements for every active client, filling this desk's own queue.
 *
 * The reconciliation queue is the console's, but until now only investors
 * could fill it — one at a time, from their own portfolio screens. The
 * statements are the firm's records and reconciliation is the firm's job, so
 * the desk can now pull for its whole book at once.
 */
export function pullReconciliation(): Promise<{ clients: number; queued: number }> {
  return consoleFetch('/reconciliation/pull', { method: 'POST' });
}

export function getReconciliation(): Promise<{ items: ConsoleReconciliationItem[] }> {
  return consoleFetch('/reconciliation');
}

/** Partner-scoped attachment endpoint. The API always serves it as a download. */
export function reconciliationReceiptUrl(id: string): string {
  return `${API_URL}/api/console/reconciliation/${id}/receipt`;
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
 * List a product, or amend one already listed (send its `id`).
 *
 * The console could read its catalogue and pause a listing and never create
 * one, so a newly onboarded partner signed in to an empty screen. `partnerId`
 * is deliberately absent: the server takes it from the caller's own scope, so
 * an operator lists for their firm or not at all. `slug` and `regulator` are
 * absent for the same reason — the database derives one and copies the other.
 */
export async function saveProduct(input: ProductInput): Promise<{ product: ConsoleProduct }> {
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

/**
 * Add a reviewed batch. The API validates and writes the full set in one
 * partner-scoped transaction; it returns every new listing paused for review.
 */
export async function saveProductsBulk(
  products: ProductInput[],
): Promise<{ products: ConsoleProduct[] }> {
  const res = await fetch(`${API_URL}/api/console/products/bulk`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products }),
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

/**
 * One day of what clients hold through this firm. `takenOn` is the recorder's
 * day (`YYYY-MM-DD`); `heldMinor` is USD minor units as a string; `clients`
 * is the number of clients counted into that day's figure.
 */
export interface PartnerEquityPoint {
  takenOn: string;
  heldMinor: string;
  clients: number;
}

/**
 * The firm's growth curve, one point per day since the recorder first saw it,
 * oldest first. Empty means the firm's history starts today — a real state,
 * not an error.
 */
export function getPartnerEquityHistory(): Promise<{ points: PartnerEquityPoint[] }> {
  return consoleFetch('/equity-history');
}

export function getFunnel(): Promise<{ stages: ConsoleFunnelStage[] }> {
  return consoleFetch('/funnel');
}
