/**
 * Order state machine — pure, guarded transitions that mirror the SECURITY
 * DEFINER functions in packages/db (create_order / accept_order / settle_order /
 * reject_order) and 04-approval-sequence.mmd. The database enforces the same
 * rules; this module lets the app reason about legality before it calls, and is
 * exhaustively unit-tested where the DB path is integration-tested.
 */

export type OrderStatus = 'created' | 'accepted' | 'settled' | 'rejected' | 'expired';
export type OrderEvent = 'accept' | 'settle' | 'reject' | 'expire';

/** Legal (status, event) → next status. Anything absent is illegal. */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>> = {
  created: { accept: 'accepted', reject: 'rejected', expire: 'expired' },
  accepted: { settle: 'settled', reject: 'rejected' },
  settled: {},
  rejected: {},
  expired: {},
};

/** States with no outgoing transition. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'settled',
  'rejected',
  'expired',
] as const;

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Whether `event` is legal from `from`. */
export function canApply(from: OrderStatus, event: OrderEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * Apply `event` to `from`, returning the next status. Throws on an illegal
 * transition — the same contract the DB functions enforce (they RAISE and the
 * guarded UPDATE matches no row).
 */
export function nextStatus(from: OrderStatus, event: OrderEvent): OrderStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    throw new Error(`illegal order transition: cannot ${event} an order that is ${from}`);
  }
  return to;
}

/** The events legal from a given status (useful for surfacing available actions). */
export function legalEvents(from: OrderStatus): OrderEvent[] {
  return Object.keys(TRANSITIONS[from]) as OrderEvent[];
}
