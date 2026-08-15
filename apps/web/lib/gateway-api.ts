import { API_URL } from './config';

/**
 * Typed client for /api/gateway/*. Every request carries `credentials:
 * 'include'` so the Better Auth session cookie rides along — CORS on the API
 * is scoped to APP_WEB_ORIGIN with `credentials: true`, so this is required,
 * not optional. Money fields cross the wire as strings (minor units) because
 * Postgres bigint columns can't round-trip through JSON as numbers; the UI
 * converts to/from major units at the input boundary, never in between.
 */

export type Ordinal = 'low' | 'medium' | 'high';
export type Currency = 'USD' | 'JMD' | 'TTD' | 'GYD' | 'BBD' | 'XCD' | 'BSD';

export interface Mandate {
  userId: string;
  narrative: string | null;
  countries: string[];
  sectors: string[];
  minCheckMinor: string;
  maxCheckMinor: string;
  stagePreferences: string[];
  riskAppetite: Ordinal;
  horizonYears: number;
  targetReturnPct: string;
  liquidityNeed: Ordinal;
  boardInvolvement: boolean;
  impactPreference: boolean;
  currency: Currency;
  createdAt: string;
  updatedAt: string;
}

export interface MandateExtraction {
  countries: string[];
  sectors: string[];
  minCheckMinor: number | null;
  maxCheckMinor: number | null;
  stagePreferences: string[];
  riskAppetite: Ordinal | null;
  horizonYears: number | null;
  targetReturnPct: number | null;
  liquidityNeed: Ordinal | null;
  boardInvolvement: boolean | null;
  impactPreference: boolean | null;
  currency: Currency | null;
  missingFields: string[];
}

export interface SaveMandateInput {
  countries: string[];
  sectors: string[];
  minCheckMinor: number;
  maxCheckMinor: number;
  stagePreferences: string[];
  riskAppetite: Ordinal;
  horizonYears: number;
  targetReturnPct: number;
  liquidityNeed: Ordinal;
  boardInvolvement: boolean;
  impactPreference: boolean;
  currency: Currency;
}

export type GatewayOpportunityStatus =
  | 'submitted'
  | 'assessed'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export interface Opportunity {
  id: string;
  submittedBy: string | null;
  name: string;
  country: string;
  sector: string;
  stage: string;
  investmentType: string;
  capitalSoughtMinor: string;
  currency: Currency;
  valuationMinor: string | null;
  useOfFunds: string | null;
  targetReturnPct: string;
  horizonYears: number;
  riskRating: Ordinal;
  liquidity: Ordinal;
  offersBoardSeat: boolean;
  hasImpactFocus: boolean;
  exitAssumptions: string | null;
  summary: string;
  status: GatewayOpportunityStatus;
  readinessScore: number | null;
  criticalMissingItems: string[];
  disclosures: string[];
  guardrailCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceStatus =
  | 'verified'
  | 'partially_verified'
  | 'self_reported'
  | 'unverified'
  | 'contradicted';

export interface Claim {
  id: string;
  opportunityId: string;
  category: string | null;
  label: string;
  value: string;
  createdAt: string;
}

export interface Evidence {
  id: string;
  claimId: string;
  status: EvidenceStatus;
  source: string | null;
  detail: string | null;
  documentId: string | null;
  createdAt: string;
}

export interface MatchComponentScores {
  country: number;
  sector: number;
  chequeSize: number;
  stage: number;
  risk: number;
  horizon: number;
  targetReturn: number;
  liquidity: number;
  governance: number;
  impact: number;
  semantic: number;
}

export interface Match {
  id: string;
  userId: string;
  opportunityId: string;
  score: string;
  componentScores: MatchComponentScores;
  reasons: string[];
  concerns: string[];
  usedSemanticProxy: boolean;
  createdAt: string;
  updatedAt: string;
  opportunity: Opportunity;
}

export type IntroductionStatus = 'requested' | 'approved' | 'rejected' | 'completed';

export interface Introduction {
  id: string;
  matchId: string;
  userId: string;
  opportunityId: string;
  status: IntroductionStatus;
  note: string | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class GatewayApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GatewayApiError';
    this.status = status;
  }
}

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/gateway${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new GatewayApiError(message, res.status);
  }
  return body as T;
}

export function getMandate(): Promise<{ mandate: Mandate | null }> {
  return gatewayFetch('/mandate');
}

export function extractMandate(narrative: string): Promise<{ extraction: MandateExtraction }> {
  return gatewayFetch('/mandate/extract', { method: 'POST', body: JSON.stringify({ narrative }) });
}

export function saveMandate(input: SaveMandateInput): Promise<{ mandate: Mandate }> {
  return gatewayFetch('/mandate', { method: 'POST', body: JSON.stringify(input) });
}

/** Requires an existing mandate — throws GatewayApiError(status: 409) if none is on file. */
export function getMatches(): Promise<{ matches: Match[] }> {
  return gatewayFetch('/matches');
}

export function getOpportunity(
  id: string,
): Promise<{ opportunity: Opportunity; claims: Claim[]; evidence: Evidence[] }> {
  return gatewayFetch(`/opportunities/${id}`);
}

export function narrateMatch(matchId: string): Promise<{ match: Match }> {
  return gatewayFetch(`/matches/${matchId}/narrate`, { method: 'POST' });
}

export function requestIntroduction(
  matchId: string,
  note?: string,
): Promise<{ introduction: Introduction }> {
  return gatewayFetch(`/matches/${matchId}/request-introduction`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

export function getIntroductions(): Promise<{ introductions: Introduction[] }> {
  return gatewayFetch('/introductions');
}

/**
 * The analyst review queue.
 *
 * `analyst` and `compliance` are assignable roles on the administration surface
 * and they granted access to no screen at all. Meanwhile an investor who
 * requested an introduction sat at "Awaiting analyst review" indefinitely,
 * because the endpoints that move it — this queue and the two decisions below —
 * had no caller anywhere in the product. Three working nav links led into a loop
 * nothing could complete.
 */
export interface ReviewQueue {
  opportunities: {
    id: string;
    title: string | null;
    sector: string | null;
    jurisdiction: string | null;
    status: string;
    updatedAt: string;
  }[];
  introductions: {
    id: string;
    opportunityId: string;
    status: string;
    createdAt: string;
  }[];
}

export function getReviewQueue(): Promise<ReviewQueue> {
  return gatewayFetch('/admin/review-queue');
}

/** Approve an introduction, connecting the investor to the deal's counterparty. */
export function approveIntroduction(id: string): Promise<unknown> {
  return gatewayFetch(`/introductions/${id}/approve`, { method: 'POST', body: '{}' });
}

/** Decline it. The reason reaches the investor, so it is not optional here. */
export function rejectIntroduction(id: string, reason: string): Promise<unknown> {
  return gatewayFetch(`/introductions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
