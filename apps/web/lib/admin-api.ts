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
