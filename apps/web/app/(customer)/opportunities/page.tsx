'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { DealCard } from '@/app/_components/DealCard';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { EmptyState } from '@/app/_components/ui/empty';
import { Input } from '@/app/_components/ui/input';
import { useMe } from '@/app/_lib/session';
import { cn } from '@/app/_lib/utils';
import type { MeOnboarding } from '@/lib/me-api';
import {
  type Currency,
  type Kind,
  OpportunitiesApiError,
  type OpportunityListItem,
  type Order,
  type OrderStatus,
  currencySymbol,
  formatMinor,
  getOpportunities,
  majorToMinor,
  minorToMajor,
  orderReference,
  placeOrder,
  regulatorLabel,
  typeLabel,
} from '@/lib/opportunities-api';
import { Check, CircleAlert, Compass, ShieldCheck, Target, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

/* ---- type palette (warm), ported from the prototype tone() map. The text inks
   are darkened from the prototype's originals so every label and pill clears
   WCAG 1.4.3 (4.5:1) on both the card and its tint. */
const TONE: Record<Kind, { ink: string; tint: string }> = {
  Bond: { ink: '#1a5c54', tint: '#e2f1ee' },
  Fund: { ink: '#0a6e44', tint: '#e2f4ea' },
  Equity: { ink: '#a44e20', tint: '#f5e7d9' },
  'Real Estate': { ink: '#7a5712', tint: '#f6efdf' },
  Private: { ink: '#7d4f36', tint: '#f2e7de' },
};
const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  Low: 'success',
  Medium: 'warning',
  High: 'terra',
};
const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  created: 'Processing',
  accepted: 'Accepted',
  settled: 'Settled',
  rejected: 'Rejected',
  expired: 'Expired',
};
const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  created: 'text-[#a44e20] dark:text-terra',
  accepted: 'text-[#a44e20] dark:text-terra',
  settled: 'text-success',
  rejected: 'text-[#a44e20] dark:text-terra',
  expired: 'text-[#a44e20] dark:text-terra',
};

/** Display-ready projection of an API opportunity — the field names the
 *  marketplace grid and exec dialog were already written against. */
type Opp = {
  id: string;
  abbr: string;
  type: Kind;
  partner: string;
  /** Null when the listing firm's record names no regulator. */
  regulator: string | null;
  name: string;
  /** Null on a product listed without one. */
  region: string | null;
  /** Null together with `metric` — not every product has a headline figure. */
  metricLabel: string | null;
  metric: string | null;
  min: string;
  minMinor: string;
  currency: Currency;
  term: string | null;
  risk: string;
  desc: string | null;
  /** Only the seeded catalogue carries an agent note. */
  agentNote: string | null;
  blocked: boolean;
  blockReasons: string[];
};

function toOpp(item: OpportunityListItem): Opp {
  return {
    id: item.id,
    abbr: item.abbr,
    type: typeLabel(item.type),
    partner: item.partner ?? 'Partner pending',
    regulator: regulatorLabel(item.regulator),
    name: item.name,
    region: item.region,
    metricLabel: item.metricLabel,
    metric: item.metric,
    /**
     * "No minimum", not "US$0".
     *
     * The column defaults to zero and the console form allows it, so a product
     * listed without one used to advertise a minimum investment of nothing —
     * which reads as a price rather than as the absence of a floor.
     */
    min:
      item.minInvestmentMinor === '0'
        ? 'No minimum'
        : formatMinor(item.minInvestmentMinor, item.currency),
    minMinor: item.minInvestmentMinor,
    currency: item.currency,
    term: item.term,
    risk: item.risk ?? 'Not rated',
    desc: item.description,
    agentNote: item.agentNote,
    blocked: item.blocked,
    blockReasons: item.blockReasons,
  };
}

/**
 * Discovery: plain asset classes first, plus one curated collection. "Steady
 * income" is a shortcut over real fields (the low-risk end of the catalogue),
 * not a claim the data does not carry — curated lists are how novices actually
 * browse (Robinhood's lists, Schwab's predefined screens); raw filters are the
 * expert tool.
 */
type Filter = Kind | 'All' | 'Steady income';
const FILTERS: Filter[] = [
  'All',
  'Steady income',
  'Bond',
  'Fund',
  'Equity',
  'Real Estate',
  'Private',
];
const minMajor = (o: Opp) => minorToMajor(o.minMinor);

const METRIC_BOX = 'rounded-xl bg-[#f4f0e7] px-[15px] py-[13px] dark:bg-white/[0.04]';
const METRIC_LBL =
  'mb-[5px] text-[11.5px] uppercase tracking-[.4px] text-[#6d6455] dark:text-faint';

/** The card itself is shared with the demo (app/_components/DealCard.tsx), so
 *  the live marketplace and the preview cannot drift apart. */
function OppCard({ o, onOpen }: { o: Opp; onOpen: (o: Opp) => void }) {
  return (
    <DealCard
      o={{
        id: o.id,
        abbr: o.abbr,
        type: o.type,
        name: o.name,
        region: o.region,
        metricLabel: o.metricLabel,
        metric: o.metric,
        min: o.min,
        term: o.term,
        partner: o.partner,
        regulator: o.regulator,
        risk: o.risk,
      }}
      onOpen={() => onOpen(o)}
    />
  );
}

/** The "screened out" reasons panel — shared by a pre-flagged instrument
 *  (step 0) and a live limits-engine block raised while authorizing
 *  (step 1). Same visual treatment, different heading/note/reasons. */
function ScreenedOutNotice({
  heading,
  note,
  reasons,
  footer,
}: {
  heading: string;
  /** The agent's own words. Absent on a partner-listed product, which the
   *  seeded catalogue's notes do not cover. */
  note: string | null;
  reasons: string[];
  footer: string;
}) {
  return (
    <div className="mb-4 rounded-xl border border-[#ecd2c2] bg-[#fbeee7] dark:border-[#5a3f2e] dark:bg-[#2c1f17] px-[17px] py-[15px]">
      <div className="mb-2 flex items-center gap-2">
        <CircleAlert className="h-4 w-4 flex-none text-[#a44e20] dark:text-terra" aria-hidden />
        <span className="text-[13px] font-bold uppercase tracking-[.5px] text-[#9a4a1c] dark:text-[#e79b6f]">
          {heading}
        </span>
      </div>
      <p className="mb-2.5 text-sm leading-snug text-[#5c4636] dark:text-[#d3b8a4]">{note}</p>
      {reasons.map((reason) => (
        <div
          key={reason}
          className="flex gap-2.5 border-t border-[#f0dfd2] dark:border-white/10 py-1.5 text-[13.5px] leading-snug text-[#5c4636] dark:text-[#d3b8a4]"
        >
          <span aria-hidden className="flex-none font-bold text-[#a44e20] dark:text-terra">
            ×
          </span>
          <span>{reason}</span>
        </div>
      ))}
      <div className="mt-2.5 text-[12.5px] leading-snug text-[#8a6a50] dark:text-[#b39a86]">
        {footer}
      </div>
    </div>
  );
}

/**
 * Labels for the `risk_band` enum the onboarding fact-find assigns, worded from
 * the policy table in @ccn/domain (BAND_MAX_RISK): the two "moderate" bands
 * admit medium-risk instruments, the top two admit high.
 */
const BAND_LABEL: Record<string, string> = {
  low: 'Low',
  low_moderate: 'Low to moderate',
  high_moderate: 'Moderate',
  low_high: 'Moderate to high',
  high: 'High',
};

const TIER_LABEL: Record<string, string> = { tier1: 'Tier 1', tier2: 'Tier 2' };

/**
 * The compliance checks, from GET /api/me.
 *
 * This panel used to assert three green ticks — identity verified at Tier 2,
 * suitability matched, source of funds confirmed — for every viewer, including
 * one who had completed none of them, immediately above the button that routes
 * real money to a licensed partner. Each line now reports the actual state of
 * that step, and an unsatisfied step blocks the instruction here rather than at
 * the partner.
 */
function ComplianceChecks({ onboarding, band }: { onboarding: MeOnboarding; band: string | null }) {
  const bandLabel = band ? (BAND_LABEL[band] ?? band) : null;
  const tierLabel = TIER_LABEL[onboarding.tier];
  const checks: { ok: boolean; label: string }[] = [
    {
      ok: onboarding.identityVerified,
      label: onboarding.identityVerified
        ? `Identity verified${tierLabel ? ` · KYC ${tierLabel}` : ''}`
        : 'Identity not verified yet',
    },
    {
      ok: onboarding.complianceConfirmed,
      label: onboarding.complianceConfirmed
        ? 'Compliance declarations signed'
        : 'Compliance declarations outstanding',
    },
    {
      ok: onboarding.riskCompleted,
      label: onboarding.riskCompleted
        ? `Suitability profile set${bandLabel ? ` · ${bandLabel} risk band` : ''}`
        : 'Suitability profile not completed',
    },
    {
      ok: onboarding.fundsConfirmed,
      label: onboarding.fundsConfirmed
        ? 'Source of funds confirmed'
        : 'Source of funds not declared',
    },
  ];

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3.5',
        onboarding.complete
          ? 'border-[#cde0d8] bg-mint dark:border-white/10'
          : 'border-[#ecd2c2] bg-[#fbeee7] dark:border-[#5a3f2e] dark:bg-[#2c1f17]',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {onboarding.complete ? (
          <ShieldCheck className="h-[15px] w-[15px] flex-none text-success" aria-hidden />
        ) : (
          <CircleAlert
            className="h-[15px] w-[15px] flex-none text-[#a44e20] dark:text-terra"
            aria-hidden
          />
        )}
        <span
          className={cn(
            'text-[13.5px] font-bold',
            onboarding.complete ? 'text-teal2' : 'text-[#9a4a1c] dark:text-[#e79b6f]',
          )}
        >
          {onboarding.complete
            ? 'Your compliance checks are complete'
            : 'Finish your compliance checks to invest'}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {checks.map((c) => (
          <li
            key={c.label}
            className={cn(
              'flex items-center gap-2 text-sm',
              c.ok ? 'text-[#2c2925] dark:text-foreground' : 'text-[#5c4636] dark:text-[#d3b8a4]',
            )}
          >
            {c.ok ? (
              <Check className="h-4 w-4 flex-none text-success" aria-hidden />
            ) : (
              <X className="h-4 w-4 flex-none text-[#a44e20] dark:text-terra" aria-hidden />
            )}
            {c.label}
          </li>
        ))}
      </ul>
      {!onboarding.complete && (
        <Link
          href="/onboarding"
          className="mt-3 inline-block text-sm font-bold text-teal2 underline-offset-4 hover:underline"
        >
          Finish onboarding →
        </Link>
      )}
    </div>
  );
}

function ExecDialog({
  opp,
  band,
  onClose,
  onWithdrawn,
}: {
  opp: Opp | null;
  band: string | null;
  onClose: () => void;
  /** Re-read the catalogue: the firm withdrew this product mid-session. */
  onWithdrawn: () => void;
}) {
  const titleId = useId();
  const me = useMe();
  const [step, setStep] = useState(0);
  const [amt, setAmt] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [gateBlocked, setGateBlocked] = useState<{ code?: string; reasons: string[] } | null>(null);

  // Reset the wizard whenever a new opportunity is opened.
  useEffect(() => {
    if (opp) {
      setStep(0);
      // Pre-filled with the minimum, which is the smallest thing they can
      // legitimately do. A product with no minimum starts empty rather than at
      // zero: zero is not an amount somebody meant to invest, and pre-filling
      // it put "Authorize & route US$0" in front of them as a live control.
      setAmt(minMajor(opp) > 0 ? String(Math.round(minMajor(opp))) : '');
      setPlacing(false);
      setPlaceError(null);
      setOrder(null);
      setGateBlocked(null);
    }
  }, [opp]);

  if (!opp) return null;
  const t = TONE[opp.type];
  // Only a caller whose KYC, compliance, suitability and source-of-funds steps
  // are all satisfied may route an instruction from here.
  const compliant = me?.onboarding.complete === true;
  const blocked = !!opp.blocked;
  const screenedOut = blocked || !!gateBlocked;
  const amtNum = Number.parseInt(amt.replace(/[^0-9]/g, ''), 10) || 0;
  const amtFmt = `${currencySymbol(opp.currency)}${amtNum.toLocaleString('en-US')}`;

  async function handleAuthorize() {
    if (!opp) return;
    setPlaceError(null);
    setPlacing(true);
    try {
      const result = await placeOrder({
        instrumentId: opp.id,
        amountMinor: majorToMinor(amtNum),
        currency: opp.currency,
      });
      if (result.decision === 'blocked') {
        setGateBlocked({ code: result.code, reasons: result.reasons });
      } else {
        setOrder(result.order);
        setStep(2);
      }
    } catch (err) {
      /**
       * The firm withdrew this product while the card was open.
       *
       * The order path refuses a paused instrument — correctly, since a stale
       * page still holds the id — but the refusal read as a malfunction,
       * because the screen went on showing the product as available. Saying
       * what happened and re-reading the catalogue behind the dialog is the
       * difference between a bug and an event.
       */
      const withdrawn = err instanceof OpportunitiesApiError && err.status === 409;
      setPlaceError(
        withdrawn
          ? `${opp.partner} has taken this product off the marketplace. Nothing was routed and nothing was charged.`
          : err instanceof OpportunitiesApiError || err instanceof Error
            ? err.message
            : 'Could not route this order. Try again.',
      );
      if (withdrawn) onWithdrawn();
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Dialog
      open={!!opp}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="gap-0 p-0 font-sans text-foreground">
        <DialogHeader className="flex-row items-start gap-3 border-b border-solid border-x-0 border-t-0 border-[#ece6da] p-[22px] pr-14">
          <span
            className="grid h-11 w-11 flex-none place-items-center rounded-xl font-mono text-sm font-bold"
            style={{ background: t.tint, color: t.ink }}
          >
            {opp.abbr}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold uppercase tracking-[.4px] text-[#6d6455]">
              {screenedOut ? 'Screened out' : opp.type}
            </div>
            <DialogTitle id={titleId} className="mt-1 text-lg">
              {opp.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {opp.region ? `${opp.region} · ` : ''}executed by {opp.partner}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="p-[22px]">
          {gateBlocked && (
            <>
              <ScreenedOutNotice
                heading="Your agent stopped this order"
                note={`This ${amtFmt} instruction exceeds your investment limits, so the agent did not route it.`}
                reasons={gateBlocked.reasons}
                footer="Adjust the amount or revisit your limits, then try again."
              />
              <div className="flex items-center gap-2 text-[13.5px] text-dim">
                <ShieldCheck className="h-3.5 w-3.5 flex-none text-success" aria-hidden />
                Executed by {opp.partner}
                {opp.regulator ? ` · Regulated by ${opp.regulator}` : ''}
              </div>
            </>
          )}

          {!gateBlocked && step === 0 && (
            <>
              <div className="mb-[18px] grid grid-cols-2 gap-[11px]">
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>{opp.metricLabel ?? 'Headline'}</div>
                  <div className="font-mono text-[21px] font-bold text-success">{opp.metric}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Minimum</div>
                  <div className="font-mono text-[21px] font-bold text-foreground">{opp.min}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Term</div>
                  <div className="text-base font-bold">{opp.term ?? 'Not stated'}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Risk rating</div>
                  <div className="text-base font-bold">{opp.risk}</div>
                </div>
              </div>
              {opp.desc ? (
                <p className="mb-4 text-[15px] leading-relaxed text-dim">{opp.desc}</p>
              ) : null}

              {blocked ? (
                <ScreenedOutNotice
                  heading="Your agent recommends against this"
                  note={opp.agentNote}
                  reasons={opp.blockReasons}
                  footer="The agent will not route this order. If your goals or limits change, re-run suitability from your profile and it will reassess."
                />
              ) : opp.agentNote ? (
                // Only when the agent has actually said something. A
                // partner-listed product carries no note, and an empty
                // "Agent assessment" panel asserts a judgement nobody made.
                <div className="mb-4 rounded-xl border border-[#cde0d8] dark:border-white/10 bg-mint px-4 py-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Target className="h-[15px] w-[15px] text-teal2" aria-hidden />
                    <span className="text-[13.5px] font-bold text-teal2">Agent assessment</span>
                  </div>
                  <p className="text-sm leading-snug text-[#2c2925] dark:text-foreground">
                    {opp.agentNote}
                  </p>
                </div>
              ) : null}

              {/* The amount lives here, on the first screen, not hidden behind
                  "Continue". Opening the card and seeing no way to say how much
                  read as "you cannot choose" — the one thing an order dialog
                  must never imply. */}
              {!blocked && (
                <div className="mb-4 flex items-start justify-between rounded-xl border border-border px-4 py-3.5">
                  <label htmlFor={`${titleId}-amt0`} className="pt-2 text-sm font-semibold">
                    Amount to invest
                  </label>
                  <div className="flex flex-col items-end gap-1">
                    <div className="relative">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-dim"
                      >
                        {currencySymbol(opp.currency)}
                      </span>
                      <Input
                        id={`${titleId}-amt0`}
                        value={amt}
                        onChange={(e) => setAmt(e.target.value)}
                        inputMode="numeric"
                        className="h-10 w-[150px] pl-11 text-right font-mono font-bold"
                      />
                    </div>
                    <span className="text-right text-[12.5px] text-faint">
                      Minimum {opp.min} · adjust to any amount above it
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-[13.5px] text-dim">
                <ShieldCheck className="h-3.5 w-3.5 flex-none text-success" aria-hidden />
                Executed by {opp.partner}
                {opp.regulator ? ` · Regulated by ${opp.regulator}` : ''}
              </div>
            </>
          )}

          {!gateBlocked && step === 1 && !blocked && (
            <>
              <div className="mb-2.5 text-[12.5px] font-bold uppercase tracking-[.5px] text-teal2">
                Review &amp; authorize
              </div>
              <div className="mb-3.5 overflow-hidden rounded-xl border border-border">
                <div className="flex justify-between border-b border-solid border-x-0 border-t-0 border-[#ece6da] px-4 py-3.5">
                  <span className="text-sm text-dim">Instrument</span>
                  <span className="max-w-[60%] text-right text-sm font-semibold">{opp.name}</span>
                </div>
                <div className="flex items-start justify-between border-b border-solid border-x-0 border-t-0 border-[#ece6da] px-4 py-3.5">
                  <label htmlFor={`${titleId}-amt`} className="pt-2 text-sm text-dim">
                    Amount
                  </label>
                  <div className="flex flex-col items-end gap-1">
                    <div className="relative">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-dim"
                      >
                        {currencySymbol(opp.currency)}
                      </span>
                      <Input
                        id={`${titleId}-amt`}
                        value={amt}
                        onChange={(e) => setAmt(e.target.value)}
                        inputMode="numeric"
                        disabled={placing}
                        className="h-10 w-[140px] pl-11 text-right font-mono font-bold"
                      />
                    </div>
                    <span className="text-[12.5px] text-faint">
                      {/* There is no wallet. CCN holds no money — cash is a holding
                          in the account you connected at the executing firm, and
                          naming a CCN-held balance contradicted the one line this
                          product cannot afford to be loose about. */}
                      Minimum {opp.min} · from your {opp.currency} cash at {opp.partner}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between border-b border-solid border-x-0 border-t-0 border-[#ece6da] px-4 py-3.5">
                  <span className="text-sm text-dim">Executing partner</span>
                  <span className="text-sm font-semibold">{opp.partner}</span>
                </div>
                <div className="flex justify-between px-4 py-3.5">
                  <span className="text-sm text-dim">Settlement</span>
                  {/* "T+2" was asserted here as though it had been computed. Nothing
                      computes a settlement date at this point: the order is routed,
                      and the firm sets `settlement_eta` when it accepts. The Orders
                      screen shows that date once it is a real one. */}
                  <span className="text-sm font-semibold">Set by {opp.partner} on acceptance</span>
                </div>
              </div>
              {me && <ComplianceChecks onboarding={me.onboarding} band={band} />}
              {placeError && (
                <p className="mt-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {placeError}
                </p>
              )}
            </>
          )}

          {!gateBlocked && step === 2 && !blocked && order && (
            <div className="px-0 pb-1 pt-1.5 text-center">
              <div className="mx-auto mb-4 grid h-[68px] w-[68px] place-items-center rounded-full bg-[#e2f4ea] dark:bg-[#12352a]">
                <Check className="h-8 w-8 text-success" aria-hidden strokeWidth={2.2} />
              </div>
              <div className="font-display text-[21px] font-bold">Instruction submitted</div>
              <p className="mx-auto mb-[18px] mt-2 max-w-[330px] text-[14.5px] leading-snug text-dim">
                CCN routed your {formatMinor(order.amount_minor, order.currency)} instruction to{' '}
                {opp.partner}, who executes, custodies and settles it. They confirm the settlement
                date when they accept it, and you can follow it on your Orders screen. CCN never
                holds your money. Projections are estimates, not guarantees.
              </p>
              <div className="mx-auto max-w-[320px] rounded-xl bg-[#f4f0e7] dark:bg-white/[0.04] px-4 py-3.5 text-left">
                <div className="flex justify-between py-1 text-[13.5px]">
                  <span className="text-dim">Reference</span>
                  <span className="font-mono font-bold">{orderReference(order.id)}</span>
                </div>
                <div className="flex justify-between py-1 text-[13.5px]">
                  <span className="text-dim">Status</span>
                  <span className={cn('font-bold', ORDER_STATUS_CLASS[order.status])}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-[18px] flex gap-2.5">
            {step === 1 && !blocked && !gateBlocked && (
              <Button variant="outline" size="lg" onClick={() => setStep(0)} disabled={placing}>
                Back
              </Button>
            )}
            {screenedOut ? (
              <Button
                size="lg"
                className="flex-1 bg-terra text-white hover:bg-terra/90"
                onClick={onClose}
              >
                Close — understood
              </Button>
            ) : step === 0 ? (
              <div className="flex flex-1 flex-col items-stretch gap-1.5">
                <Button
                  size="lg"
                  className="w-full"
                  disabled={amtNum <= 0 || amtNum < minMajor(opp)}
                  onClick={() => setStep(1)}
                >
                  {amtNum > 0 ? `Continue with ${amtFmt}` : 'Continue to authorize'}
                </Button>
                {amtNum <= 0 ? (
                  <p className="text-center text-[12.5px] text-dim">
                    Enter the amount you want to invest above.
                  </p>
                ) : amtNum < minMajor(opp) ? (
                  <p className="text-center text-[12.5px] text-dim">
                    This product's minimum is {opp.min}.
                  </p>
                ) : null}
              </div>
            ) : step === 1 ? (
              <div className="flex flex-1 flex-col items-stretch gap-1.5">
                <Button
                  size="lg"
                  className="w-full"
                  disabled={amtNum <= 0 || amtNum < minMajor(opp) || placing || !compliant}
                  onClick={handleAuthorize}
                >
                  {placing ? 'Routing…' : `Authorize & route ${amtFmt}`}
                </Button>
                {/* Say why it is disabled. An unexplained dead button is the
                    same defect as a fabricated tick, one step later. */}
                {!compliant && (
                  <p className="text-center text-[12.5px] text-dim">
                    {me
                      ? 'Finish your compliance checks above before routing an instruction.'
                      : 'Checking your compliance status…'}
                  </p>
                )}
              </div>
            ) : (
              <>
                {/*
                  The receipt used to end at "Done", which closed the dialog and
                  left the person exactly where they started, holding a reference
                  number for something they had no route to. Their order now has
                  a life of its own — routed, accepted, settled — and the screen
                  that tells them so is one tap away.
                */}
                <Button variant="outline" size="lg" onClick={onClose}>
                  Done
                </Button>
                <Button size="lg" className="flex-1" asChild>
                  <Link href="/orders">Follow this order</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Status = 'loading' | 'error' | 'ready';

export default function OpportunitiesPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityListItem[]>([]);
  const [band, setBand] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<Opp | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOpportunities()
      .then(({ opportunities, suitabilityBand }) => {
        if (cancelled) return;
        setOpportunities(opportunities);
        setBand(suitabilityBand);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load opportunities.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-read the catalogue without disturbing the reader.
   *
   * Deliberately NOT wired to the realtime stream. A listing event carries a
   * partner id and no user id, and `shouldReceive` delivers an event only to
   * its own user or its own partner — so listing events reach the firm's own
   * desk and never an investor. Subscribing here would have looked like a fix
   * and fired nothing. Making them public would change the fan-out rule for
   * every event, which is a bigger decision than this screen.
   *
   * What is left is the two moments staleness actually bites: coming back to a
   * tab left open, and being refused at the point of investing.
   */
  const refresh = useCallback(() => {
    void getOpportunities()
      .then(({ opportunities, suitabilityBand }) => {
        setOpportunities(opportunities);
        setBand(suitabilityBand);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const opps = opportunities.map(toOpp);
  const TRADEABLE = opps.filter((o) => !o.blocked);
  /**
   * Every screened-out instrument, not the first one.
   *
   * This was `.find()`, and `TRADEABLE` excludes all blocked instruments — so a
   * catalogue with two flagged deals rendered exactly one of them and the other
   * appeared nowhere at all: not in the grid, not in this section, not in any
   * filter count. The one place the product explains what it refuses and why was
   * silently dropping refusals.
   */
  const BLOCKED = opps.filter((o) => o.blocked);
  const matches = (f: Filter) => (o: Opp) =>
    f === 'All' ? true : f === 'Steady income' ? o.risk === 'Low' : o.type === f;
  const shown = TRADEABLE.filter(matches(filter));
  const count = (f: Filter) => TRADEABLE.filter(matches(f)).length;

  return (
    <AppScreen active="opportunities">
      <PageHead
        eyebrow="Regional investments across jurisdictions · executed by licensed partners"
        title="Opportunities"
        // The count is of instruments your agent has not screened out — it was
        // labelled "matched to your goals", which nothing in the catalogue or
        // the API computes.
        right={
          status === 'ready' ? (
            <div className="flex items-center gap-2 rounded-xl border border-solid border-border bg-mint px-[15px] py-[9px]">
              <b className="font-display text-xl">{TRADEABLE.length}</b>
              <span className="text-[12.5px] leading-tight text-dim">
                open to
                <br />
                invest
              </span>
            </div>
          ) : undefined
        }
      />

      {status === 'loading' && <p className="text-sm text-dim">Loading opportunities…</p>}

      {status === 'error' && (
        <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {status === 'ready' && (
        <>
          <div className="mb-5 flex flex-wrap gap-2.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex items-center gap-[7px] rounded-[22px] border px-[17px] py-[9px] text-[14.5px] font-semibold',
                  filter === f
                    ? 'border-primary bg-primary text-white'
                    : 'border-[#ddd6c8] bg-card text-dim',
                )}
              >
                {f}
                <span className="font-mono opacity-60">{count(f)}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={Compass}
              title={
                TRADEABLE.length === 0
                  ? 'No opportunities are open right now'
                  : `Nothing under ${filter} right now`
              }
              body={
                TRADEABLE.length === 0
                  ? 'As partners list instruments across the region, the ones that pass your suitability screen appear here.'
                  : 'Try another asset class, or view everything your agent has not screened out.'
              }
              action={
                TRADEABLE.length === 0 ? undefined : (
                  <Button variant="outline" onClick={() => setFilter('All')}>
                    Show all
                  </Button>
                )
              }
            />
          ) : (
            <div className="g2">
              {shown.map((o) => (
                <OppCard key={o.id} o={o} onOpen={setSelected} />
              ))}
            </div>
          )}

          {/* What your agent screens out — the guardrail the product is built around.
              Hidden entirely when nothing in the live catalog is currently flagged. */}
          {BLOCKED.length > 0 && (
            <>
              <h2 className="mb-1.5 mt-[30px] font-display text-xl font-bold">
                What your agent screens out
              </h2>
              <p className="mb-3.5 text-sm text-dim">
                Listed so you can see exactly what fails your suitability profile, and why.
              </p>
              <div className="flex flex-col gap-3">
                {BLOCKED.map((b) => (
                  <Card
                    key={b.id}
                    className="flex flex-wrap items-start gap-4 border-[#ecd2c2] dark:border-[#5a3f2e] p-[22px]"
                    style={{ borderLeft: '4px solid #c56a3e' }}
                  >
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-[#f2e7de] font-mono text-xs font-bold text-[#7d4f36]">
                      {b.abbr}
                    </span>
                    <div className="min-w-[240px] flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-bold uppercase tracking-[.6px] text-[#7d4f36]">
                          {b.type}
                        </span>
                        <Badge variant="terra">Screened out</Badge>
                      </div>
                      <div className="mb-1 text-[13px] text-faint">{b.region}</div>
                      <div className="mb-2 font-display text-lg font-bold leading-tight">
                        {b.name}
                      </div>
                      <p className="text-sm leading-snug text-dim">{b.agentNote}</p>
                    </div>
                    <Button
                      className="flex-none bg-terra text-white hover:bg-terra/90"
                      onClick={() => setSelected(b)}
                    >
                      Why the agent flags this
                    </Button>
                  </Card>
                ))}
              </div>
            </>
          )}

          <ExecDialog
            opp={selected}
            band={band}
            onClose={() => setSelected(null)}
            onWithdrawn={refresh}
          />
        </>
      )}
    </AppScreen>
  );
}
