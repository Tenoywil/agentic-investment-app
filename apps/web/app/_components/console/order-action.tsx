'use client';

import { Button } from '@/app/_components/ui/button';
import type { ConsoleOrder, SettlementInput } from '@/lib/console-api';
import * as React from 'react';
import { SUCCESS_TEXT, TERRA_GHOST_BTN, TERRA_OUTLINE_BTN, TERRA_TEXT, fmtMinorExact } from './lib';

/**
 * The accept / settle / reject controls for one order, and the terminal-state
 * labels that replace them. Every branch is a real transition on
 * /api/console/orders/:id/* — there is no decorative button here.
 */

const FIELD =
  'block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground';
const MICRO = 'text-[11px] font-bold uppercase tracking-[.5px] text-faint';

/** Major units in the form → minor units on the wire, rounded on whole cents. */
function toMinor(major: string): string | undefined {
  const cleaned = major.replace(/[,\s]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return String(Math.round(n * 100));
}

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
  onAccept: (id: string, settlementEta?: string) => void;
  onSettle: (id: string, detail?: SettlementInput) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const busy = busyId === order.id;
  const label = order.instrumentName ?? 'this order';
  /**
   * Which form this row is showing, if any.
   *
   * Rejecting asks why; accepting asks when it will settle; settling asks what
   * was executed. All three replace the row's controls in place rather than
   * opening a dialog — the pattern client-review.tsx already uses.
   */
  const [asking, setAsking] = React.useState<'reject' | 'accept' | 'settle' | null>(null);
  const [reason, setReason] = React.useState('');
  const [eta, setEta] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [units, setUnits] = React.useState('');
  const [fee, setFee] = React.useState('');
  const [ref, setRef] = React.useState('');

  const clear = () => {
    setAsking(null);
    setReason('');
    setEta('');
    setPrice('');
    setUnits('');
    setFee('');
    setRef('');
  };

  if (order.status === 'settled') {
    return (
      <div className="text-right">
        <span className={`text-sm font-bold ${SUCCESS_TEXT}`}>Settled ✓</span>
        {/* What the firm reported, if it reported anything. An unreported
            figure is left out rather than shown as zero — "settled at US$0.00"
            is a claim about someone's money that nobody made. */}
        {order.unitPriceMinor || order.units || order.feeMinor || order.externalRef ? (
          <div className="mt-0.5 text-[12px] leading-snug text-faint">
            {[
              order.units ? `${Number(order.units)} units` : null,
              order.unitPriceMinor
                ? `@ ${fmtMinorExact(order.unitPriceMinor, order.currency)}`
                : null,
              order.feeMinor ? `fee ${fmtMinorExact(order.feeMinor, order.currency)}` : null,
              order.externalRef,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : null}
      </div>
    );
  }
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

  if (asking === 'reject') {
    return (
      <form
        className="flex flex-wrap items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          // Empty sends nothing rather than '', which `rejectSchema.min(1)`
          // would refuse; the server then writes its own default.
          onReject(order.id, reason.trim() || undefined);
          clear();
        }}
      >
        <label className="min-w-[200px] flex-1 text-[13px]">
          <span className="sr-only">Why {label} is being rejected</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — the client is told this"
            className={FIELD}
          />
        </label>
        <Button type="submit" size="sm" variant="ghost" className={TERRA_GHOST_BTN} disabled={busy}>
          {busy ? 'Rejecting…' : 'Reject'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          Cancel
        </Button>
      </form>
    );
  }

  /**
   * Accepting commits to a settlement date.
   *
   * The exec dialog tells every investor the date is "set by your firm on
   * acceptance", and until now nothing wrote it — `settlement_eta` has existed
   * since the first migration with no writer, so the Orders screen could never
   * say when. Optional, because a desk that cannot yet commit must still be
   * able to accept, and a date invented to fill the field is the fabricated
   * "T+2" this product already removed once.
   */
  if (asking === 'accept') {
    return (
      <form
        className="flex flex-wrap items-end justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onAccept(order.id, eta ? new Date(eta).toISOString() : undefined);
          clear();
        }}
      >
        <label className="text-[13px]">
          <span className={MICRO}>Settles on</span>
          <input
            type="date"
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            className={FIELD}
          />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Accepting…' : 'Accept'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          Cancel
        </Button>
      </form>
    );
  }

  /**
   * Settling records what was executed.
   *
   * `settle_order` wrote three columns — status, settled_at, updated_at — so an
   * investor was told "settled" and nothing else about their own trade. Every
   * field is optional: a firm that does not report a price still has to be able
   * to settle, and an empty column is honest where an invented one is not.
   */
  if (asking === 'settle') {
    return (
      <form
        className="flex flex-wrap items-end justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const detail: SettlementInput = {};
          const p = toMinor(price);
          const f = toMinor(fee);
          if (p) detail.unitPriceMinor = p;
          if (units.trim()) detail.units = units.trim();
          if (f) detail.feeMinor = f;
          if (ref.trim()) detail.externalRef = ref.trim();
          onSettle(order.id, Object.keys(detail).length > 0 ? detail : undefined);
          clear();
        }}
      >
        <label className="w-[92px] text-[13px]">
          <span className={MICRO}>Unit price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="100.25"
            className={FIELD}
          />
        </label>
        <label className="w-[80px] text-[13px]">
          <span className={MICRO}>Units</span>
          <input
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            inputMode="decimal"
            placeholder="50"
            className={FIELD}
          />
        </label>
        <label className="w-[80px] text-[13px]">
          <span className={MICRO}>Fee</span>
          <input
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className={FIELD}
          />
        </label>
        <label className="w-[120px] text-[13px]">
          <span className={MICRO}>Your reference</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="TRD-88214"
            className={FIELD}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className={TERRA_OUTLINE_BTN}
          disabled={busy}
        >
          {busy ? 'Settling…' : 'Confirm settled'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
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
      onClick={() => setAsking('reject')}
    >
      Reject<span className="sr-only"> {label}</span>
    </Button>
  );

  if (order.status === 'created') {
    return (
      <div className="flex justify-end gap-1.5">
        {reject}
        <Button size="sm" disabled={busy} onClick={() => setAsking('accept')}>
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
        onClick={() => setAsking('settle')}
      >
        {busy ? 'Settling…' : 'Settle'}
        <span className="sr-only"> {label}</span>
      </Button>
    </div>
  );
}
