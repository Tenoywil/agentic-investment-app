import { API_URL } from './config';

/**
 * The authenticated caller. One request answers four questions the UI used to
 * hardcode: which surface this user belongs to, which partner an operator works
 * for (the console showed "Sagicor Group" to everyone), how far through
 * onboarding they are (the execute dialog asserted three green KYC ticks
 * regardless), and their real guardrail limits.
 */

export type Surface = 'customer' | 'institution' | 'admin';
export type KycTier = 'none' | 'tier1' | 'tier2';

export interface MePartner {
  id: string;
  code: string;
  name: string;
  kind: string | null;
  regulator: string | null;
  agreementStatus: string | null;
  residency: string | null;
  /** What the firm tells clients about sending money in. Null = not provided. */
  fundingInstructions: string | null;
  /** Withdrawal charges (0026): flat fee in minor units (bigint → string on
   *  the wire), percentage fee and consumption tax in basis points. */
  withdrawalFeeFlatMinor: string;
  withdrawalFeeBps: number;
  gctBps: number;
}

export interface MeOnboarding {
  tier: KycTier;
  identityVerified: boolean;
  complianceConfirmed: boolean;
  riskCompleted: boolean;
  fundsConfirmed: boolean;
  complete: boolean;
}

export interface Me {
  user: { id: string; email: string; name: string };
  surface: Surface;
  roles: string[];
  /** Non-null only for partner operators. */
  partner: MePartner | null;
  profile: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  onboarding: MeOnboarding;
}

export class MeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'MeApiError';
    this.status = status;
  }
}

export async function getMe(): Promise<Me> {
  const res = await fetch(`${API_URL}/api/me`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new MeApiError(message, res.status);
  }
  return body as Me;
}

/** Where a signed-in user belongs. The only place this mapping exists. */
export function landingPathFor(me: Me): string {
  // Administration outranks the rest, and skips onboarding entirely: an
  // administrator has no portfolio to open and nothing to verify.
  if (me.surface === 'admin') return '/admin';
  if (me.surface === 'institution') return '/institutions';
  return me.onboarding.complete ? '/home' : '/onboarding';
}
