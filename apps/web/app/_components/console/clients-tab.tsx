'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleFunnelStage, ConsoleReconciliationItem } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRightLeft, Users } from 'lucide-react';
import {
  ROW_DIVIDER,
  TERRA_GHOST_BTN,
  TERRA_TEXT,
  fmtMinor,
  guessParsedHolding,
  isSandbox,
  timeAgo,
} from './lib';
import { ErrorNote } from './notice';
import { SandboxBadge } from './sandbox-badge';

/** Decorative bar fills; the count is printed beside every bar in text. */
const FUNNEL_COLORS = ['#6b6459', '#7fb5ad', '#17786e', '#124e48'];

export function ClientsTab({
  partner,
  funnel,
  funnelError,
  reconciliation,
  reconciliationError,
  reconBusyId,
  reconActionError,
  onMatch,
  onRejectItem,
}: {
  partner: MePartner | null;
  funnel: ConsoleFunnelStage[];
  funnelError: string | null;
  reconciliation: ConsoleReconciliationItem[];
  reconciliationError: string | null;
  reconBusyId: string | null;
  reconActionError: string | null;
  onMatch: (id: string) => void;
  onRejectItem: (id: string) => void;
}) {
  return (
    <>
      <div className="g-held">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <b className="font-display text-lg">Onboarding pipeline</b>
              <div className="mb-[18px] mt-1 text-[13px] text-faint">
                Agent-referred clients, last 90 days
              </div>
            </div>
            {isSandbox(partner) && funnel.length > 0 ? <SandboxBadge /> : null}
          </div>

          {funnelError ? <ErrorNote message={funnelError} /> : null}

          {!funnelError && funnel.length === 0 ? (
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

        {/* Explainer copy about how CCN treats KYC — CCN's own policy, which is
            checkable against the product, not a partner metric. The three
            figures that used to sit under it ("2,760 verifications reused",
            "0 re-verifications", "~6 days / client saved") had no source
            anywhere in the schema and are gone rather than approximated. */}
        <Card className="border-solid border-border bg-[#f4f0e7] p-6 dark:bg-white/[0.04]">
          <b className="font-display text-[17px]">KYC stays yours</b>
          <p className="mt-2.5 text-sm leading-normal text-dim">
            You already verified these clients. CCN links that status with their consent rather than
            re-collecting it, so a referral becomes a funded account instead of an abandoned form.
            You remain the regulated owner of KYC and AML.
          </p>
        </Card>
      </div>

      <Card className="mt-[18px] p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <b className="font-display text-lg">Pending reconciliation</b>
          {reconciliation.length > 0 ? (
            <span className={`text-sm font-bold ${TERRA_TEXT}`}>
              {reconciliation.length} to review
            </span>
          ) : null}
        </div>
        <div className="mb-4 text-[13px] text-faint">
          Statement lines ingested from partner records, awaiting a match to a client holding.
        </div>

        {reconciliationError ? <ErrorNote message={reconciliationError} className="mb-3" /> : null}
        {reconActionError ? <ErrorNote message={reconActionError} className="mb-3" /> : null}

        {!reconciliationError && reconciliation.length === 0 ? (
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
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className={TERRA_GHOST_BTN}
                  disabled={busy}
                  onClick={() => onRejectItem(item.id)}
                >
                  Reject
                </Button>
                <Button size="sm" disabled={busy} onClick={() => onMatch(item.id)}>
                  {busy ? 'Matching…' : 'Match'}
                </Button>
              </div>
            </div>
          );
        })}
      </Card>
    </>
  );
}
