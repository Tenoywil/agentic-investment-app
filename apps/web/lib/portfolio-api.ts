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

export type Currency = 'USD' | 'JMD' | 'TTD' | 'GYD' | 'BBD' | 'XCD' | 'BSD';

export interface Holding {
  name: string;
  value: string;
  ret: string | null;
}

export interface PortfolioPartner {
  code: string;
  name: string;
  /** What the institution is, e.g. "Bank · Capital Markets". Null when unknown. */
  kind: string | null;
  /** The regulator enum value, e.g. "FSC_JAMAICA". Null when the partner record
   *  carries none — render nothing rather than claiming a regulator. */
  regulator: string | null;
  total: string;
  /**
   * The uninvested balance at this firm — money the firm confirmed settled and
   * not yet invested. Pre-formatted like `total`. Null when the firm holds no
   * cash line for this investor, which is different from a zero balance.
   */
  cash: string | null;
  /** The firm's own instructions for sending money in. Null = not provided. */
  fundingInstructions: string | null;
  /**
   * The firm's withdrawal charges, as raw settings so the Withdraw dialog can
   * show a live "you'll receive ~X" as the person types. Flat fee in minor
   * units (string); rates in basis points. GCT applies to the fee, not the
   * principal — and the server recomputes and freezes the real figures at
   * request time, so this is an estimate, never the record.
   */
  withdrawalFeeFlatMinor: string;
  withdrawalFeeBps: number;
  gctBps: number;
  /**
   * When this firm's balances were last pulled, ISO. Null when nothing here has
   * ever been refreshed. Taken from the *oldest* holding on the card, because a
   * card is only as current as its least recently updated line.
   */
  asOf: string | null;
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

/**
 * A link to one institution, whatever its standing. Distinct from
 * `partners`, which is derived from holdings — a connection awaiting the
 * firm's decision, or refused by it, has none, and would otherwise be
 * invisible on the screen where the investor went looking for it.
 */
export interface PortfolioConnection {
  code: string;
  name: string;
  status: 'pending' | 'active' | 'declined';
  requestedAt: string;
  declineReason: string | null;
}

/**
 * Which bank published the rate a converted figure used, and when.
 *
 * Conversion used to run on three constants compiled into @ccn/money, so a
 * portfolio shown in JMD was restated at a rate nobody had checked in months and
 * presented as confidently as the balance. A converted number the reader cannot
 * date is the problem; this is the fix, and `stale` is what the screen says when
 * the publisher's date is old.
 */
export interface FxMeta {
  currency: Currency;
  /** The publisher's own date, `YYYY-MM-DD`. Null when no bank stands behind it. */
  asOf: string | null;
  /** `BOJ`, `CBTT`, or `seed` for the fallback rows. */
  source: string | null;
  stale: boolean;
  /**
   * No rate could be read at all, so this currency was not converted to.
   * Different from `stale`, which is an old but real published rate. Happens
   * when the API's database is behind the code and the rate table is unreadable;
   * the figures then arrive in USD, and `requestedCurrency` says what was asked
   * for.
   */
  unavailable: boolean;
}

export interface Portfolio {
  /** The currency the figures are actually in. */
  currency: Currency;
  /** Null for USD, which is the base and needs no conversion. */
  fx: FxMeta | null;
  /**
   * Set only when the requested currency could not be converted to, in which
   * case `currency` is USD. Null on every ordinary response.
   */
  requestedCurrency: Currency | null;
  netWorth: string;
  netWorthMinor: string;
  allocation: AllocationSlice[];
  connections: PortfolioConnection[];
  partners: PortfolioPartner[];
  /** Money on its way out, newest first. A `pending` one gates that card's
   *  Withdraw button; decided ones carry the firm's reference or reason. */
  withdrawals: PortfolioWithdrawal[];
}

export interface PortfolioWithdrawal {
  id: string;
  partnerCode: string;
  amountMinor: string;
  /** Pre-formatted, e.g. "US$500". */
  amount: string;
  /** The firm's fee and the GCT on it, frozen at request time. Null when the
   *  firm charges nothing — render no charge line rather than "US$0". */
  feeMinor: string;
  fee: string | null;
  gctMinor: string;
  gct: string | null;
  /** Pre-formatted amount − fee − GCT: what actually reaches the client. */
  net: string;
  currency: Currency;
  status: 'pending' | 'paid' | 'declined';
  /** The firm's words when it declined. */
  reason: string | null;
  /** The firm's payment reference when it paid. */
  reference: string | null;
  createdAt: string;
  decidedAt: string | null;
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

/**
 * "I've sent the money." Lands in the firm's reconciliation queue for a human
 * to confirm — nothing is credited on the investor's say-so, and the screen
 * should say exactly that.
 */
export function sendFundingNotice(input: {
  partnerCode: string;
  amountMinor: string;
  currency: Currency;
}): Promise<{ ok: true }> {
  return apiFetch('/api/portfolio/funding-notice', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Ask the firm for money back. The firm decides; cash falls when it pays. */
export function requestWithdrawal(input: {
  partnerCode: string;
  amountMinor: string;
  currency: Currency;
}): Promise<{ withdrawal: unknown }> {
  return apiFetch('/api/portfolio/withdrawals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getAgentHistory(): Promise<{ messages: AgentMessage[] }> {
  return apiFetch('/api/agent/history');
}

/** `FSC_JAMAICA` -> `FSC Jamaica`. One implementation, shared with the
 *  marketplace, so a regulator never reads two different ways in one product. */
export { regulatorLabel } from './opportunities-api';

/**
 * Connect an account at a partner, and pull what it holds.
 *
 * Until this existed an investor who finished onboarding had an empty
 * portfolio, no cash, and therefore could not place an order at all — every
 * amount drew them below their cash floor and the guardrail refused it, which
 * is correct and left the customer side terminating at an empty screen.
 *
 * The balances come from the partner's own adapter, not from here. Connecting
 * the same partner twice refreshes that account rather than adding a second.
 */
export async function connectAccount(partnerCode: string): Promise<{
  partner: string;
  /** `pending` until an operator at that firm accepts this person as a client. */
  status: 'pending' | 'active';
  holdings: number;
  refreshed: boolean;
}> {
  const res = await fetch(`${API_URL}/api/portfolio/accounts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partnerCode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `request failed (${res.status})`,
    );
  }
  return body;
}

/** The institutions on the network — the choices in the connect dialog. */
export async function getNetworkPartners(): Promise<
  { code: string; name: string; kind: string | null; regulator: string | null }[]
> {
  const res = await fetch(`${API_URL}/api/portfolio/partners`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return ((await res.json()) as { partners: [] }).partners;
}

/**
 * Ask CCN to pull the latest statements from a partner you have connected.
 *
 * `POST /api/ingestion/pull` has existed since the reconciliation pipeline was
 * written and nothing called it, so the partner console's reconciliation queue —
 * and the Match and Reject buttons on it — could never be reached through the
 * product at all. Statement lines that match a holding update it; the ones that
 * do not land on the firm's desk to resolve.
 */
export async function pullStatements(partnerCode: string): Promise<{ queued: number }> {
  const res = await fetch(`${API_URL}/api/ingestion/pull`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partnerCode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `request failed (${res.status})`,
    );
  }
  return body;
}
