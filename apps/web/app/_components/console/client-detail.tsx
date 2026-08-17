'use client';

import { Button } from '@/app/_components/ui/button';
import { EmptyState } from '@/app/_components/ui/empty';
import { useSheetDismiss } from '@/app/_lib/sheet';
import {
  type ConsoleClient,
  type ConsoleClientDetail,
  type ConsoleCurrency,
  clientDocumentUrl,
  confirmFunds,
  getClient,
} from '@/lib/console-api';
import { Boxes, CircleAlert, FileText, X } from 'lucide-react';
import * as React from 'react';
import { datedFilename, downloadCsv, toCsv } from './export-csv';
import {
  ROW_DIVIDER,
  TERRA_GHOST_BTN,
  auditActionLabel,
  auditActorLine,
  auditEntityLabel,
  auditReason,
  errorMessage,
  fmtMinor,
  timeAgo,
  uppr,
} from './lib';
import { RowsSkeleton } from './loading';
import { ErrorNote } from './notice';

/**
 * One client, opened.
 *
 * The Clients tab could say "4 positions · US$12,400 read into CCN" and could
 * not say what any of them were, which is the first thing anyone asks about a
 * client. It could also accept somebody and never un-accept them: the review
 * function hard-coded `status = 'pending'`, so a firm that needed to end a
 * relationship — a failed periodic review, a client who asked to leave — had no
 * control anywhere in the console.
 *
 * So this shows where the client's money actually sits, what they have traded
 * through this firm, their own thread of the firm's audit log, and the one
 * control that ends or restores the relationship.
 *
 * Revoking deletes nothing. It stops the holdings pull; the positions stay,
 * because they are facts about the client's money rather than the firm's to
 * erase, and the investor's own portfolio goes on showing them.
 */

const TIER_LABEL: Record<string, string> = {
  none: 'No KYC',
  tier1: 'Tier 1',
  tier2: 'Tier 2',
};

const FUNDS_CURRENCIES: ConsoleCurrency[] = ['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'];

/** What each document kind is FOR, in the reviewer's vocabulary. */
const DOC_STEP_LABEL: Record<string, string> = {
  identity: 'Identity',
  compliance: 'Address & tax',
  risk: 'Risk',
  funds: 'Source of funds',
};

export function ClientDetailDialog({
  client,
  busy,
  actionError,
  onReview,
  onClose,
}: {
  client: ConsoleClient;
  busy: boolean;
  actionError: string | null;
  onReview: (id: string, accept: boolean, reason?: string) => void;
  onClose: () => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  const [detail, setDetail] = React.useState<ConsoleClientDetail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [reason, setReason] = React.useState('');

  // Settled-funds form. The funding itself happened off-platform, between the
  // client and this firm; this records the firm's confirmation that it landed.
  const [fundsAmt, setFundsAmt] = React.useState('');
  const [fundsCurrency, setFundsCurrency] = React.useState<ConsoleCurrency>('USD');
  const [fundsRef, setFundsRef] = React.useState('');
  const [fundsBusy, setFundsBusy] = React.useState(false);
  const [fundsNote, setFundsNote] = React.useState<string | null>(null);
  const [fundsError, setFundsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener('click', onBackdrop);
    return () => el.removeEventListener('click', onBackdrop);
  }, []);

  /**
   * Re-read on every status change as well as on open. The list row updates
   * optimistically from the parent; the detail's own audit thread only gains
   * the row the decision just wrote if it asks again.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacting to the status change is the point
  React.useEffect(() => {
    let live = true;
    getClient(client.account_id)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errorMessage(err, 'Could not load this client.'));
      });
    return () => {
      live = false;
    };
  }, [client.account_id, client.status]);

  const close = React.useCallback(() => dialogRef.current?.close(), []);
  useSheetDismiss(dialogRef, close);

  const dismissed = React.useCallback(() => {
    openerRef.current?.focus();
    onClose();
  }, [onClose]);

  const holdings = detail?.holdings ?? [];
  const orders = detail?.orders ?? [];
  const audit = detail?.audit ?? [];

  async function submitFunds(e: React.FormEvent) {
    e.preventDefault();
    const major = Number.parseFloat(fundsAmt.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(major) || major <= 0) {
      setFundsError('Enter the settled amount.');
      return;
    }
    setFundsBusy(true);
    setFundsError(null);
    setFundsNote(null);
    try {
      await confirmFunds(client.account_id, {
        amountMinor: String(Math.round(major * 100)),
        currency: fundsCurrency,
        reference: fundsRef.trim() || undefined,
      });
      setFundsNote(
        `Recorded. ${client.client_name}'s cash balance with you now reflects it, and they can see it on their portfolio.`,
      );
      setFundsAmt('');
      setFundsRef('');
      // Re-read so the cash line and the audit row this just wrote appear.
      setDetail(await getClient(client.account_id));
    } catch (err) {
      setFundsError(errorMessage(err, 'Could not record the settled funds.'));
    } finally {
      setFundsBusy(false);
    }
  }

  function exportHoldings() {
    downloadCsv(
      datedFilename(`ccn-client-${client.client_name.replace(/[^a-zA-Z0-9]+/g, '-')}`),
      toCsv(holdings, [
        { header: 'Holding', value: (h) => h.name },
        { header: 'Product', value: (h) => h.instrument_name ?? '' },
        { header: 'Value (minor units)', value: (h) => h.value_minor },
        { header: 'Currency', value: (h) => h.currency },
        { header: 'Return label', value: (h) => h.return_label ?? '' },
        { header: 'First read', value: (h) => h.created_at },
        { header: 'Last updated', value: (h) => h.updated_at },
      ]),
    );
  }

  return (
    <dialog ref={dialogRef} className="app-modal" aria-labelledby={titleId} onClose={dismissed}>
      <button
        type="button"
        data-sheet-handle
        onClick={close}
        aria-label="Close"
        className="app-sheet__handle app-modal__handle"
      />

      <div className="flex flex-none items-start justify-between gap-3 border-0 border-b border-solid border-border px-[22px] py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {client.client_name}
          </h2>
          <div className="truncate text-[13.5px] text-dim">
            {client.client_email}
            {client.residency_country ? ` · ${client.residency_country}` : ''} ·{' '}
            {TIER_LABEL[client.kyc_tier] ?? client.kyc_tier}
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={close} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[max(22px,env(safe-area-inset-bottom))]">
        {loadError ? <ErrorNote message={loadError} className="mb-3" /> : null}
        {actionError ? <ErrorNote message={actionError} className="mb-3" /> : null}
        {!detail && !loadError ? <RowsSkeleton rows={3} label="Loading this client" /> : null}

        {detail ? (
          <>
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="font-display text-[15px]">Where their money is with you</b>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={exportHoldings}
                  disabled={holdings.length === 0}
                >
                  Export CSV
                </Button>
              </div>

              {holdings.length === 0 ? (
                <div className="mt-2">
                  <EmptyState
                    icon={Boxes}
                    title="No positions read yet"
                    body="Once this client is active, CCN reads the positions they hold with you and lists each of them here."
                  />
                </div>
              ) : (
                <div className="mt-2">
                  <div className={`grid grid-cols-[2fr_1fr] pb-1.5 ${ROW_DIVIDER} ${uppr}`}>
                    <span>Position</span>
                    <span className="text-right">Value</span>
                  </div>
                  {holdings.map((h) => (
                    <div
                      key={h.id}
                      className={`grid grid-cols-[2fr_1fr] items-center py-2.5 ${ROW_DIVIDER}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-bold">{h.name}</div>
                        <div className="text-[12px] text-faint">
                          {/* The listed product it maps to, when it maps to
                              one. A holding read from a statement that matched
                              nothing in the catalogue keeps its own name rather
                              than borrowing a product's. */}
                          {h.instrument_name ?? 'Not matched to a listed product'}
                          {h.return_label ? ` · ${h.return_label}` : ''}
                        </div>
                      </div>
                      <div className="text-right font-mono text-[13.5px] font-bold">
                        {fmtMinor(h.value_minor, h.currency as ConsoleCurrency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* The documents behind the declarations. A desk deciding whether
                to accept someone needs what they can look at, not only what
                the person ticked — and when there is nothing, the section says
                so instead of leaving the reviewer to wonder where to look. */}
            <section className="mt-6">
              <b className="font-display text-[15px]">KYC documents</b>
              {(detail.documents ?? []).length === 0 ? (
                <p className="mt-1.5 text-[13px] text-faint">
                  None uploaded. Their KYC package carries declarations only — if your review needs
                  documents, ask them to add them under Finish onboarding.
                </p>
              ) : (
                <div className="mt-2">
                  {(detail.documents ?? []).map((d) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-2.5 py-2.5 ${ROW_DIVIDER} last:border-b-0`}
                    >
                      <FileText className="h-4 w-4 flex-none text-faint" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-bold">{d.label}</div>
                        <div className="text-[12px] text-faint">
                          {DOC_STEP_LABEL[d.step] ?? d.step} · {timeAgo(d.createdAt)}
                        </div>
                      </div>
                      {/* A plain download link: the session cookie rides on the
                          navigation, and the API serves attachment-disposition. */}
                      <a
                        href={clientDocumentUrl(client.account_id, d.id)}
                        download
                        className="text-[13px] font-bold text-teal2 underline-offset-4 hover:underline"
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Funding settles between the client and this firm, off-platform.
                This is the firm's confirmation that it landed — the one write
                that moves the client's cash balance here. Active clients only:
                money cannot settle into a relationship that does not exist. */}
            {client.status === 'active' ? (
              <section className="mt-6">
                <b className="font-display text-[15px]">Record settled funds</b>
                <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
                  When money this client sent you has settled — a wire, a branch deposit — record it
                  here. Their cash balance with your firm updates at once, on their portfolio too.
                  CCN never holds or moves the money.
                </p>
                <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submitFunds}>
                  <label className="flex w-[130px] flex-col gap-1 text-[12.5px] font-semibold">
                    Amount
                    <input
                      value={fundsAmt}
                      onChange={(e) => setFundsAmt(e.target.value)}
                      inputMode="decimal"
                      placeholder="10,000"
                      disabled={fundsBusy}
                      className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-right font-mono text-[14px] font-bold text-foreground"
                    />
                  </label>
                  <label className="flex w-[92px] flex-col gap-1 text-[12.5px] font-semibold">
                    Currency
                    <select
                      value={fundsCurrency}
                      onChange={(e) => setFundsCurrency(e.target.value as ConsoleCurrency)}
                      disabled={fundsBusy}
                      className="block h-[38px] w-full rounded-[10px] border border-solid border-border bg-card px-2 text-[13.5px] font-semibold text-foreground"
                    >
                      {FUNDS_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[12.5px] font-semibold">
                    Your reference (optional)
                    <input
                      value={fundsRef}
                      onChange={(e) => setFundsRef(e.target.value)}
                      placeholder="Wire id, receipt no."
                      disabled={fundsBusy}
                      className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={fundsBusy}>
                    {fundsBusy ? 'Recording…' : 'Confirm settled'}
                  </Button>
                </form>
                {fundsError ? <ErrorNote message={fundsError} className="mt-2" /> : null}
                {fundsNote ? (
                  <output className="mt-2 block text-[12.5px] text-success-ink">{fundsNote}</output>
                ) : null}
              </section>
            ) : null}

            <section className="mt-6">
              <b className="font-display text-[15px]">Orders they placed with you</b>
              {orders.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-faint">
                  None yet. Orders this client approves in your products appear here and in the
                  order flow.
                </p>
              ) : (
                <div className="mt-2">
                  {orders.map((o) => (
                    <div
                      key={o.id}
                      className={`grid grid-cols-[2fr_1fr_0.9fr] items-center py-2.5 ${ROW_DIVIDER}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px]">{o.instrumentName ?? 'Order'}</div>
                        <div className="text-[12px] text-faint">{timeAgo(o.createdAt)}</div>
                      </div>
                      <div className="text-right font-mono text-[13px]">
                        {fmtMinor(o.amountMinor, o.currency)}
                      </div>
                      <div className="text-right text-[12.5px] capitalize text-dim">{o.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6">
              <b className="font-display text-[15px]">Their record with you</b>
              <p className="mt-1 text-[12.5px] text-faint">
                From the append-only log. These rows cannot be edited or deleted, by your firm or by
                CCN.
              </p>
              {audit.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-faint">Nothing audited yet.</p>
              ) : (
                <div className="mt-2">
                  {audit.map((a) => {
                    const why = auditReason(a.detail);
                    const entity = auditEntityLabel(a.entityType);
                    return (
                      <div key={a.id} className={`py-2.5 ${ROW_DIVIDER} last:border-b-0`}>
                        <div className="text-[13.5px]">{auditActionLabel(a.action)}</div>
                        <div className="text-[12px] text-faint">
                          {/* By name: "accepted, by whom" is one fact. */}
                          <span className="font-semibold text-dim">{auditActorLine(a)}</span>
                          {entity ? ` · ${entity}` : ''} · {timeAgo(a.createdAt)}
                        </div>
                        {why ? <div className="text-[12px] italic text-dim">{why}</div> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}

        {/* The relationship control. Present for a decided client only: a
            pending one is accepted or declined on the row behind this dialog,
            and putting the same decision in two places invites them to differ. */}
        {client.status === 'active' || client.status === 'declined' ? (
          <section className="mt-6 border-0 border-t border-solid border-border pt-4">
            <b className="font-display text-[15px]">
              {client.status === 'active' ? 'End this relationship' : 'Reinstate this client'}
            </b>
            {client.status === 'active' ? (
              <p className="mt-1 flex items-start gap-2 text-[12.5px] leading-relaxed text-faint">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
                CCN stops reading their positions from you and they can place no new orders in your
                products. Nothing already read is deleted — it is their money, and their portfolio
                goes on showing it. You can reinstate them later.
              </p>
            ) : (
              <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
                {client.decline_reason
                  ? `Declined: ${client.decline_reason}`
                  : 'This client was declined.'}{' '}
                Reinstating them restores the connection and CCN resumes reading their positions.
              </p>
            )}

            {client.status === 'active' && revoking ? (
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  onReview(client.account_id, false, reason.trim() || undefined);
                  setRevoking(false);
                  setReason('');
                }}
              >
                <label className="min-w-[220px] flex-1 text-[13px]">
                  <span className="sr-only">
                    Why {client.client_name}’s access is being revoked
                  </span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? The client is told this"
                    className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                  />
                </label>
                <Button type="submit" size="sm" variant="ghost" className={TERRA_GHOST_BTN}>
                  Revoke access
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRevoking(false);
                    setReason('');
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="mt-3">
                {client.status === 'active' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={TERRA_GHOST_BTN}
                    disabled={busy}
                    onClick={() => setRevoking(true)}
                  >
                    {busy ? 'Working…' : 'Revoke access'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || client.kyc_tier === 'none'}
                    onClick={() => onReview(client.account_id, true)}
                  >
                    {busy ? 'Working…' : 'Reinstate as client'}
                  </Button>
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
