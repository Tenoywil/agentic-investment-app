'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
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
import { Input } from '@/app/_components/ui/input';
import { cn } from '@/app/_lib/utils';
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
import { Check, CircleAlert, ShieldCheck, Target } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

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
  regulator: string;
  name: string;
  region: string;
  metricLabel: string;
  metric: string;
  min: string;
  minMinor: string;
  currency: Currency;
  term: string;
  risk: string;
  desc: string;
  agentNote: string;
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
    min: formatMinor(item.minInvestmentMinor, item.currency),
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

const FILTERS: (Kind | 'All')[] = ['All', 'Bond', 'Fund', 'Equity', 'Real Estate', 'Private'];
const minMajor = (o: Opp) => minorToMajor(o.minMinor);

const METRIC_BOX = 'rounded-xl bg-[#f4f0e7] px-[15px] py-[13px] dark:bg-white/[0.04]';
const METRIC_LBL =
  'mb-[5px] text-[11.5px] uppercase tracking-[.4px] text-[#6d6455] dark:text-faint';

function OppCard({ o, onOpen }: { o: Opp; onOpen: (o: Opp) => void }) {
  const t = TONE[o.type];
  return (
    <Card className="flex flex-col p-[22px]" style={{ borderLeft: `4px solid ${t.ink}` }}>
      <div className="mb-1.5 flex items-center gap-3">
        <span
          className="grid h-10 w-10 flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
          style={{ background: t.tint, color: t.ink }}
        >
          {o.abbr}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[12.5px] font-bold uppercase tracking-[.6px]"
            style={{ color: t.ink }}
          >
            {o.type}
          </span>
          <Badge variant={RISK_VARIANT[o.risk]}>{o.risk} risk</Badge>
        </div>
      </div>
      <div className="mb-1 text-[13px] text-faint">{o.region}</div>
      <div className="mb-3.5 font-display text-lg font-bold leading-tight">{o.name}</div>
      <div className="mb-3.5 grid grid-cols-2 gap-[11px]">
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>{o.metricLabel}</div>
          <div className="font-mono text-lg font-bold text-success">{o.metric}</div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Minimum</div>
          <div className="font-mono text-lg font-bold text-foreground">{o.min}</div>
        </div>
      </div>
      <div className="mb-4 flex items-center gap-2 text-[13px] text-dim">
        <span aria-hidden className="h-4 w-4 flex-none rounded-full border-[1.6px] border-teal2" />
        {o.partner} · {o.regulator}
      </div>
      <Button className="mt-auto w-full" onClick={() => onOpen(o)}>
        Review &amp; invest
      </Button>
    </Card>
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
  note: string;
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

function ExecDialog({ opp, onClose }: { opp: Opp | null; onClose: () => void }) {
  const titleId = useId();
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
      setAmt(String(Math.round(minMajor(opp))));
      setPlacing(false);
      setPlaceError(null);
      setOrder(null);
      setGateBlocked(null);
    }
  }, [opp]);

  if (!opp) return null;
  const t = TONE[opp.type];
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
      setPlaceError(
        err instanceof OpportunitiesApiError || err instanceof Error
          ? err.message
          : 'Could not route this order. Try again.',
      );
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
        <DialogHeader className="flex-row items-start gap-3 border-b border-[#ece6da] p-[22px] pr-14">
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
              {opp.region} · executed by {opp.partner}
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
                Executed by {opp.partner} · Regulated by {opp.regulator}
              </div>
            </>
          )}

          {!gateBlocked && step === 0 && (
            <>
              <div className="mb-[18px] grid grid-cols-2 gap-[11px]">
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>{opp.metricLabel}</div>
                  <div className="font-mono text-[21px] font-bold text-success">{opp.metric}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Minimum</div>
                  <div className="font-mono text-[21px] font-bold text-foreground">{opp.min}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Term</div>
                  <div className="text-base font-bold">{opp.term}</div>
                </div>
                <div className={METRIC_BOX}>
                  <div className={METRIC_LBL}>Risk rating</div>
                  <div className="text-base font-bold">{opp.risk}</div>
                </div>
              </div>
              <p className="mb-4 text-[15px] leading-relaxed text-dim">{opp.desc}</p>

              {blocked ? (
                <ScreenedOutNotice
                  heading="Your agent recommends against this"
                  note={opp.agentNote}
                  reasons={opp.blockReasons}
                  footer="The agent will not route this order. If your goals or limits change, re-run suitability from your profile and it will reassess."
                />
              ) : (
                <div className="mb-4 rounded-xl border border-[#cde0d8] dark:border-white/10 bg-mint px-4 py-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Target className="h-[15px] w-[15px] text-teal2" aria-hidden />
                    <span className="text-[13.5px] font-bold text-teal2">Agent assessment</span>
                  </div>
                  <p className="text-sm leading-snug text-[#2c2925] dark:text-foreground">
                    {opp.agentNote}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 text-[13.5px] text-dim">
                <ShieldCheck className="h-3.5 w-3.5 flex-none text-success" aria-hidden />
                Executed by {opp.partner} · Regulated by {opp.regulator}
              </div>
            </>
          )}

          {!gateBlocked && step === 1 && !blocked && (
            <>
              <div className="mb-2.5 text-[12.5px] font-bold uppercase tracking-[.5px] text-teal2">
                Review &amp; authorize
              </div>
              <div className="mb-3.5 overflow-hidden rounded-xl border border-border">
                <div className="flex justify-between border-b border-[#ece6da] px-4 py-3.5">
                  <span className="text-sm text-dim">Instrument</span>
                  <span className="max-w-[60%] text-right text-sm font-semibold">{opp.name}</span>
                </div>
                <div className="flex items-start justify-between border-b border-[#ece6da] px-4 py-3.5">
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
                      Minimum {opp.min} · from your {opp.currency} wallet
                    </span>
                  </div>
                </div>
                <div className="flex justify-between border-b border-[#ece6da] px-4 py-3.5">
                  <span className="text-sm text-dim">Executing partner</span>
                  <span className="text-sm font-semibold">{opp.partner}</span>
                </div>
                <div className="flex justify-between px-4 py-3.5">
                  <span className="text-sm text-dim">Settlement</span>
                  <span className="text-sm font-semibold">T+2 · {opp.currency} wallet</span>
                </div>
              </div>
              <div className="rounded-xl border border-[#cde0d8] dark:border-white/10 bg-mint px-4 py-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldCheck className="h-[15px] w-[15px] text-success" aria-hidden />
                  <span className="text-[13.5px] font-bold text-teal2">
                    Agent ran your compliance checks
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {[
                    'Identity verified (KYC · Tier 2)',
                    'Suitability: matches your balanced-income profile',
                    'Source of funds confirmed',
                  ].map((line) => (
                    <div
                      key={line}
                      className="flex items-center gap-2 text-sm text-[#2c2925] dark:text-foreground"
                    >
                      <Check className="h-4 w-4 flex-none text-success" aria-hidden />
                      {line}
                    </div>
                  ))}
                </div>
              </div>
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
                {opp.partner}, who executes, custodies and settles it (T+2). CCN never holds your
                money. Projections are estimates, not guarantees.
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
              <Button size="lg" className="flex-1" onClick={() => setStep(1)}>
                Continue to authorize
              </Button>
            ) : step === 1 ? (
              <Button
                size="lg"
                className="flex-1"
                disabled={amtNum < minMajor(opp) || placing}
                onClick={handleAuthorize}
              >
                {placing ? 'Routing…' : `Authorize & route ${amtFmt}`}
              </Button>
            ) : (
              <Button size="lg" className="flex-1" onClick={onClose}>
                Done
              </Button>
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
  const [filter, setFilter] = useState<Kind | 'All'>('All');
  const [selected, setSelected] = useState<Opp | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOpportunities()
      .then(({ opportunities }) => {
        if (cancelled) return;
        setOpportunities(opportunities);
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

  const opps = opportunities.map(toOpp);
  const TRADEABLE = opps.filter((o) => !o.blocked);
  const BLOCKED = opps.find((o) => o.blocked) ?? null;
  const shown = filter === 'All' ? TRADEABLE : TRADEABLE.filter((o) => o.type === filter);
  const count = (f: Kind | 'All') =>
    f === 'All' ? TRADEABLE.length : TRADEABLE.filter((o) => o.type === f).length;

  return (
    <AppScreen active="opportunities">
      <PageHead
        eyebrow="Regional investments across jurisdictions · executed by licensed partners"
        title="Opportunities"
        right={
          status === 'ready' ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-mint px-[15px] py-[9px]">
              <b className="font-display text-xl">{TRADEABLE.length}</b>
              <span className="text-[12.5px] leading-tight text-dim">
                matched to
                <br />
                your goals
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

          <div className="g2">
            {shown.map((o) => (
              <OppCard key={o.id} o={o} onOpen={setSelected} />
            ))}
          </div>

          {/* What your agent screens out — the guardrail the product is built around.
              Hidden entirely when nothing in the live catalog is currently flagged. */}
          {BLOCKED && (
            <>
              <h2 className="mb-1.5 mt-[30px] font-display text-xl font-bold">
                What your agent screens out
              </h2>
              <p className="mb-3.5 text-sm text-dim">
                Listed so you can see exactly what fails your suitability profile, and why.
              </p>
              <Card
                className="flex flex-wrap items-start gap-4 border-[#ecd2c2] dark:border-[#5a3f2e] p-[22px]"
                style={{ borderLeft: '4px solid #c56a3e' }}
              >
                <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-[#f2e7de] font-mono text-xs font-bold text-[#7d4f36]">
                  {BLOCKED.abbr}
                </span>
                <div className="min-w-[240px] flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-bold uppercase tracking-[.6px] text-[#7d4f36]">
                      {BLOCKED.type}
                    </span>
                    <Badge variant="terra">Screened out</Badge>
                  </div>
                  <div className="mb-1 text-[13px] text-faint">{BLOCKED.region}</div>
                  <div className="mb-2 font-display text-lg font-bold leading-tight">
                    {BLOCKED.name}
                  </div>
                  <p className="text-sm leading-snug text-dim">{BLOCKED.agentNote}</p>
                </div>
                <Button
                  className="flex-none bg-terra text-white hover:bg-terra/90"
                  onClick={() => setSelected(BLOCKED)}
                >
                  Why the agent flags this
                </Button>
              </Card>
            </>
          )}

          <ExecDialog opp={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </AppScreen>
  );
}
