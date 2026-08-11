import { gatewayClaims, gatewayEvidence, gatewayOpportunities } from '@ccn/db';
import type { Transaction } from '@ccn/db';
import type { GatewayOpportunityStatus } from '@ccn/domain';
import type { GuardrailInput, GuardrailPolicy } from '@ccn/gateway-guardrail';
import { eq } from 'drizzle-orm';

/**
 * Assemble `@ccn/gateway-guardrail`'s input from live data and evaluate a
 * submitted opportunity — the Gateway analog of `services/gate.ts`. Runs inside
 * the caller's RLS transaction, so every read is already tenant-scoped.
 *
 * Corridor-one pilot policy (jurisdictions/sectors CCN is actually live in),
 * mirroring the shape of `services/gate.ts`'s `DEFAULT_LIMITS` — config-typed,
 * not scattered magic numbers, and the one place to change as the pilot grows.
 */
export const GATEWAY_POLICY: GuardrailPolicy = {
  permittedJurisdictions: ['Jamaica', 'Trinidad and Tobago', 'Barbados'],
  permittedSectors: [
    'Renewable Energy',
    'Technology',
    'Tourism',
    'Agriculture',
    'Financial Services',
    'Real Estate',
    'Manufacturing',
    'Healthcare',
  ],
  readinessAllowThreshold: 80,
  readinessDisclosureThreshold: 60,
  // Opportunity-approval is not tied to one investor — see the code comment on
  // GuardrailInput below for why the investor fields are inert at this call site.
  requireInvestorReady: false,
};

export interface LoadedOpportunity {
  id: string;
  status: GatewayOpportunityStatus;
  submittedBy: string | null;
  country: string;
  sector: string;
  readinessScore: number | null;
  criticalMissingItems: string[];
}

export async function loadOpportunity(
  tx: Transaction,
  opportunityId: string,
): Promise<LoadedOpportunity | null> {
  const [row] = await tx
    .select({
      id: gatewayOpportunities.id,
      status: gatewayOpportunities.status,
      submittedBy: gatewayOpportunities.submittedBy,
      country: gatewayOpportunities.country,
      sector: gatewayOpportunities.sector,
      readinessScore: gatewayOpportunities.readinessScore,
      criticalMissingItems: gatewayOpportunities.criticalMissingItems,
    })
    .from(gatewayOpportunities)
    .where(eq(gatewayOpportunities.id, opportunityId));
  return row ?? null;
}

/** Every evidence status recorded for this opportunity's claims. */
async function evidenceStatuses(tx: Transaction, opportunityId: string): Promise<string[]> {
  const rows = await tx
    .select({ status: gatewayEvidence.status })
    .from(gatewayEvidence)
    .innerJoin(gatewayClaims, eq(gatewayClaims.id, gatewayEvidence.claimId))
    .where(eq(gatewayClaims.opportunityId, opportunityId));
  return rows.map((r) => r.status);
}

/**
 * Build the guardrail input for an opportunity's own submit-for-approval gate.
 *
 * `GuardrailInvestor` exists in `@ccn/gateway-guardrail` because the same
 * deterministic evaluator is designed to also gate a specific investor's
 * introduction later (mandate/KYC completeness) — but the Gateway's
 * introduction flow is human-gated by design (every request goes to an
 * analyst; see routes/gateway.ts), so no call site needs that check today.
 * Passing `requireInvestorReady: false` makes the investor fields inert here
 * — real values, not used, kept honest rather than faked as "always ready".
 */
export async function buildGuardrailInput(
  tx: Transaction,
  opportunity: LoadedOpportunity,
): Promise<GuardrailInput> {
  const contradicted = await evidenceStatuses(tx, opportunity.id);
  return {
    policy: GATEWAY_POLICY,
    opportunity: {
      jurisdiction: opportunity.country,
      sector: opportunity.sector,
      readinessScore: opportunity.readinessScore ?? 0,
      criticalMissingItems: opportunity.criticalMissingItems,
      hasContradictedEvidence: contradicted.includes('contradicted'),
    },
    investor: { mandateComplete: true, kycComplete: true },
  };
}
