import type { Currency } from '@ccn/money';

/**
 * The PartnerAdapter port. Every regulated partner — the mock/sandbox today, a
 * real institution when its DPA and API land — is reached only through this
 * interface. A real adapter is a new file implementing this port, registered by
 * partner code; no caller changes (ports + adapters, DI). CCN never executes:
 * `placeOrder` routes a signed instruction to the partner, who is the actor of
 * record and does the execution, custody and settlement.
 */

export type Capability = 'read' | 'trade';
export type PartnerOrderStatus = 'pending' | 'accepted' | 'settled' | 'rejected';

export interface PartnerHolding {
  instrumentSlug: string | null;
  name: string;
  valueMinor: bigint;
  currency: Currency;
}

export interface Quote {
  instrumentSlug: string;
  priceMinor: bigint;
  currency: Currency;
  asOf: string;
}

export interface OrderRequest {
  instrumentSlug: string;
  amountMinor: bigint;
  currency: Currency;
}

export interface PlacedOrder {
  partnerRef: string;
  status: PartnerOrderStatus;
  /** ISO timestamp the partner expects to settle (T+2). */
  settlementEta: string;
}

export interface OrderStatusResult {
  partnerRef: string;
  status: PartnerOrderStatus;
  settledAt?: string;
}

export interface StatementDoc {
  id: string;
  period: string;
  /** Raw statement lines, to be parsed into holdings then reconciled by a human. */
  lines: string[];
}

export interface KycConsent {
  verified: boolean;
  tier: 'none' | 'tier1' | 'tier2';
}

export interface PartnerAdapter {
  readonly code: string;
  /** Aggregate current holdings for a partner-side client reference. */
  getHoldings(clientRef: string): Promise<PartnerHolding[]>;
  getQuotes(slugs: string[]): Promise<Quote[]>;
  /** Route a signed instruction to the partner. Idempotent on idempotencyKey. */
  placeOrder(order: OrderRequest, idempotencyKey: string): Promise<PlacedOrder>;
  getStatus(partnerRef: string): Promise<OrderStatusResult>;
  /** Optional: pull statements for the ingestion/reconciliation pipeline. */
  getStatements?(clientRef: string): Promise<StatementDoc[]>;
  verifyKycConsent(clientRef: string): Promise<KycConsent>;
}
