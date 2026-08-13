'use client';

import { Button } from '@/app/_components/ui/button';
import type { ConsoleOrder } from '@/lib/console-api';
import { SUCCESS_TEXT, TERRA_GHOST_BTN, TERRA_OUTLINE_BTN, TERRA_TEXT } from './lib';

/**
 * The accept / settle / reject controls for one order, and the terminal-state
 * labels that replace them. Every branch is a real transition on
 * /api/console/orders/:id/* — there is no decorative button here.
 */
export function OrderAction({
  order,
  busyId,
  compact,
  onAccept,
  onSettle,
  onReject,
}: {
  order: ConsoleOrder;
  busyId: string | null;
  /** Overview shows accept/settle only; the full table adds Reject. */
  compact?: boolean;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const busy = busyId === order.id;
  const label = order.instrumentName ?? 'this order';

  if (order.status === 'settled')
    return <span className={`text-sm font-bold ${SUCCESS_TEXT}`}>Settled ✓</span>;
  if (order.status === 'rejected')
    return <span className={`text-sm font-bold ${TERRA_TEXT}`}>Rejected</span>;
  if (order.status === 'expired')
    return <span className="text-sm font-bold text-faint">Expired</span>;

  const reject = compact ? null : (
    <Button
      size="sm"
      variant="ghost"
      className={TERRA_GHOST_BTN}
      disabled={busy}
      onClick={() => onReject(order.id)}
    >
      Reject<span className="sr-only"> {label}</span>
    </Button>
  );

  if (order.status === 'created') {
    return (
      <div className="flex justify-end gap-1.5">
        {reject}
        <Button size="sm" disabled={busy} onClick={() => onAccept(order.id)}>
          {busy ? 'Accepting…' : 'Accept'}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
    );
  }

  // accepted → awaiting settlement
  return (
    <div className="flex justify-end gap-1.5">
      {reject}
      <Button
        size="sm"
        variant="outline"
        className={TERRA_OUTLINE_BTN}
        disabled={busy}
        onClick={() => onSettle(order.id)}
      >
        {busy ? 'Settling…' : 'Settle'}
        <span className="sr-only"> {label}</span>
      </Button>
    </div>
  );
}
