import { API_URL } from './config';

/**
 * The administration read. One surface, one client.
 *
 * Everything here is read-only, and that is not a convention — the migration
 * that opens these rows to `admin` grants SELECT and nothing else, so a write
 * would be refused by the database. Anything that changes state still goes
 * through the product's own choke points.
 */

export interface AdminOverview {
  people: { customers: number; operators: number; admins: number };
  onboarding: { started: number; tierNone: number; tier1: number; tier2: number };
  partners: { total: number; live: number; sandbox: number };
  products: { total: number };
  orders: { total: number; created: number; accepted: number; settled: number; rejected: number };
  approvals: { pending: number };
}

export interface AdminInvestor {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  roles: string[];
  partnerId: string | null;
  kycTier: string | null;
  identityVerified: boolean | null;
  complianceConfirmed: boolean | null;
  riskCompleted: boolean | null;
  fundsConfirmed: boolean | null;
  residency: string | null;
}

export interface AdminPartner {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  regulator: string | null;
  agreementStatus: string | null;
  residency: string | null;
  products: number;
  orders: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
  partnerName: string | null;
  partnerCode: string | null;
}

export interface AdminOrder {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
  partnerName: string | null;
  investorEmail: string | null;
}

export interface AdminAuditEntry {
  id: string;
  seq: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorType: string | null;
  createdAt: string;
}

export interface AdminInvestorDetail {
  user: { id: string; name: string | null; email: string };
  roles: { role: string; partnerId: string | null }[];
  kyc: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  holdings: { id: string; name: string; valueMinor: string; currency: string }[];
  approvals: { id: string; type: string; title: string; status: string; createdAt: string }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const getAdminOverview = () => get<AdminOverview>('/overview');
export const getAdminInvestors = () => get<{ investors: AdminInvestor[] }>('/investors?limit=200');
export const getAdminPartners = () => get<{ partners: AdminPartner[] }>('/partners');
export const getAdminProducts = () => get<{ products: AdminProduct[] }>('/products');
export const getAdminOrders = () => get<{ orders: AdminOrder[] }>('/orders?limit=100');
export const getAdminAudit = () => get<{ entries: AdminAuditEntry[] }>('/audit?limit=100');

export const getAdminInvestor = (id: string) => get<AdminInvestorDetail>(`/investors/${id}`);
export const getAdminInvestorActivity = (id: string) =>
  get<{ entries: AdminAuditEntry[] }>(`/investors/${id}/activity?limit=100`);

/**
 * Load the catalog on a database that has none.
 *
 * A freshly migrated deployment has no partners, and with no partners there is
 * no institution side of the product at all — `partner_operator` requires one.
 * The rows are the same definition `db:seed` uses, so a deployment does not
 * need a shell and a connection string to become usable. Idempotent.
 */
export async function loadAdminReferenceData(): Promise<{
  partners: number;
  instruments: number;
  planningProducts: number;
  fxRates: number;
}> {
  const res = await fetch(`${API_URL}/api/admin/reference-data`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `request failed (${res.status})`,
    );
  }
  return body;
}

/** What an administrator may set on a partner. `code` is identity, so it is create-only. */
export interface PartnerDraft {
  code?: string;
  name: string;
  kind?: string;
  regulator?: string;
  agreementStatus?: string;
  residency?: string;
}

async function send<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof parsed?.error === 'string' ? parsed.error : `request failed (${res.status})`,
    );
  }
  return parsed as T;
}

/**
 * Onboard a partner.
 *
 * Until the code column stopped being a database enum this took a migration and
 * a deploy — for the most ordinary commercial event the company has. The
 * regulator and the agreement status stay closed sets, because they are: the
 * agreement is what gates live order routing.
 */
export const createAdminPartner = (draft: PartnerDraft) =>
  send<{ partner: AdminPartner }>('/partners', 'POST', draft);

/** Correct a partner's record — everything but its code. */
export const updateAdminPartner = (id: string, draft: PartnerDraft) =>
  send<{ partner: AdminPartner }>(`/partners/${id}`, 'PUT', draft);

/**
 * Set a person's roles. A whole set, not add/remove: roles decide which product
 * someone sees, so "make this person an operator for JMMB" is one intention and
 * should not pass through a state where they hold both surfaces or neither.
 *
 * `admin` is not assignable here by design — it comes from ADMIN_EMAILS alone,
 * and both the API and the database refuse it.
 */
export async function setAdminInvestorRoles(
  id: string,
  roles: string[],
  partnerCode?: string,
): Promise<{ roles: { role: string; partnerId: string | null }[] }> {
  const res = await fetch(`${API_URL}/api/admin/investors/${id}/roles`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partnerCode ? { roles, partnerCode } : { roles }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `request failed (${res.status})`,
    );
  }
  return body;
}
