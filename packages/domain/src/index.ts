/**
 * @ccn/domain — pure domain rules shared across the API and (where relevant) the
 * web app: the order state machine, suitability policy, and the Zod schemas that
 * validate every request boundary. No I/O, no clock, no randomness.
 */
export * from './order';
export * from './suitability';
export * from './schemas';
export * from './gateway';
export * from './target-mix';

/**
 * Audit actions that record a human decision about a client's standing, money,
 * or execution. Shared by the API filter and the console label so those two
 * views cannot quietly disagree as the audit vocabulary grows.
 */
export const AUDIT_DECISION_ACTIONS = [
  'client.accepted',
  'client.declined',
  'client.revoked',
  'client.reinstated',
  'funds.settled',
  'withdrawal.paid',
  'withdrawal.declined',
  'reconciliation.matched',
  'reconciliation.rejected',
  'order.accepted',
  'order.settled',
  'order.rejected',
  'partner.profile_updated',
] as const;
