import type {
  KycConsent,
  OrderRequest,
  OrderStatusResult,
  PartnerAdapter,
  PartnerHolding,
  PlacedOrder,
  Quote,
  StatementDoc,
} from './port';

const DAY_MS = 86_400_000;

export interface MockAdapterConfig {
  code: string;
  /** Injected clock (epoch ms) — deterministic in tests, real at runtime. */
  now: () => number;
  holdings?: PartnerHolding[];
  quotes?: Quote[];
  statements?: StatementDoc[];
  kyc?: KycConsent;
}

interface MockOrder {
  partnerRef: string;
  amountMinor: bigint;
  settlementEtaMs: number;
}

/**
 * The mock/sandbox partner adapter — the actor of record for all staging traffic.
 * It simulates T+2 settlement against the injected clock, is idempotent on the
 * order key, and is fully deterministic (no wall clock, no randomness). Real
 * adapters implement the same port and must pass the same contract.
 */
export function createMockAdapter(config: MockAdapterConfig): PartnerAdapter {
  const orders = new Map<string, MockOrder>();
  const byRef = new Map<string, MockOrder>();

  return {
    code: config.code,

    async getHoldings(): Promise<PartnerHolding[]> {
      return config.holdings ?? [];
    },

    async getQuotes(slugs: string[]): Promise<Quote[]> {
      const wanted = new Set(slugs);
      return (config.quotes ?? []).filter((q) => wanted.has(q.instrumentSlug));
    },

    async placeOrder(order: OrderRequest, idempotencyKey: string): Promise<PlacedOrder> {
      const existing = orders.get(idempotencyKey);
      if (existing) {
        return {
          partnerRef: existing.partnerRef,
          status: 'accepted',
          settlementEta: new Date(existing.settlementEtaMs).toISOString(),
        };
      }
      const partnerRef = `MOCK-${config.code}-${idempotencyKey}`;
      const record: MockOrder = {
        partnerRef,
        amountMinor: order.amountMinor,
        settlementEtaMs: config.now() + 2 * DAY_MS,
      };
      orders.set(idempotencyKey, record);
      byRef.set(partnerRef, record);
      return {
        partnerRef,
        status: 'accepted',
        settlementEta: new Date(record.settlementEtaMs).toISOString(),
      };
    },

    async getStatus(partnerRef: string): Promise<OrderStatusResult> {
      const record = byRef.get(partnerRef);
      if (!record) throw new Error(`unknown partner order ${partnerRef}`);
      if (config.now() >= record.settlementEtaMs) {
        return {
          partnerRef,
          status: 'settled',
          settledAt: new Date(record.settlementEtaMs).toISOString(),
        };
      }
      return { partnerRef, status: 'accepted' };
    },

    async getStatements(): Promise<StatementDoc[]> {
      return config.statements ?? [];
    },

    async verifyKycConsent(): Promise<KycConsent> {
      return config.kyc ?? { verified: true, tier: 'tier2' };
    },
  };
}

/**
 * Sample seed for a partner, resembling the prototype's data.
 *
 * The chequing balance is US$6,000 rather than US$1,000. That was not a
 * cosmetic number: `limits.cash_floor_minor` defaults to exactly US$1,000, so a
 * client whose sandbox account held exactly US$1,000 of cash had none above
 * their floor, and the guardrail correctly refused every order they could ever
 * place. Two defensible numbers that happened to be equal made the whole order
 * path unreachable for every new account on the network.
 */
export function mockSeed(code: string): Omit<MockAdapterConfig, 'now'> {
  return {
    code,
    holdings: [
      {
        instrumentSlug: 'goj32',
        name: 'GOJ USD Global Bond 2029',
        valueMinor: 1_240_000n,
        currency: 'USD',
      },
      { instrumentSlug: null, name: 'USD Chequing', valueMinor: 600_000n, currency: 'USD' },
    ],
    quotes: [
      {
        instrumentSlug: 'goj32',
        priceMinor: 10_000n,
        currency: 'USD',
        asOf: '2026-01-01T00:00:00.000Z',
      },
    ],
    statements: [
      {
        id: `${code}-2026-Q1`,
        period: '2026-Q1',
        lines: [
          'GOJ USD Global Bond 2029 .......... US$12,400  +6.8%',
          'USD Chequing ...................... US$6,000   —',
        ],
      },
    ],
    kyc: { verified: true, tier: 'tier2' },
  };
}
