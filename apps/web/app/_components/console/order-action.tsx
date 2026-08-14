'use client';

import { Button } from '@/app/_components/ui/button';
import type { ConsoleOrder } from '@/lib/console-api';
import * as React from 'react';
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
  onReject: (id: string, reason?: string) => void;
}) {
  const busy = busyId === order.id;
  const label = order.instrumentName ?? 'this order';
  /**
   * Whether this row is asking why.
   *
   * `reject_order` has always written `rejected_reason`, `/orders/:id/reject`
   * has always accepted one, and the client function has always had the
   * parameter — the reason was dropped at the call site, so every investor was
   * told "Your institution did not take this order on" and nothing else. The
   * pattern is the one client-review.tsx already uses for declining a client:
   * the row's controls are replaced in place rather than opening a dialog.
   */
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState('');

  if (order.status === 'settled')
    return <span className={`text-sm font-bold ${SUCCESS_TEXT}`}>Settled ✓</span>;
  if (order.status === 'rejected')
    return (
      <div className="text-right">
        <span className={`text-sm font-bold ${TERRA_TEXT}`}>Rejected</span>
        {/* The reason was selected by the API and rendered nowhere, so a desk
            could not see its own decision after making it. */}
        {order.rejectedReason ? (
          <div className="mt-0.5 text-[12.5px] italic text-faint">{order.rejectedReason}</div>
        ) : null}
      </div>
    );
  if (order.status === 'expired')
    return <span className="text-sm font-bold text-faint">Expired</span>;

  if (asking) {
    return (
      <form
        className="flex flex-wrap items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // Empty sends nothing rather than '', which `rejectSchema.min(1)`
          // would refuse; the server then writes its own default.
          onReject(order.id, reason.trim() || undefined);
          setAsking(false);
          setReason('');
        }}
      >
        <label className="min-w-[200px] flex-1 text-[13px]">
          <span className="sr-only">Why {label} is being rejected</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — the client is told this"
            className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          />
        </label>
        <Button type="submit" size="sm" variant="ghost" className={TERRA_GHOST_BTN} disabled={busy}>
          {busy ? 'Rejecting…' : 'Reject'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setAsking(false);
            setReason('');
          }}
        >
          Cancel
        </Button>
      </form>
    );
  }

  const reject = compact ? null : (
    <Button
      size="sm"
      variant="ghost"
      className={TERRA_GHOST_BTN}
      disabled={busy}
      onClick={() => setAsking(true)}
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
