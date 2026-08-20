'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { type ConsoleOrder, type SettlementInput, consoleContractNoteUrl } from '@/lib/console-api';
import { X } from 'lucide-react';
import * as React from 'react';
import { SUCCESS_TEXT, TERRA_GHOST_BTN, TERRA_OUTLINE_BTN, TERRA_TEXT, fmtMinorExact } from './lib';

/**
 * The accept / settle / reject controls for one order, and the terminal-state
 * labels that replace them. Every branch is a real transition on
 * /api/console/orders/:id/* — there is no decorative button here.
 */

const FIELD =
  'block min-h-12 w-full rounded-xl border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground';
const MICRO = 'text-[11px] font-bold uppercase tracking-[.5px] text-faint';

/** Major units in the form → exact minor units on the wire. */
function toMinor(major: string, label: string): { value?: string; error?: string } {
  const cleaned = major.replace(/[,\s]/g, '');
  if (!cleaned) return {};
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return { error: `${label} must be a valid amount with no more than 2 decimal places.` };
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > 9_223_372_036_854_775_807n) {
    return { error: `${label} exceeds the supported amount range.` };
  }
  return { value: String(value) };
}

async function recordAction(action: () => Promise<boolean>): Promise<boolean> {
  try {
    return await action();
  } catch {
    return false;
  }
}

function formatUnitsExact(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
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
  onAccept: (id: string, settlementEta?: string) => Promise<boolean>;
  onSettle: (id: string, detail?: SettlementInput) => Promise<boolean>;
  onReject: (id: string, reason?: string) => Promise<boolean>;
}) {
  const busy = busyId === order.id;
  const label = order.instrumentName ?? 'this order';
  /**
   * Which form this row is showing, if any.
   *
   * Rejecting asks why; accepting asks when it will settle; settling asks what
   * was executed. The state is local to this row while the form itself renders
   * in the browser's top layer, so a mobile table never has to contain it.
   */
  const [asking, setAsking] = React.useState<'reject' | 'accept' | 'settle' | null>(null);
  const [reason, setReason] = React.useState('');
  const [eta, setEta] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [units, setUnits] = React.useState('');
  const [fee, setFee] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(submitting);
  submittingRef.current = submitting;
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLButtonElement | null>(null);
  const titleId = React.useId();

  const clear = () => {
    setAsking(null);
    setReason('');
    setEta('');
    setPrice('');
    setUnits('');
    setFee('');
    setRef('');
    setFormError(null);
    setSubmitting(false);
  };

  const closeDialog = React.useCallback(() => {
    if (!submittingRef.current) dialogRef.current?.close();
  }, []);
  useSheetDismiss(dialogRef, closeDialog);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !asking || dialog.open) return;
    dialog.showModal();
  }, [asking]);

  function openDialog(kind: 'reject' | 'accept' | 'settle', opener: HTMLButtonElement) {
    openerRef.current = opener;
    setFormError(null);
    setAsking(kind);
  }

  function dismissed() {
    clear();
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asking || submitting) return;
    setFormError(null);
    let completed = false;
    setSubmitting(true);
    if (asking === 'reject') {
      // Empty sends nothing rather than '', which `rejectSchema.min(1)`
      // would refuse; the server then writes its own default.
      completed = await recordAction(() => onReject(order.id, reason.trim() || undefined));
    } else if (asking === 'accept') {
      completed = await recordAction(() =>
        onAccept(order.id, eta ? new Date(eta).toISOString() : undefined),
      );
    } else if (asking === 'settle') {
      const detail: SettlementInput = {};
      const parsedPrice = toMinor(price, 'Unit price');
      const parsedFee = toMinor(fee, 'Fee');
      const normalizedUnits = units.replace(/[,\s]/g, '');
      const unitsValid =
        !normalizedUnits ||
        (/^\d{1,14}(?:\.\d{1,6})?$/.test(normalizedUnits) && /[1-9]/.test(normalizedUnits));
      const validationError =
        parsedPrice.error ??
        parsedFee.error ??
        (!unitsValid
          ? 'Units must be greater than zero, use no more than 14 whole digits, and have no more than 6 decimal places.'
          : null);
      if (validationError) {
        setFormError(validationError);
        setSubmitting(false);
        return;
      }
      if (parsedPrice.value !== undefined) detail.unitPriceMinor = parsedPrice.value;
      if (normalizedUnits) detail.units = normalizedUnits;
      if (parsedFee.value !== undefined) detail.feeMinor = parsedFee.value;
      if (ref.trim()) detail.externalRef = ref.trim();
      completed = await recordAction(() =>
        onSettle(order.id, Object.keys(detail).length > 0 ? detail : undefined),
      );
    }
    setSubmitting(false);
    if (completed) dialogRef.current?.close();
    else
      setFormError(
        'The action was not recorded. Review the message on the order queue and try again.',
      );
  }

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
              order.units ? `${formatUnitsExact(order.units)} units` : null,
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
        {/* The desk's copy of the client's contract note — one renderer, one
            record of the trade. Opens printable in a new tab. */}
        <a
          href={consoleContractNoteUrl(order.id)}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-block text-[12.5px] font-bold text-teal2 underline-offset-4 hover:underline"
        >
          Contract note
        </a>
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

  /**
   * The confirmation UI belongs to a full-width phone sheet, not to one cell
   * in a horizontally scrolling table. Keeping the closed dialog beside the
   * trigger also lets the browser preserve focus and the top-layer correctly.
   */
  const prompt = (
    <dialog
      ref={dialogRef}
      className="app-modal order-action-modal"
      aria-labelledby={titleId}
      onClose={dismissed}
      onCancel={(event) => {
        if (submitting) event.preventDefault();
      }}
    >
      <button
        type="button"
        data-sheet-handle
        onClick={closeDialog}
        aria-label="Close"
        className="app-sheet__handle app-modal__handle"
        disabled={submitting}
      />

      <div className="flex flex-none items-start justify-between gap-4 border-0 border-b border-solid border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className={MICRO}>Order action</div>
          <h2 id={titleId} className="mb-0 mt-1 font-display text-xl font-bold">
            {asking === 'settle'
              ? 'Record settlement'
              : asking === 'reject'
                ? 'Reject order'
                : 'Accept order'}
          </h2>
          <p className="mb-0 mt-1 text-sm leading-normal text-dim">
            {label} · {order.clientRef || 'Client'} ·{' '}
            <span className="font-mono font-bold text-foreground">
              {fmtMinorExact(order.amountMinor, order.currency)}
            </span>
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-12 min-w-12"
          onClick={closeDialog}
          aria-label="Close"
          disabled={submitting}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <form
        onSubmit={submit}
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6"
      >
        {formError ? (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-terra/10 px-4 py-3 text-sm leading-relaxed text-terra-ink"
          >
            {formError}
          </div>
        ) : null}
        {asking === 'reject' ? (
          <label className="block text-sm">
            <span className={MICRO}>Reason sent to the client</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is the desk unable to execute this order?"
              className={`${FIELD} mt-2 min-h-24 resize-y`}
              maxLength={500}
            />
          </label>
        ) : null}

        {asking === 'accept' ? (
          <>
            <p className="mt-0 text-sm leading-relaxed text-dim">
              Accepting moves the order to your execution queue. Add the expected settlement date if
              your desk can commit to one now.
            </p>
            <label className="block text-sm">
              <span className={MICRO}>Expected settlement date · optional</span>
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className={`${FIELD} mt-2`}
              />
            </label>
          </>
        ) : null}

        {asking === 'settle' ? (
          <>
            <div className="mb-5 rounded-xl border border-solid border-border bg-muted/30 p-4">
              <b className="text-sm">Complete the client’s execution record</b>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                Add the details your desk has. Empty optional fields remain unreported rather than
                being recorded as zero.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className={MICRO}>Unit price · optional</span>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="100.25"
                  className={`${FIELD} mt-2`}
                  aria-describedby={`${titleId}-price-hint`}
                />
                <span id={`${titleId}-price-hint`} className="mt-1 block text-[12px] text-faint">
                  In {order.currency}, up to 2 decimal places
                </span>
              </label>
              <label className="block text-sm">
                <span className={MICRO}>Units · optional</span>
                <input
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  inputMode="decimal"
                  placeholder="50"
                  className={`${FIELD} mt-2`}
                />
              </label>
              <label className="block text-sm">
                <span className={MICRO}>Fee · optional</span>
                <input
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className={`${FIELD} mt-2`}
                  aria-label={`Fee in ${order.currency}`}
                />
              </label>
              <label className="block text-sm">
                <span className={MICRO}>Your reference · optional</span>
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="TRD-88214"
                  className={`${FIELD} mt-2`}
                  maxLength={120}
                />
              </label>
            </div>
          </>
        ) : null}

        <div className="mt-auto flex flex-col-reverse gap-3 border-0 border-t border-solid border-border pt-4 sm:mt-6 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full sm:w-auto"
            onClick={closeDialog}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={asking === 'reject' || asking === 'settle' ? 'outline' : 'default'}
            className={`min-h-12 w-full sm:w-auto ${
              asking === 'reject' ? TERRA_GHOST_BTN : asking === 'settle' ? TERRA_OUTLINE_BTN : ''
            }`}
            disabled={busy || submitting}
          >
            {busy || submitting
              ? asking === 'reject'
                ? 'Rejecting…'
                : asking === 'settle'
                  ? 'Settling…'
                  : 'Accepting…'
              : asking === 'reject'
                ? 'Reject order'
                : asking === 'settle'
                  ? 'Confirm settled'
                  : 'Accept order'}
          </Button>
        </div>
      </form>
    </dialog>
  );

  const reject = compact ? null : (
    <Button
      size="sm"
      variant="ghost"
      className={TERRA_GHOST_BTN}
      disabled={busy}
      onClick={(event) => openDialog('reject', event.currentTarget)}
    >
      Reject<span className="sr-only"> {label}</span>
    </Button>
  );

  if (order.status === 'created') {
    return (
      <>
        <div className="flex justify-end gap-1.5">
          {reject}
          <Button
            size="sm"
            disabled={busy}
            onClick={(event) => openDialog('accept', event.currentTarget)}
          >
            {busy ? 'Accepting…' : 'Accept'}
            <span className="sr-only"> {label}</span>
          </Button>
        </div>
        {prompt}
      </>
    );
  }

  // accepted → awaiting settlement
  return (
    <>
      <div className="flex justify-end gap-1.5">
        {reject}
        <Button
          size="sm"
          variant="outline"
          className={TERRA_OUTLINE_BTN}
          disabled={busy}
          onClick={(event) => openDialog('settle', event.currentTarget)}
        >
          {busy ? 'Settling…' : 'Settle'}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
      {prompt}
    </>
  );
}
