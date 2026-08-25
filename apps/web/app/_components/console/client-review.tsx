'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleClient, PartnerKycReviewInput } from '@/lib/console-api';
import { Check, ShieldCheck, UserRoundCheck, X } from 'lucide-react';
import * as React from 'react';
import {
  KYC_REVIEW_DUE_DAYS,
  ROW_DIVIDER,
  TERRA_GHOST_BTN,
  daysSince,
  fmtMinor,
  timeAgo,
} from './lib';
import { ConsolePager, RowsSkeleton } from './loading';
import { ErrorNote } from './notice';

/**
 * Accepting a client.
 *
 * The console's first tab has always been called "Clients & KYC" and has never
 * named a client. An investor could link an account at a firm and the firm was
 * never told: the row went into `connected_accounts`, holdings were pulled, and
 * the institution side of a two-sided network had no way to see, admit or
 * refuse the people arriving on it.
 *
 * What an operator reviews here is the KYC intake package CCN carries across
 * with the client's consent — recorded details and declarations, not a CCN
 * verification result. The firm remains the regulated owner of verification
 * and the final KYC/AML decision. Nothing is read until that decision is made.
 *
 * The four checks are shown as they are, including when they fail. A missing
 * source-of-funds declaration or incomplete identity intake is exactly what an
 * operator is here to notice, so it is drawn in words and a shape as well as a
 * colour — never a green tick standing in for an unread field.
 */

const BAND_LABEL: Record<string, string> = {
  low: 'Conservative',
  low_moderate: 'Moderately conservative',
  high_moderate: 'Balanced',
  low_high: 'Growth',
  high: 'Aggressive',
};

const TIER_LABEL: Record<string, string> = {
  none: 'No intake',
  tier1: 'Identity recorded',
  tier2: 'Intake complete',
};

const SOURCE_LABEL: Record<string, string> = {
  investment: 'Investments',
  salary: 'Salary',
  business: 'Business',
  other: 'Other',
};

/** One KYC check. Both states carry a glyph and a word — colour alone would put
 *  the whole decision behind the reader's ability to distinguish two hues. */
function Check1({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      {ok ? (
        <Check className="h-3.5 w-3.5 flex-none text-success-ink" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 flex-none text-[#a44e20] dark:text-terra" aria-hidden />
      )}
      <span className={ok ? 'text-dim' : 'text-[#a44e20] dark:text-terra'}>
        {label}
        <span className="sr-only">{ok ? ': confirmed' : ': not confirmed'}</span>
      </span>
    </span>
  );
}

function StatusChip({ status }: { status: ConsoleClient['status'] }) {
  const style =
    status === 'active'
      ? 'bg-mint text-success-ink'
      : status === 'declined'
        ? 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra'
        : 'bg-muted text-dim';
  const label =
    status === 'active' ? 'Client' : status === 'declined' ? 'Declined' : 'Awaiting you';
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px] ${style}`}
    >
      {label}
    </span>
  );
}

const REVIEW_CONTROLS = [
  ['identityVerified', 'Government ID verified'],
  ['addressVerified', 'Proof of address verified independently'],
  ['sanctionsClear', 'Sanctions screening clear'],
  ['pepReviewComplete', 'PEP screening and EDD completed'],
  ['fundsVerified', 'Source of funds and wealth verified'],
  ['taxDocumentationComplete', 'Tax residency and FATCA documents complete'],
] as const;

function KycApprovalForm({
  client,
  busy,
  onCancel,
  onSubmit,
}: {
  client: ConsoleClient;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (review: PartnerKycReviewInput) => void;
}) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [risk, setRisk] = React.useState<'low' | 'medium' | 'high'>('medium');
  const [policy, setPolicy] = React.useState<PartnerKycReviewInput['policyKey'] | ''>('');
  const [seniorApproval, setSeniorApproval] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [nextReview, setNextReview] = React.useState(() => {
    const date = new Date();
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });
  const complete = REVIEW_CONTROLS.every(([key]) => checked[key]) && policy !== '';
  const needsSenior = client.is_pep || risk === 'high';

  return (
    <form
      className="mt-3 rounded-xl border border-solid border-border bg-muted/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || (needsSenior && !seniorApproval)) return;
        onSubmit({
          identityVerified: true,
          addressVerified: true,
          sanctionsClear: true,
          pepReviewComplete: true,
          fundsVerified: true,
          taxDocumentationComplete: true,
          amlRiskRating: risk,
          seniorApproval,
          policyKey: policy,
          nextReviewAt: new Date(`${nextReview}T23:59:59.000Z`).toISOString(),
          notes: notes.trim() || undefined,
        });
      }}
    >
      <b className="font-display text-[14px]">Licensed-firm KYC/AML decision</b>
      <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-faint">
        Attest only after reviewing the client&rsquo;s evidence. CCN records your decision; it does
        not perform verification for you.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {REVIEW_CONTROLS.map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={checked[key] ?? false}
              onChange={(event) =>
                setChecked((value) => ({ ...value, [key]: event.target.checked }))
              }
              className="mt-0.5 h-4 w-4"
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-[12.5px] font-semibold">
          Governing policy
          <select
            value={policy}
            onChange={(event) => setPolicy(event.target.value as typeof policy)}
            className="mt-1 block min-h-11 w-full rounded-[9px] border border-solid border-border bg-card px-2 text-[13px]"
          >
            <option value="">Select</option>
            <option value="JM">Jamaica</option>
            <option value="GY">Guyana</option>
            <option value="TT">Trinidad &amp; Tobago</option>
            <option value="US-NY">United States · New York</option>
            <option value="US-FL">United States · Florida</option>
            <option value="BB" disabled>
              Barbados · future
            </option>
            <option value="GB" disabled>
              United Kingdom · future
            </option>
            <option value="CA" disabled>
              Canada · future
            </option>
          </select>
        </label>
        <label className="text-[12.5px] font-semibold">
          AML risk
          <select
            value={risk}
            onChange={(event) => setRisk(event.target.value as typeof risk)}
            className="mt-1 block min-h-11 w-full rounded-[9px] border border-solid border-border bg-card px-2 text-[13px]"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="text-[12.5px] font-semibold">
          Next review
          <input
            type="date"
            value={nextReview}
            onChange={(event) => setNextReview(event.target.value)}
            className="mt-1 block min-h-11 w-full rounded-[9px] border border-solid border-border bg-card px-2 text-[13px]"
          />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={seniorApproval}
          onChange={(event) => setSeniorApproval(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Senior management approval recorded{needsSenior ? ' (required for this review)' : ''}
        </span>
      </label>
      <label className="mt-3 block text-[12.5px] font-semibold">
        Review notes (optional)
        <input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="mt-1 block min-h-11 w-full rounded-[9px] border border-solid border-border bg-card px-3 text-[13px]"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={busy || !complete || (needsSenior && !seniorApproval)}
        >
          {busy
            ? 'Recording…'
            : client.status === 'declined'
              ? 'Approve & reinstate'
              : 'Approve & accept'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ClientReview({
  clients,
  clientsError,
  loading,
  total,
  pendingTotal,
  offset,
  pageSize,
  status,
  query,
  busyId,
  actionError,
  onReview,
  onRequestKyc,
  onOpen,
  onStatus,
  onQuery,
  onPage,
}: {
  clients: ConsoleClient[];
  clientsError: string | null;
  loading: boolean;
  total: number;
  pendingTotal: number;
  offset: number;
  pageSize: number;
  status: string;
  query: string;
  busyId: string | null;
  actionError: string | null;
  onReview: (id: string, accept: boolean, reason?: string, review?: PartnerKycReviewInput) => void;
  /** Ask this person to finish their intake (0032) — the desk's third verb. */
  onRequestKyc: (id: string) => void;
  /** Open the drill-down: positions, orders, and the record with this firm. */
  onOpen: (client: ConsoleClient) => void;
  onStatus: (status: string) => void;
  onQuery: (query: string) => void;
  onPage: (offset: number) => void;
}) {
  const pending = clients.filter((c) => c.status === 'pending');
  const decided = clients.filter((c) => c.status !== 'pending');
  const [declining, setDeclining] = React.useState<string | null>(null);
  const [accepting, setAccepting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');

  function row(c: ConsoleClient) {
    const busy = busyId === c.account_id;
    const awaiting = c.status === 'pending';
    const noPackage = c.kyc_tier === 'none';
    // The third verb: a package with anything unticked can be asked for.
    // Re-asking is rate-limited server-side; the button says when it was used.
    const kycIncomplete =
      !c.identity_verified || !c.compliance_confirmed || !c.risk_completed || !c.funds_confirmed;
    const askedRecently =
      c.kyc_requested_at != null && daysSince(c.kyc_requested_at) < 1 ? c.kyc_requested_at : null;
    const askButton =
      kycIncomplete && (awaiting || c.status === 'active') ? (
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 w-full sm:min-h-9 sm:w-auto"
          disabled={busy || askedRecently !== null}
          onClick={() => onRequestKyc(c.account_id)}
        >
          {askedRecently ? `Asked ${timeAgo(askedRecently)}` : 'Ask to finish intake'}
        </Button>
      ) : null;
    return (
      <div key={c.account_id} className={`py-4 last:border-b-0 ${ROW_DIVIDER}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <b className="text-[15px]">{c.client_name}</b>
              <StatusChip status={c.status} />
            </div>
            <div className="truncate text-[12.5px] text-faint">
              {c.client_email}
              {c.residency_country ? ` · ${c.residency_country}` : ''} · asked{' '}
              {timeAgo(c.requested_at)}
            </div>
            {/* Periodic re-review, from the date the firm actually decided.
                An annual KYC refresh is the cadence a regulated book runs on,
                and a cue computed from reviewed_at is a fact, not a nag. */}
            {c.status === 'active' &&
            c.reviewed_at &&
            daysSince(c.reviewed_at) >= KYC_REVIEW_DUE_DAYS ? (
              <div className="text-[12.5px] font-bold text-[#a44e20] dark:text-terra">
                Periodic KYC review due — accepted {daysSince(c.reviewed_at)} days ago
              </div>
            ) : null}
          </div>
          <div className="flex w-full items-start justify-between gap-2 sm:w-auto sm:justify-start">
            <div className="text-right">
              <div className="font-mono text-[13.5px] font-bold">{TIER_LABEL[c.kyc_tier]}</div>
              {c.risk_band ? (
                <div className="text-[12px] text-faint">
                  {BAND_LABEL[c.risk_band] ?? c.risk_band}
                </div>
              ) : null}
            </div>
            {/* The drill-down. The row can say "4 positions · US$12,400"; only
                this can say what they are. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => onOpen(c)}
              aria-label={`Open ${c.client_name}`}
            >
              Open
            </Button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Check1 ok={c.identity_verified} label="Identity" />
          <Check1 ok={c.compliance_confirmed} label="Compliance" />
          <Check1 ok={c.risk_completed} label="Suitability" />
          <Check1 ok={c.funds_confirmed} label="Source of funds" />
          {c.is_pep ? (
            <span className="rounded-full bg-[#f7e9e2] px-2 py-0.5 text-[11.5px] font-bold text-[#a44e20] dark:bg-terra/15 dark:text-terra">
              Politically exposed
            </span>
          ) : null}
        </div>

        {c.sources.length > 0 ? (
          <div className="mt-1.5 text-[12.5px] text-faint">
            Funds from{' '}
            {c.sources
              .map((s) => SOURCE_LABEL[s] ?? s)
              .join(', ')
              .toLowerCase()}
            {c.tax_residency_declared ? ' · tax residency declared' : ''}
          </div>
        ) : null}

        {c.status === 'active' ? (
          <div className="mt-1.5 text-[12.5px] text-faint">
            {c.holdings_count === 0
              ? 'No positions read yet.'
              : `${c.holdings_count} position${c.holdings_count === 1 ? '' : 's'} · ${fmtMinor(c.holdings_value_minor, 'USD')} read into CCN`}
          </div>
        ) : null}

        {c.status === 'declined' && c.decline_reason ? (
          <div className="mt-1.5 text-[12.5px] text-faint">Declined: {c.decline_reason}</div>
        ) : null}

        {awaiting && noPackage ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-[#a44e20] dark:text-terra">
            This person has not finished onboarding, so CCN has no complete KYC intake package to
            pass you yet. There is nothing here to accept.
          </p>
        ) : null}

        {accepting === c.account_id ? (
          <KycApprovalForm
            client={c}
            busy={busy}
            onCancel={() => setAccepting(null)}
            onSubmit={(review) => {
              onReview(c.account_id, true, undefined, review);
              setAccepting(null);
            }}
          />
        ) : awaiting ? (
          declining === c.account_id ? (
            <form
              className="mt-3 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                onReview(c.account_id, false, reason.trim() || undefined);
                setDeclining(null);
                setReason('');
              }}
            >
              <label className="col-span-2 min-w-0 flex-1 text-[13px] sm:min-w-[220px]">
                <span className="sr-only">Why {c.client_name} is being declined</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? The client is told this"
                  className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                />
              </label>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className={`min-h-11 sm:min-h-9 ${TERRA_GHOST_BTN}`}
              >
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 sm:min-h-9"
                onClick={() => {
                  setDeclining(null);
                  setReason('');
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                size="sm"
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                disabled={busy || noPackage}
                onClick={() => setAccepting(c.account_id)}
              >
                Review &amp; accept
              </Button>
              {askButton}
              <Button
                size="sm"
                variant="ghost"
                className={`min-h-11 w-full sm:min-h-9 sm:w-auto ${TERRA_GHOST_BTN}`}
                disabled={busy}
                onClick={() => setDeclining(c.account_id)}
              >
                Decline
              </Button>
            </div>
          )
        ) : c.status === 'declined' ? (
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy || noPackage}
              onClick={() => setAccepting(c.account_id)}
            >
              Review &amp; reinstate
            </Button>
          </div>
        ) : askButton ? (
          <div className="mt-3">{askButton}</div>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="mb-[18px] p-4 sm:p-6" data-tour="institution-clients">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <b className="font-display text-lg">Clients from CCN</b>
        {pendingTotal > 0 ? (
          <span className="text-sm font-bold text-[#a44e20] dark:text-terra">
            {pendingTotal} awaiting your decision
          </span>
        ) : null}
      </div>
      <div className="mb-4 flex items-start gap-2 text-[13px] text-faint">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-teal2" aria-hidden />
        <span>
          Someone linking an account shares their recorded intake package with your firm. You own
          verification and the final KYC/AML decision; nothing is read from you until you accept.
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="min-w-[180px] flex-1 text-[13px]">
          <span className="sr-only">Search clients by name or email</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search name or email"
            className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          />
        </label>
        <label className="min-w-[150px] flex-1 text-[13px] sm:min-w-0 sm:flex-none">
          <span className="sr-only">Filter clients by relationship status</span>
          <select
            value={status}
            onChange={(event) => onStatus(event.target.value)}
            className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          >
            <option value="">All clients</option>
            <option value="pending">Awaiting review</option>
            <option value="active">Accepted</option>
            <option value="declined">Declined</option>
          </select>
        </label>
      </div>

      {clientsError ? <ErrorNote message={clientsError} className="mb-3" /> : null}
      {actionError ? <ErrorNote message={actionError} className="mb-3" /> : null}

      {loading && !clientsError ? <RowsSkeleton rows={2} label="Loading client requests" /> : null}

      {!loading && !clientsError && clients.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title={query || status ? 'No clients match' : 'Nobody has asked yet'}
          body={
            query || status
              ? 'Try a different name, email, or relationship status.'
              : 'When a CCN client links an account at your firm, their consented intake package appears here for your review.'
          }
        />
      ) : null}

      {!loading ? pending.map(row) : null}
      {!loading && decided.length > 0 ? (
        <div className="mt-2">
          {pending.length > 0 ? (
            <div className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-[.6px] text-faint">
              Already decided
            </div>
          ) : null}
          {decided.map(row)}
        </div>
      ) : null}
      {!loading && !clientsError ? (
        <ConsolePager
          label="Clients from CCN"
          total={total}
          offset={offset}
          pageSize={pageSize}
          visible={clients.length}
          onPage={onPage}
          className="-mx-4 -mb-4 mt-2 sm:-mx-6 sm:-mb-6"
        />
      ) : null}
    </Card>
  );
}
