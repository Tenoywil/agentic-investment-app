/**
 * @ccn/partner-adapters — the ports-and-adapters seam to the regulated partners.
 * The mock/sandbox adapter drives all staging traffic today; a real institution
 * is a new file implementing the same PartnerAdapter port, registered by code and
 * gated by the registry on agreement status + scope, with no caller changes. Also
 * hosts the statement-ingestion parse layer that feeds the reconciliation queue.
 */
export * from './port';
export * from './mock-adapter';
export * from './registry';
export * from './statement';
export * from './contract';
