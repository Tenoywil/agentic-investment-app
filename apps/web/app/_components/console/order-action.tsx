'use client';

import { Button } from '@/app/_components/ui/button';
import type { ConsoleOrder } from '@/lib/console-api';
import { TERRA_GHOST_BTN } from './lib';

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
    return <span className="text-sm font-bold text-success">Settled ✓</span>;
  if (order.status === 'rejected')
    return <span className="text-sm font-bold text-[#a44e20] dark:text-terra">Rejected</span>;
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
        className="border-solid border-terra text-terra hover:bg-transparent hover:text-terra"
        disabled={busy}
        onClick={() => onSettle(order.id)}
      >
        {busy ? 'Settling…' : 'Settle'}
        <span className="sr-only"> {label}</span>
      </Button>
    </div>
  );
}
