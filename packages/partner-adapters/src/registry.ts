import type { Capability, PartnerAdapter } from './port';

/** Mirrors the DB `agreement_status` enum. Only sandbox/live are routable. */
export type AgreementStatus = 'prospect' | 'dpa_pending' | 'sandbox' | 'live' | 'suspended';

const ROUTABLE: ReadonlySet<AgreementStatus> = new Set<AgreementStatus>(['sandbox', 'live']);

export interface AdapterRegistration {
  /** Lazily construct the adapter so an unroutable partner is never built. */
  factory: () => PartnerAdapter;
  agreementStatus: AgreementStatus;
  scopes: ReadonlySet<Capability>;
}

export class AdapterScopeError extends Error {}

/**
 * Resolves a partner's adapter by code, enforcing the two gates that keep CCN
 * from routing anything it shouldn't: the agreement must be sandbox or live, and
 * the requested capability must be in the partner's granted scopes. `placeOrder`
 * needs `trade`; reads need `read`. This is the one place a real adapter drops in,
 * so callers never change.
 */
export class AdapterRegistry {
  private readonly registrations = new Map<string, AdapterRegistration>();

  register(code: string, registration: AdapterRegistration): void {
    this.registrations.set(code, registration);
  }

  has(code: string): boolean {
    return this.registrations.has(code);
  }

  /** Resolve the adapter for `code`, or throw if unknown / not routable / out of scope. */
  resolve(code: string, capability: Capability): PartnerAdapter {
    const reg = this.registrations.get(code);
    if (!reg) throw new AdapterScopeError(`no adapter registered for partner ${code}`);
    if (!ROUTABLE.has(reg.agreementStatus)) {
      throw new AdapterScopeError(`partner ${code} is ${reg.agreementStatus}; not routable`);
    }
    if (!reg.scopes.has(capability)) {
      throw new AdapterScopeError(`partner ${code} lacks the ${capability} scope`);
    }
    return reg.factory();
  }
}
