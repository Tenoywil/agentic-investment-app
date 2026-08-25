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
  PartnerKycReviewInput,
} from '@/lib/console-api';
import { reconciliationReceiptUrl } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRightLeft, Banknote, FileText, Users } from 'lucide-react';
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
import { ConsolePager, RowsSkeleton } from './loading';
import { ErrorNote } from './notice';
import { SandboxBadge } from './sandbox-badge';

/** Decorative bar fills; the count is printed beside every bar in text. */
const FUNNEL_COLORS = ['#6b6459', '#7fb5ad', '#17786e', '#124e48'];

function fundingEvidence(raw: unknown): {
  reference: string | null;
  receipt: { name: string; size: number | null } | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const receiptValue = value.receipt;
  const receipt =
    receiptValue && typeof receiptValue === 'object'
      ? (receiptValue as Record<string, unknown>)
      : null;
  return {
    reference: typeof value.reference === 'string' ? value.reference : null,
    receipt:
      receipt && typeof receipt.name === 'string'
        ? {
            name: receipt.name,
            size: typeof receipt.size === 'number' ? receipt.size : null,
          }
        : null,
  };
}

export function ClientsTab({
  partner,
  clients,
  clientsError,
  clientsLoading,
  clientTotal,
  pendingClientTotal,
  clientOffset,
  clientPageSize,
  clientStatus,
  clientQuery,
  clientBusyId,
  clientActionError,
  onReviewClient,
  onRequestKyc,
  onOpenClient,
  funnel,
  funnelError,
  pipelineLoading,
  reconciliation,
  reconciliationError,
  reconciliationLoading,
  reconciliationTotal,
  reconciliationOffset,
  reconciliationPageSize,
  reconBusyId,
  reconActionError,
  onMatch,
  onRejectItem,
  onPull,
  onClientStatus,
  onClientQuery,
  onClientPage,
  onReconciliationPage,
  pulling,
  pullNote,
  withdrawals,
  withdrawalsError,
  withdrawalsLoading,
  withdrawalTotal,
  pendingWithdrawalTotal,
  withdrawalOffset,
  withdrawalPageSize,
  withdrawalBusyId,
  withdrawalActionError,
  onWithdrawalPage,
  onDecideWithdrawal,
}: {
  partner: MePartner | null;
  clients: ConsoleClient[];
  clientsError: string | null;
  clientsLoading: boolean;
  /**
   * How many clients match, which is not how many are on screen. The list is
   * bounded now; saying so is the difference between a short list and a wrong
   * one.
   */
  clientTotal: number;
  pendingClientTotal: number;
  clientOffset: number;
  clientPageSize: number;
  clientStatus: string;
  clientQuery: string;
  clientBusyId: string | null;
  clientActionError: string | null;
  onReviewClient: (
    id: string,
    accept: boolean,
    reason?: string,
    review?: PartnerKycReviewInput,
  ) => void;
  onRequestKyc: (id: string) => void;
  onOpenClient: (client: ConsoleClient) => void;
  funnel: ConsoleFunnelStage[];
  funnelError: string | null;
  pipelineLoading: boolean;
  reconciliation: ConsoleReconciliationItem[];
  reconciliationError: string | null;
  reconciliationLoading: boolean;
  reconciliationTotal: number;
  reconciliationOffset: number;
  reconciliationPageSize: number;
  reconBusyId: string | null;
  reconActionError: string | null;
  onMatch: (id: string) => void;
  onRejectItem: (id: string, reason?: string) => void;
  /** Pull statements for every active client, filling the queue below. */
  onPull: () => void;
  onClientStatus: (status: string) => void;
  onClientQuery: (query: string) => void;
  onClientPage: (offset: number) => void;
  onReconciliationPage: (offset: number) => void;
  pulling: boolean;
  pullNote: string | null;
  withdrawals: ConsoleWithdrawal[];
  withdrawalsError: string | null;
  withdrawalsLoading: boolean;
  withdrawalTotal: number;
  pendingWithdrawalTotal: number;
  withdrawalOffset: number;
  withdrawalPageSize: number;
  withdrawalBusyId: string | null;
  withdrawalActionError: string | null;
  onWithdrawalPage: (offset: number) => void;
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
      <ClientReview
        clients={clients}
        clientsError={clientsError}
        loading={clientsLoading}
        total={clientTotal}
        pendingTotal={pendingClientTotal}
        offset={clientOffset}
        pageSize={clientPageSize}
        status={clientStatus}
        query={clientQuery}
        busyId={clientBusyId}
        actionError={clientActionError}
        onReview={onReviewClient}
        onRequestKyc={onRequestKyc}
        onOpen={onOpenClient}
        onStatus={onClientStatus}
        onQuery={onClientQuery}
        onPage={onClientPage}
      />

      <div className="g-held">
        <Card className="p-4 sm:p-6" data-tour="institution-funnel">
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

          {pipelineLoading && !funnelError ? (
            <RowsSkeleton rows={3} label="Loading the onboarding pipeline" />
          ) : null}

          {!pipelineLoading && !funnelError && funnel.every((k) => k.count === 0) ? (
            <EmptyState
              icon={Users}
              title="No referrals yet"
              body="Invited, intake completed, reviewed and funded counts appear here once CCN starts referring clients into your onboarding."
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

      <Card className="mt-[18px] p-4 sm:p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <b className="font-display text-lg">Pending reconciliation</b>
          <div className="flex items-center gap-3">
            {reconciliationTotal > 0 ? (
              <span className={`text-sm font-bold ${TERRA_TEXT}`}>
                {reconciliationTotal} to review
              </span>
            ) : null}
            {/* The desk fills its own queue. This queue could previously only
                be filled by each investor pressing "Check for statements" on
                their own portfolio — but the statements are the firm's records
                and reconciliation is the firm's job. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={onPull}
              disabled={pulling}
            >
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

        {reconciliationLoading && !reconciliationError ? (
          <RowsSkeleton rows={2} label="Loading reconciliation items" />
        ) : null}

        {!reconciliationLoading && !reconciliationError && reconciliation.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="Nothing to reconcile"
            body="Ingested statement lines queue here for review before they become client holdings."
          />
        ) : null}

        {!reconciliationLoading &&
          reconciliation.map((item) => {
            const guess = guessParsedHolding(item.parsed);
            const evidence = item.source === 'investor_notice' ? fundingEvidence(item.raw) : null;
            const busy = reconBusyId === item.id;
            return (
              <div
                key={item.id}
                className={`flex flex-col items-stretch gap-3 py-3.5 last:border-b-0 md:flex-row md:items-center ${ROW_DIVIDER}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-bold">
                    {guess ? guess.name : `Statement line · ${item.source}`}
                  </div>
                  <div className="text-[12.5px] text-faint">
                    {timeAgo(item.createdAt)}
                    {guess?.returnLabel ? ` · ${guess.returnLabel}` : ''}
                  </div>
                  {evidence?.reference ? (
                    <div className="mt-1 text-[12.5px] text-dim">
                      Transaction reference: <b>{evidence.reference}</b>
                    </div>
                  ) : null}
                  {evidence?.receipt ? (
                    <a
                      href={reconciliationReceiptUrl(item.id)}
                      className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal2 underline-offset-2 hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      Download {evidence.receipt.name}
                      {evidence.receipt.size != null
                        ? ` (${Math.max(1, Math.round(evidence.receipt.size / 1024))} KB)`
                        : ''}
                    </a>
                  ) : null}
                </div>
                {guess ? (
                  <span className="self-end font-mono text-sm font-bold md:min-w-[78px] md:self-auto md:text-right">
                    {fmtMinor(guess.valueMinor, guess.currency)}
                  </span>
                ) : null}
                {reconRejecting === item.id ? (
                  <form
                    className="grid w-full grid-cols-2 items-center gap-2 md:flex md:w-auto md:flex-wrap"
                    onSubmit={(e) => {
                      e.preventDefault();
                      // Empty sends nothing rather than '', which rejectSchema's
                      // .min(1) refuses; the server writes its own default then.
                      onRejectItem(item.id, reconReason.trim() || undefined);
                      setReconRejecting(null);
                      setReconReason('');
                    }}
                  >
                    <label className="col-span-2 min-w-0 flex-1 text-[13px] md:min-w-[180px]">
                      <span className="sr-only">Why this line is being rejected</span>
                      <input
                        value={reconReason}
                        onChange={(e) => setReconReason(e.target.value)}
                        placeholder="Why? This is audited"
                        className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                      />
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className={`min-h-11 md:min-h-9 ${TERRA_GHOST_BTN}`}
                      disabled={busy}
                    >
                      {busy ? 'Rejecting…' : 'Reject'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 md:min-h-9"
                      onClick={() => {
                        setReconRejecting(null);
                        setReconReason('');
                      }}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      className={`min-h-11 md:min-h-9 ${TERRA_GHOST_BTN}`}
                      disabled={busy}
                      onClick={() => setReconRejecting(item.id)}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="min-h-11 md:min-h-9"
                      disabled={busy}
                      onClick={() => onMatch(item.id)}
                    >
                      {busy ? 'Matching…' : 'Match'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        {!reconciliationLoading && !reconciliationError ? (
          <ConsolePager
            label="Pending reconciliation"
            total={reconciliationTotal}
            offset={reconciliationOffset}
            pageSize={reconciliationPageSize}
            visible={reconciliation.length}
            onPage={onReconciliationPage}
            className="-mx-4 -mb-4 mt-2 sm:-mx-6 sm:-mb-6"
          />
        ) : null}
      </Card>

      {/* Money out. The mirror of the reconciliation queue above: clients ask
          for money back on their portfolio screen, the firm pays off-platform
          and records it here — which is when CCN's record of their cash falls —
          or declines with words the client will actually read. */}
      <Card className="mt-[18px] p-4 sm:p-6" data-tour="institution-withdrawals">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <b className="font-display text-lg">Withdrawal requests</b>
          {pendingWithdrawalTotal > 0 ? (
            <span className={`text-sm font-bold ${TERRA_TEXT}`}>
              {pendingWithdrawalTotal} awaiting your decision
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

        {withdrawalsLoading && !withdrawalsError ? (
          <RowsSkeleton rows={2} label="Loading withdrawal requests" />
        ) : null}

        {!withdrawalsLoading && !withdrawalsError && withdrawals.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawal requests"
            body="When a client asks for money back from their portfolio screen, the request queues here for your decision."
          />
        ) : null}

        {!withdrawalsLoading &&
          pendingWithdrawals.map((w) => {
            const busy = withdrawalBusyId === w.id;
            const deciding = wdDeciding?.id === w.id ? wdDeciding : null;
            return (
              <div
                key={w.id}
                className={`flex flex-col items-stretch gap-3 py-3.5 last:border-b-0 sm:flex-row sm:flex-wrap sm:items-center ${ROW_DIVIDER}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-bold">{w.clientName}</div>
                  <div className="text-[12.5px] text-faint">Requested {timeAgo(w.createdAt)}</div>
                </div>
                <div className="text-left sm:text-right">
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
                    className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap"
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
                    <label className="col-span-2 min-w-0 flex-1 text-[13px] sm:min-w-[180px]">
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
                        className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                      />
                    </label>
                    <Button
                      type="submit"
                      size="sm"
                      variant={deciding.paid ? 'default' : 'ghost'}
                      className={`min-h-11 sm:min-h-9 ${deciding.paid ? '' : TERRA_GHOST_BTN}`}
                      disabled={busy}
                    >
                      {busy ? 'Recording…' : deciding.paid ? 'Record as paid' : 'Decline'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 sm:min-h-9"
                      onClick={() => {
                        setWdDeciding(null);
                        setWdText('');
                      }}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      className={`min-h-11 sm:min-h-9 ${TERRA_GHOST_BTN}`}
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
                      className="min-h-11 sm:min-h-9"
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

        {!withdrawalsLoading && decidedWithdrawals.length > 0 ? (
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
        {!withdrawalsLoading && !withdrawalsError ? (
          <ConsolePager
            label="Withdrawal requests"
            total={withdrawalTotal}
            offset={withdrawalOffset}
            pageSize={withdrawalPageSize}
            visible={withdrawals.length}
            onPage={onWithdrawalPage}
            className="-mx-4 -mb-4 mt-2 sm:-mx-6 sm:-mb-6"
          />
        ) : null}
      </Card>
    </>
  );
}
