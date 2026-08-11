/**
 * Gateway opportunity state machine — pure, guarded transitions, same shape as
 * `./order.ts`'s order lifecycle. Mirrors `packages/gateway-guardrail`'s decision
 * vocabulary: the guardrail's `allow`/`allow_with_disclosure` both land on
 * `approved` (disclosure is a flag on the row, not a status fork — a status
 * combinatorial explosion buys nothing here); `human_review` lands on
 * `pending_review`; `block` lands on `rejected`.
 */

export type GatewayOpportunityStatus =
  | 'submitted'
  | 'assessed'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type GatewayOpportunityEvent =
  | 'assess'
  | 'evaluate_allow'
  | 'evaluate_review'
  | 'evaluate_block'
  | 'approve'
  | 'reject';

const TRANSITIONS: Record<
  GatewayOpportunityStatus,
  Partial<Record<GatewayOpportunityEvent, GatewayOpportunityStatus>>
> = {
  submitted: { assess: 'assessed' },
  assessed: {
    evaluate_allow: 'approved',
    evaluate_review: 'pending_review',
    evaluate_block: 'rejected',
  },
  pending_review: { approve: 'approved', reject: 'rejected' },
  approved: {},
  rejected: {},
};

export const GATEWAY_TERMINAL_STATUSES: readonly GatewayOpportunityStatus[] = [
  'approved',
  'rejected',
] as const;

export function isGatewayTerminalStatus(status: GatewayOpportunityStatus): boolean {
  return GATEWAY_TERMINAL_STATUSES.includes(status);
}

export function canApplyGatewayEvent(
  from: GatewayOpportunityStatus,
  event: GatewayOpportunityEvent,
): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function nextGatewayStatus(
  from: GatewayOpportunityStatus,
  event: GatewayOpportunityEvent,
): GatewayOpportunityStatus {
  const to = TRANSITIONS[from][event];
  if (to === undefined) {
    throw new Error(`illegal gateway opportunity transition: cannot ${event} from ${from}`);
  }
  return to;
}

export function legalGatewayEvents(from: GatewayOpportunityStatus): GatewayOpportunityEvent[] {
  return Object.keys(TRANSITIONS[from]) as GatewayOpportunityEvent[];
}

/** Map a `@ccn/gateway-guardrail` decision to the event that advances the opportunity. */
export function gatewayEventForGuardrailDecision(
  decision: 'allow' | 'allow_with_disclosure' | 'human_review' | 'block',
): GatewayOpportunityEvent {
  switch (decision) {
    case 'allow':
    case 'allow_with_disclosure':
      return 'evaluate_allow';
    case 'human_review':
      return 'evaluate_review';
    case 'block':
      return 'evaluate_block';
  }
}

export type GatewayIntroductionStatus = 'requested' | 'approved' | 'rejected' | 'completed';

export type GatewayIntroductionEvent = 'approve' | 'reject' | 'complete';

const INTRO_TRANSITIONS: Record<
  GatewayIntroductionStatus,
  Partial<Record<GatewayIntroductionEvent, GatewayIntroductionStatus>>
> = {
  requested: { approve: 'approved', reject: 'rejected' },
  approved: { complete: 'completed' },
  rejected: {},
  completed: {},
};

export function canApplyIntroductionEvent(
  from: GatewayIntroductionStatus,
  event: GatewayIntroductionEvent,
): boolean {
  return INTRO_TRANSITIONS[from][event] !== undefined;
}

export function nextIntroductionStatus(
  from: GatewayIntroductionStatus,
  event: GatewayIntroductionEvent,
): GatewayIntroductionStatus {
  const to = INTRO_TRANSITIONS[from][event];
  if (to === undefined) {
    throw new Error(`illegal introduction transition: cannot ${event} from ${from}`);
  }
  return to;
}
