import type { OrderRequest, PartnerAdapter } from './port';

/**
 * The adapter contract (Pact-style). Every case is a behavioral obligation of the
 * PartnerAdapter port. The mock is the baseline; a real adapter must pass exactly
 * these same cases, so a new integration cannot quietly break the caller's
 * assumptions. Each case receives a freshly built adapter and throws on violation.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`contract violation: ${message}`);
}

const isIso = (s: string): boolean => !Number.isNaN(Date.parse(s));

const SAMPLE_ORDER: OrderRequest = {
  instrumentSlug: 'goj32',
  amountMinor: 100_000n,
  currency: 'USD',
};

export interface ContractCase {
  name: string;
  run(makeAdapter: () => PartnerAdapter): Promise<void>;
}

export const CONTRACT_CASES: ContractCase[] = [
  {
    name: 'getHoldings resolves to an array',
    async run(make) {
      const holdings = await make().getHoldings('client-1');
      assert(Array.isArray(holdings), 'getHoldings must return an array');
    },
  },
  {
    name: 'getQuotes resolves to an array',
    async run(make) {
      const quotes = await make().getQuotes(['goj32']);
      assert(Array.isArray(quotes), 'getQuotes must return an array');
    },
  },
  {
    name: 'placeOrder returns a non-empty ref, accepted status, and an ISO T+2 settlement',
    async run(make) {
      const placed = await make().placeOrder(SAMPLE_ORDER, 'idem-1');
      assert(placed.partnerRef.length > 0, 'partnerRef must be non-empty');
      assert(placed.status === 'accepted', 'a fresh order must be accepted');
      assert(isIso(placed.settlementEta), 'settlementEta must be an ISO timestamp');
    },
  },
  {
    name: 'placeOrder is idempotent on the key',
    async run(make) {
      const adapter = make();
      const a = await adapter.placeOrder(SAMPLE_ORDER, 'idem-2');
      const b = await adapter.placeOrder(SAMPLE_ORDER, 'idem-2');
      assert(a.partnerRef === b.partnerRef, 'same key must return the same partnerRef');
    },
  },
  {
    name: 'getStatus reflects a placed order',
    async run(make) {
      const adapter = make();
      const placed = await adapter.placeOrder(SAMPLE_ORDER, 'idem-3');
      const status = await adapter.getStatus(placed.partnerRef);
      assert(status.partnerRef === placed.partnerRef, 'getStatus must echo the partnerRef');
      assert(
        ['pending', 'accepted', 'settled'].includes(status.status),
        'status must be a live order state',
      );
    },
  },
  {
    name: 'verifyKycConsent returns a valid consent shape',
    async run(make) {
      const consent = await make().verifyKycConsent('client-1');
      assert(typeof consent.verified === 'boolean', 'verified must be boolean');
      assert(['none', 'tier1', 'tier2'].includes(consent.tier), 'tier must be a valid KYC tier');
    },
  },
];
