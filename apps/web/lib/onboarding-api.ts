import { API_URL } from './config';

/**
 * Typed client for /api/onboarding/* (the Identity -> Compliance -> Risk ->
 * Funds wizard). Every request carries `credentials: 'include'` so the Better
 * Auth session cookie rides along — CORS on the API is scoped to
 * APP_WEB_ORIGIN with `credentials: true`, so this is required, not optional.
 * These are mutations (rate class 'orders' server-side), one request per
 * wizard step, matching packages/domain's onboarding*Schema shapes 1:1.
 */

export type KycTier = 'none' | 'tier1' | 'tier2';
export type RiskBand = 'low' | 'low_moderate' | 'high_moderate' | 'low_high' | 'high';
export type SourceOfFunds = 'investment' | 'salary' | 'business' | 'other';

export interface KycStatus {
  userId: string;
  tier: KycTier;
  identityVerified: boolean;
  complianceConfirmed: boolean;
  riskCompleted: boolean;
  fundsConfirmed: boolean;
  isPep: boolean;
  taxResidencyDeclared: boolean;
  sources: SourceOfFunds[];
  updatedAt: string;
}

export interface UserProfile {
  userId: string;
  displayCurrency: string;
  corridor: string | null;
  residencyCountry: string | null;
  occupation: string | null;
  uiScale: string;
  contrastPref: string;
  themePref: string;
}

export interface OnboardingStatusResponse {
  status: KycStatus | null;
  profile: UserProfile | null;
  riskBand: RiskBand | null;
}

export interface SubmitIdentityInput {
  fullName: string;
  residencyCountry: string;
  occupation: string;
}

export class OnboardingApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OnboardingApiError';
    this.status = status;
  }
}

async function onboardingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/onboarding${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new OnboardingApiError(message, res.status);
  }
  return body as T;
}

/** Resume point for the wizard: which steps are already saved, plus the
 *  profile fields to prefill and the previously-computed risk band. */
export function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return onboardingFetch('/status');
}

export function submitIdentity(input: SubmitIdentityInput): Promise<{ ok: true }> {
  return onboardingFetch('/identity', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * The declarations, as answered.
 *
 * This used to take no parameters and post `{true, true, true}` — because the
 * schema demanded three literal `true`s, the form's checkboxes decided only
 * whether the button was enabled, and nothing the reader ticked was ever sent.
 * The PEP answer is now theirs, and it reaches the column the partner console
 * reads.
 */
export function submitCompliance(input: {
  isPoliticallyExposed: boolean;
}): Promise<{ ok: true }> {
  return onboardingFetch('/compliance', {
    method: 'POST',
    body: JSON.stringify({
      isPoliticallyExposed: input.isPoliticallyExposed,
      taxResidencyDeclared: true,
      risksUnderstood: true,
    }),
  });
}

/** `scores` are the three RISK_QUESTIONS' selected option scores (1-5), in
 *  order. Returns the server-computed band, the source of truth for what was
 *  actually saved. */
export function submitRisk(scores: [number, number, number]): Promise<{ band: RiskBand }> {
  return onboardingFetch('/risk', { method: 'POST', body: JSON.stringify({ scores }) });
}

export function submitFunds(sources: SourceOfFunds[]): Promise<{ ok: true; tier: 'tier2' }> {
  return onboardingFetch('/funds', { method: 'POST', body: JSON.stringify({ sources }) });
}

/** One uploaded KYC document — metadata only; the bytes are fetched by id. */
export interface KycDocument {
  id: string;
  step: 'identity' | 'compliance' | 'risk' | 'funds';
  label: string;
  mime: string | null;
  createdAt: string;
}

/**
 * Upload a KYC document (≤2MB; jpeg/png/webp/pdf). The file goes to the
 * firm's reviewing desk with the rest of the KYC package — it is what stands
 * behind the wizard's declarations.
 */
export async function uploadKycDocument(input: {
  step: KycDocument['step'];
  file: File;
}): Promise<{ id: string }> {
  if (input.file.size > 2 * 1024 * 1024) {
    throw new OnboardingApiError('Documents are capped at 2MB — send a smaller scan.', 413);
  }
  const buf = new Uint8Array(await input.file.arrayBuffer());
  let binary = '';
  // Chunked: String.fromCharCode(...2MB) blows the argument limit.
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return onboardingFetch('/documents', {
    method: 'POST',
    body: JSON.stringify({
      step: input.step,
      label: input.file.name.slice(0, 140),
      mime: input.file.type,
      data: btoa(binary),
    }),
  });
}

export function getKycDocuments(): Promise<{ documents: KycDocument[] }> {
  return onboardingFetch('/documents');
}

/** Where the owner downloads one document back. A plain link target — the
 *  session cookie rides on navigation, so no fetch wrapper is needed. */
export function kycDocumentUrl(id: string): string {
  return `${API_URL}/api/onboarding/documents/${id}`;
}

/** Format a DB risk_band enum value ('low_moderate') as the wizard's display
 *  string ('Low Moderate') — same mapping as data.ts's local `riskBand()`. */
export function formatRiskBand(band: RiskBand): string {
  return band
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}
