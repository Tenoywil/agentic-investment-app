'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleClient } from '@/lib/console-api';
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
import { RowsSkeleton } from './loading';
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
 * What an operator reviews here is the KYC package CCN carries across with the
 * client's consent — CCN records the verified outcome, the firm remains the
 * regulated owner. Nothing is read from the firm until the decision is made.
 *
 * The four checks are shown as they are, including when they fail. A missing
 * source-of-funds declaration or an unverified identity is exactly what an
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
  none: 'No KYC',
  tier1: 'Tier 1',
  tier2: 'Tier 2',
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

export function ClientReview({
  clients,
  clientsError,
  loading,
  busyId,
  actionError,
  onReview,
  onRequestKyc,
  onOpen,
}: {
  clients: ConsoleClient[];
  clientsError: string | null;
  loading: boolean;
  busyId: string | null;
  actionError: string | null;
  onReview: (id: string, accept: boolean, reason?: string) => void;
  /** Ask this person to finish their KYC (0032) — the desk's third verb. */
  onRequestKyc: (id: string) => void;
  /** Open the drill-down: positions, orders, and the record with this firm. */
  onOpen: (client: ConsoleClient) => void;
}) {
  const pending = clients.filter((c) => c.status === 'pending');
  const decided = clients.filter((c) => c.status !== 'pending');
  const [declining, setDeclining] = React.useState<string | null>(null);
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
          disabled={busy || askedRecently !== null}
          onClick={() => onRequestKyc(c.account_id)}
        >
          {askedRecently ? `Asked ${timeAgo(askedRecently)}` : 'Ask to finish KYC'}
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
          <div className="flex items-start gap-2">
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
            This person has not finished onboarding, so CCN has no verified KYC to pass you yet.
            There is nothing here to accept.
          </p>
        ) : null}

        {awaiting ? (
          declining === c.account_id ? (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onReview(c.account_id, false, reason.trim() || undefined);
                setDeclining(null);
                setReason('');
              }}
            >
              <label className="min-w-[220px] flex-1 text-[13px]">
                <span className="sr-only">Why {c.client_name} is being declined</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why? The client is told this"
                  className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                />
              </label>
              <Button type="submit" size="sm" variant="ghost" className={TERRA_GHOST_BTN}>
                Decline
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDeclining(null);
                  setReason('');
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={busy || noPackage}
                onClick={() => onReview(c.account_id, true)}
              >
                {busy ? 'Accepting…' : 'Accept as client'}
              </Button>
              {askButton}
              <Button
                size="sm"
                variant="ghost"
                className={TERRA_GHOST_BTN}
                disabled={busy}
                onClick={() => setDeclining(c.account_id)}
              >
                Decline
              </Button>
            </div>
          )
        ) : askButton ? (
          <div className="mt-3">{askButton}</div>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="mb-[18px] p-6" data-tour="institution-clients">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <b className="font-display text-lg">Clients from CCN</b>
        {pending.length > 0 ? (
          <span className="text-sm font-bold text-[#a44e20] dark:text-terra">
            {pending.length} awaiting your decision
          </span>
        ) : null}
      </div>
      <div className="mb-4 flex items-start gap-2 text-[13px] text-faint">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-teal2" aria-hidden />
        <span>
          Someone linking an account at your firm shares the KYC CCN holds for them. You decide
          whether they become your client; nothing is read from you until you do.
        </span>
      </div>

      {clientsError ? <ErrorNote message={clientsError} className="mb-3" /> : null}
      {actionError ? <ErrorNote message={actionError} className="mb-3" /> : null}

      {loading && !clientsError ? <RowsSkeleton rows={2} label="Loading client requests" /> : null}

      {!loading && !clientsError && clients.length === 0 ? (
        <EmptyState
          icon={UserRoundCheck}
          title="Nobody has asked yet"
          body="When a CCN client links an account at your firm they appear here with the KYC package CCN carries across, for you to accept or decline."
        />
      ) : null}

      {pending.map(row)}
      {decided.length > 0 ? (
        <div className="mt-2">
          {pending.length > 0 ? (
            <div className="mb-1 mt-4 text-[12px] font-bold uppercase tracking-[.6px] text-faint">
              Already decided
            </div>
          ) : null}
          {decided.map(row)}
        </div>
      ) : null}
    </Card>
  );
}
