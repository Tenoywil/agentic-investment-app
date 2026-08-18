'use client';

import * as React from 'react';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type {
  ConsoleClient,
  ConsoleFunnelStage,
  ConsoleReconciliationItem,
  ConsoleWithdrawal,
} from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRightLeft, Banknote, Users } from 'lucide-react';
import { ClientReview } from './client-review';
import {
  ROW_DIVIDER,
  SUCCESS_TEXT,
  TERRA_GHOST_BTN,
  TERRA_TEXT,
  fmtMinor,
  fmtMinorExact,
  guessParsedHolding,
  isSandbox,
  timeAgo,
} from './lib';
import { RowsSkeleton } from './loading';
import { ErrorNote } from './notice';
import { SandboxBadge } from './sandbox-badge';

/** Decorative bar fills; the count is printed beside every bar in text. */
const FUNNEL_COLORS = ['#6b6459', '#7fb5ad', '#17786e', '#124e48'];

export function ClientsTab({
  partner,
  clients,
  clientsError,
  loading,
  total,
  clientBusyId,
  clientActionError,
  onReviewClient,
  onRequestKyc,
  onOpenClient,
  funnel,
  funnelError,
  reconciliation,
  reconciliationError,
  reconBusyId,
  reconActionError,
  onMatch,
  onRejectItem,
  onPull,
  pulling,
  pullNote,
  withdrawals,
  withdrawalsError,
  withdrawalBusyId,
  withdrawalActionError,
  onDecideWithdrawal,
}: {
  partner: MePartner | null;
  clients: ConsoleClient[];
  clientsError: string | null;
  loading: boolean;
  /**
   * How many clients match, which is not how many are on screen. The list is
   * bounded now; saying so is the difference between a short list and a wrong
   * one.
   */
  total: number;
  clientBusyId: string | null;
  clientActionError: string | null;
  onReviewClient: (id: string, accept: boolean, reason?: string) => void;
  onRequestKyc: (id: string) => void;
  onOpenClient: (client: ConsoleClient) => void;
  funnel: ConsoleFunnelStage[];
  funnelError: string | null;
  reconciliation: ConsoleReconciliationItem[];
  reconciliationError: string | null;
  reconBusyId: string | null;
  reconActionError: string | null;
  onMatch: (id: string) => void;
  onRejectItem: (id: string, reason?: string) => void;
  /** Pull statements for every active client, filling the queue below. */
  onPull: () => void;
  pulling: boolean;
  pullNote: string | null;
  withdrawals: ConsoleWithdrawal[];
  withdrawalsError: string | null;
  withdrawalBusyId: string | null;
  withdrawalActionError: string | null;
  onDecideWithdrawal: (
    id: string,
    input: { paid: true; reference?: string } | { paid: false; reason: string },
  ) => void;
}) {
  /**
   * Which reconciliation line is being asked about. `reconcile_reject` records
   * the reason in the audit trail, and the API has always accepted one — it was
   * dropped at the call site, so every rejected statement line was audited as
   * "rejected at reconciliation" whatever the operator's actual reason was.
   */
  const [reconRejecting, setReconRejecting] = React.useState<string | null>(null);
  const [reconReason, setReconReason] = React.useState('');

  /**
   * Which withdrawal is being decided, and which way. Paying asks for an
   * optional payment reference; declining requires the words the client will
   * read. One text field serves both, cleared whenever the form closes.
   */
  const [wdDeciding, setWdDeciding] = React.useState<{ id: string; paid: boolean } | null>(null);
  const [wdText, setWdText] = React.useState('');
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const decidedWithdrawals = withdrawals.filter((w) => w.status !== 'pending').slice(0, 5);

  return (
    <>
      {/* The decision the firm actually makes, above the counts describing it. */}
      {/*
        The list is bounded at a page now. Before it was every client the firm
        had ever been referred, unbounded and re-fetched on every realtime
        event — but a truncated list that does not say it is truncated is worse
        than a long one, so it says.
      */}
      {!loading && total > clients.length ? (
        <p className="mb-2 text-[12.5px] text-faint">
          Showing {clients.length} of {total} clients.
        </p>
      ) : null}

      <ClientReview
        clients={clients}
        clientsError={clientsError}
        loading={loading}
        busyId={clientBusyId}
        actionError={clientActionError}
        onReview={onReviewClient}
        onRequestKyc={onRequestKyc}
        onOpen={onOpenClient}
      />

      <div className="g-held">
        <Card className="p-6" data-tour="institution-funnel">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <b className="font-display text-lg">Onboarding pipeline</b>
              {/* No window. The counts are every connection this firm has ever
                  been sent, and "last 90 days" described a date filter that no
                  query applied — a caption quietly narrowing numbers it did not
                  narrow. */}
              <div className="mb-[18px] mt-1 text-[13px] text-faint">
                Everyone CCN has referred to you, and where they stopped
              </div>
            </div>
            {isSandbox(partner) && funnel.length > 0 ? <SandboxBadge /> : null}
          </div>

          {funnelError ? <ErrorNote message={funnelError} /> : null}

          {loading && !funnelError ? (
            <RowsSkeleton rows={3} label="Loading the onboarding pipeline" />
          ) : null}

          {!loading && !funnelError && funnel.every((k) => k.count === 0) ? (
            <EmptyState
              icon={Users}
              title="No referrals yet"
              body="Invited, KYC started, verified and funded counts appear here once CCN starts referring clients into your onboarding."
            />
          ) : null}

          <div className="flex flex-col gap-[15px]">
            {funnel.map((k, i) => (
              <div key={k.id}>
                <div className="mb-1.5 flex justify-between">
                  <span className="text-[14.5px] font-medium text-dim">{k.label}</span>
                  <span className="font-mono text-[14.5px] font-bold">
                    {k.count.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="h-[9px] overflow-hidden rounded-md bg-muted">
                  <div
                    className="h-full rounded-md"
                    style={{
                      width: `${k.pct}%`,
                      background: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {/* "KYC stays yours" used to sit beside the funnel — CCN policy prose on
          a working tab. It now lives with the rest of the standing terms on the
          Compliance tab. */}

      <Card className="mt-[18px] p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <b className="font-display text-lg">Pending reconciliation</b>
          <div className="flex items-center gap-3">
            {reconciliation.length > 0 ? (
              <span className={`text-sm font-bold ${TERRA_TEXT}`}>
                {reconciliation.length} to review
              </span>
            ) : null}
            {/* The desk fills its own queue. This queue could previously only
                be filled by each investor pressing "Check for statements" on
                their own portfolio — but the statements are the firm's records
                and reconciliation is the firm's job. */}
            <Button type="button" size="sm" variant="outline" onClick={onPull} disabled={pulling}>
              {pulling ? 'Pulling…' : 'Pull statements'}
            </Button>
          </div>
        </div>
        {pullNote ? <output className="mb-2 block text-[13px] text-dim">{pullNote}</output> : null}
        <div className="mb-4 text-[13px] text-faint">
          Statement lines ingested from partner records, awaiting a match to a client holding.
        </div>

        {reconciliationError ? <ErrorNote message={reconciliationError} className="mb-3" /> : null}
        {reconActionError ? <ErrorNote message={reconActionError} className="mb-3" /> : null}

        {loading && !reconciliationError ? (
          <RowsSkeleton rows={2} label="Loading reconciliation items" />
        ) : null}

        {!loading && !reconciliationError && reconciliation.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="Nothing to reconcile"
            body="Ingested statement lines queue here for review before they become client holdings."
          />
        ) : null}

        {reconciliation.map((item) => {
          const guess = guessParsedHolding(item.parsed);
          const busy = reconBusyId === item.id;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-3 py-3.5 last:border-b-0 ${ROW_DIVIDER}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-bold">
                  {guess ? guess.name : `Statement line · ${item.source}`}
                </div>
                <div className="text-[12.5px] text-faint">
                  {timeAgo(item.createdAt)}
                  {guess?.returnLabel ? ` · ${guess.returnLabel}` : ''}
                </div>
              </div>
              {guess ? (
                <span className="min-w-[78px] text-right font-mono text-sm font-bold">
                  {fmtMinor(guess.valueMinor, guess.currency)}
                </span>
              ) : null}
              {reconRejecting === item.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Empty sends nothing rather than '', which rejectSchema's
                    // .min(1) refuses; the server writes its own default then.
                    onRejectItem(item.id, reconReason.trim() || undefined);
                    setReconRejecting(null);
                    setReconReason('');
                  }}
                >
                  <label className="min-w-[180px] flex-1 text-[13px]">
                    <span className="sr-only">Why this line is being rejected</span>
                    <input
                      value={reconReason}
                      onChange={(e) => setReconReason(e.target.value)}
                      placeholder="Why? This is audited"
                      className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                    />
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className={TERRA_GHOST_BTN}
                    disabled={busy}
                  >
                    {busy ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setReconRejecting(null);
                      setReconReason('');
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className={TERRA_GHOST_BTN}
                    disabled={busy}
                    onClick={() => setReconRejecting(item.id)}
                  >
                    Reject
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => onMatch(item.id)}>
                    {busy ? 'Matching…' : 'Match'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Money out. The mirror of the reconciliation queue above: clients ask
          for money back on their portfolio screen, the firm pays off-platform
          and records it here — which is when CCN's record of their cash falls —
          or declines with words the client will actually read. */}
      <Card className="mt-[18px] p-6" data-tour="institution-withdrawals">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <b className="font-display text-lg">Withdrawal requests</b>
          {pendingWithdrawals.length > 0 ? (
            <span className={`text-sm font-bold ${TERRA_TEXT}`}>
              {pendingWithdrawals.length} awaiting your decision
            </span>
          ) : null}
        </div>
        <div className="mb-4 text-[13px] text-faint">
          Clients asking for money back. Pay off-platform, then record it here with your payment
          reference — or decline with a reason they can act on.
        </div>

        {withdrawalsError ? <ErrorNote message={withdrawalsError} className="mb-3" /> : null}
        {withdrawalActionError ? (
          <ErrorNote message={withdrawalActionError} className="mb-3" />
        ) : null}

        {loading && !withdrawalsError ? (
          <RowsSkeleton rows={2} label="Loading withdrawal requests" />
        ) : null}

        {!loading && !withdrawalsError && withdrawals.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawal requests"
            body="When a client asks for money back from their portfolio screen, the request queues here for your decision."
          />
        ) : null}

        {pendingWithdrawals.map((w) => {
          const busy = withdrawalBusyId === w.id;
          const deciding = wdDeciding?.id === w.id ? wdDeciding : null;
          return (
            <div
              key={w.id}
              className={`flex flex-wrap items-center gap-3 py-3.5 last:border-b-0 ${ROW_DIVIDER}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-bold">{w.clientName}</div>
                <div className="text-[12.5px] text-faint">Requested {timeAgo(w.createdAt)}</div>
              </div>
              <div className="text-right">
                <span className="block font-mono text-sm font-bold">
                  {fmtMinor(w.amountMinor, w.currency)}
                </span>
                {/* The figures frozen when the client asked. "Pay" is the net
                    the firm actually transfers; fee + GCT stay with the firm. */}
                {Number(w.feeMinor) + Number(w.gctMinor) > 0 ? (
                  <span className="block text-[11.5px] text-faint">
                    fee {fmtMinorExact(w.feeMinor, w.currency)}
                    {Number(w.gctMinor) > 0
                      ? ` · GCT ${fmtMinorExact(w.gctMinor, w.currency)}`
                      : ''}{' '}
                    · pay {fmtMinorExact(w.netMinor, w.currency)}
                  </span>
                ) : null}
              </div>
              {deciding ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = wdText.trim();
                    if (deciding.paid) {
                      onDecideWithdrawal(w.id, { paid: true, reference: text || undefined });
                    } else {
                      // `required` on the input enforces this; the guard is for
                      // whitespace-only entries the attribute lets through.
                      if (!text) return;
                      onDecideWithdrawal(w.id, { paid: false, reason: text });
                    }
                    setWdDeciding(null);
                    setWdText('');
                  }}
                >
                  <label className="min-w-[180px] flex-1 text-[13px]">
                    <span className="sr-only">
                      {deciding.paid
                        ? 'Payment reference (optional)'
                        : 'Why this withdrawal is being declined'}
                    </span>
                    <input
                      value={wdText}
                      onChange={(e) => setWdText(e.target.value)}
                      placeholder={
                        deciding.paid
                          ? 'Payment reference (optional)'
                          : 'Why? The client reads this'
                      }
                      required={!deciding.paid}
                      className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                    />
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    variant={deciding.paid ? 'default' : 'ghost'}
                    className={deciding.paid ? undefined : TERRA_GHOST_BTN}
                    disabled={busy}
                  >
                    {busy ? 'Recording…' : deciding.paid ? 'Record as paid' : 'Decline'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setWdDeciding(null);
                      setWdText('');
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className={TERRA_GHOST_BTN}
                    disabled={busy}
                    onClick={() => {
                      setWdDeciding({ id: w.id, paid: false });
                      setWdText('');
                    }}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setWdDeciding({ id: w.id, paid: true });
                      setWdText('');
                    }}
                  >
                    Pay
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {decidedWithdrawals.length > 0 ? (
          <div className="mt-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-faint">
              Recently decided
            </div>
            {decidedWithdrawals.map((w) => (
              <div
                key={w.id}
                className={`flex flex-wrap items-center gap-3 py-2.5 last:border-b-0 ${ROW_DIVIDER}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]">{w.clientName}</div>
                  <div
                    className={`text-[12.5px] ${w.status === 'paid' ? SUCCESS_TEXT : TERRA_TEXT}`}
                  >
                    {w.status === 'paid'
                      ? `Paid${w.reference ? ` · ref ${w.reference}` : ''}`
                      : `Declined${w.reason ? ` · ${w.reason}` : ''}`}
                    {w.decidedAt ? ` · ${timeAgo(w.decidedAt)}` : ''}
                  </div>
                </div>
                <span className="min-w-[78px] text-right font-mono text-[13px] font-bold text-dim">
                  {fmtMinor(w.amountMinor, w.currency)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </>
  );
}
