import type { Transaction } from '@ccn/db';
import { partners } from '@ccn/db';
import {
  AdapterRegistry,
  type AgreementStatus,
  type Capability,
  type PartnerAdapter,
  createMockAdapter,
  mockSeed,
} from '@ccn/partner-adapters';
import { eq } from 'drizzle-orm';

/**
 * Resolve a partner's adapter for a capability, gated by the registry on the
 * partner's live `agreement_status` and its scopes. Today every partner is served
 * by the mock/sandbox adapter; a real adapter is a new factory registered here by
 * code — callers (ingestion, future order routing) never change. `now` is
 * injected so the adapter's T+2 clock is testable.
 */
export async function adapterFor(
  tx: Transaction,
  partnerCode: string,
  capability: Capability,
  now: () => number,
): Promise<{ adapter: PartnerAdapter; partnerId: string }> {
  const [partner] = await tx
    .select({ id: partners.id, code: partners.code, agreementStatus: partners.agreementStatus })
    .from(partners)
    .where(eq(partners.code, partnerCode));
  if (!partner) throw new Error(`unknown partner ${partnerCode}`);

  const registry = new AdapterRegistry();
  registry.register(partner.code, {
    factory: () => createMockAdapter({ ...mockSeed(partner.code), now }),
    agreementStatus: partner.agreementStatus as AgreementStatus,
    // Sandbox partners get both scopes; a real deployment maps these from the DB.
    scopes: new Set<Capability>(['read', 'trade']),
  });

  return { adapter: registry.resolve(partner.code, capability), partnerId: partner.id };
}
