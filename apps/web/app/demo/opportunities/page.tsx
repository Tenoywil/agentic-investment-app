'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { DealCard, ScreenedOutCard } from '@/app/_components/DealCard';
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
import { Check, CircleAlert, ShieldCheck, Target } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

/* ---- type palette (warm), ported from the prototype tone() map. The text inks
   are darkened from the prototype's originals so every label and pill clears
   WCAG 1.4.3 (4.5:1) on both the card and its tint. */
type Kind = 'Bond' | 'Fund' | 'Equity' | 'Real Estate' | 'Private';
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
  term: string;
  risk: 'Low' | 'Medium' | 'High';
  desc: string;
  agentNote: string;
  blocked?: boolean;
  blockReasons?: string[];
};

const OPPS: Opp[] = [
  {
    id: 'goj32',
    abbr: 'GOJ',
    type: 'Bond',
    partner: 'NCB Capital Markets',
    regulator: 'FSC Jamaica',
    name: 'Gov’t of Jamaica USD Global Bond 2032',
    region: 'Jamaica · Sovereign',
    metricLabel: 'Coupon',
    metric: '7.875%',
    min: 'US$1,000',
    term: '8 yr · USD',
    risk: 'Low',
    desc: 'A US-dollar sovereign bond issued by the Government of Jamaica, paying a fixed 7.875% semi-annual coupon. Suited to income-focused investors seeking hard-currency Caribbean sovereign exposure.',
    agentNote:
      'Strong fit for your income goal. Adds hard-currency duration and lifts blended yield without changing your risk band.',
  },
  {
    id: 'sagrex',
    abbr: 'REX',
    type: 'Real Estate',
    partner: 'Sagicor Investments',
    regulator: 'FSC Jamaica',
    name: 'Sagicor Real Estate X Fund',
    region: 'Jamaica · Commercial property',
    metricLabel: 'Target return',
    metric: '9.2%',
    min: 'US$5,000',
    term: 'Open-ended',
    risk: 'Medium',
    desc: 'A diversified fund holding income-producing commercial real estate across Kingston and Montego Bay. Distributes quarterly with inflation-linked growth potential.',
    agentNote:
      'Matches your income and growth blend. I’d cap this at 15% of your portfolio to keep real-estate concentration in range.',
  },
  {
    id: 'gkapo',
    abbr: 'GK',
    type: 'Equity',
    partner: 'Barita Investments',
    regulator: 'FSC Jamaica',
    name: 'GraceKennedy Additional Public Offering',
    region: 'Jamaica · Consumer / Financial',
    metricLabel: 'Indicative yield',
    metric: '4.6%',
    min: 'US$500',
    term: 'Equity',
    risk: 'Medium',
    desc: 'An additional public offering of shares in GraceKennedy, one of the Caribbean’s largest consumer and financial conglomerates, funding regional expansion.',
    agentNote:
      'Adds equity growth you’re currently light on. Higher volatility than your bonds, so sizing matters.',
  },
  {
    id: 'provfd',
    abbr: 'PWF',
    type: 'Fund',
    partner: 'PROVEN Wealth',
    regulator: 'FSC Jamaica',
    name: 'Proven USD Fixed Income Fund',
    region: 'Regional · Diversified credit',
    metricLabel: '12-mo yield',
    metric: '6.4%',
    min: 'US$1,000',
    term: 'Open-ended',
    risk: 'Low',
    desc: 'A professionally-managed USD fund investing in a diversified pool of regional corporate and sovereign credit, targeting stable monthly income.',
    agentNote:
      'You already hold this. Topping up would concentrate credit exposure. Consider the GOJ bond instead for diversification.',
  },
  {
    id: 'bgtn29',
    abbr: 'BGB',
    type: 'Bond',
    partner: 'Republic Bank',
    regulator: 'FSC Barbados',
    name: 'Barbados Treasury Note 2029',
    region: 'Barbados · Sovereign',
    metricLabel: 'Coupon',
    metric: '6.25%',
    min: 'US$1,000',
    term: '5 yr',
    risk: 'Low',
    desc: 'A Barbadian government treasury note offering fixed semi-annual interest, providing geographic diversification within your sovereign allocation.',
    agentNote:
      'Good diversifier away from single-country Jamaica exposure. Slightly lower coupon than GOJ.',
  },
  {
    id: 'sygcr',
    abbr: 'SYG',
    type: 'Private',
    partner: 'Sygnus Capital',
    regulator: 'FSC Jamaica',
    name: 'Sygnus Private Credit Note III',
    region: 'Regional · Private credit',
    metricLabel: 'Target return',
    metric: '8.5%',
    min: 'US$10,000',
    term: '3 yr · locked',
    risk: 'High',
    desc: 'A private credit note providing senior secured financing to mid-market Caribbean firms. Higher return for reduced liquidity: capital is locked for the term.',
    agentNote:
      'Unlocked by your source-of-funds verification. Illiquid, and only suitable for capital you won’t need for 3 years.',
  },
  {
    id: 'jmmb',
    abbr: 'JMB',
    type: 'Equity',
    partner: 'JMMB Group',
    regulator: 'FSC Jamaica',
    name: 'JMMB Group Rights Issue',
    region: 'Jamaica · Financial',
    metricLabel: 'Discount',
    metric: '12%',
    min: 'US$500',
    term: 'Equity',
    risk: 'Medium',
    desc: 'A rights issue allowing existing and new shareholders to buy JMMB shares at a discount to market, funding regional banking growth.',
    agentNote:
      'Time-sensitive: the rights window closes in 9 days. Discount is attractive but adds financial-sector concentration.',
  },
  {
    id: 'ncbmm',
    abbr: 'MMF',
    type: 'Fund',
    partner: 'NCB Capital Markets',
    regulator: 'FSC Jamaica',
    name: 'NCB USD Money Market Fund',
    region: 'Jamaica · Cash management',
    metricLabel: 'Current yield',
    metric: '5.1%',
    min: 'US$100',
    term: 'Instant access',
    risk: 'Low',
    desc: 'A liquid USD money-market fund for parking cash while earning yield, with same-day access. A natural home for your idle wallet balance.',
    agentNote:
      'Your US$2,150 cash is earning nothing. Moving it here adds ~US$110/yr with instant access.',
  },
  {
    id: 'slbd',
    abbr: 'BVD',
    type: 'Private',
    partner: 'Sygnus Capital',
    regulator: 'FSC Jamaica',
    name: 'Beachfront Villas Development Note',
    region: 'St. Lucia · Pre-construction real estate',
    metricLabel: 'Target return',
    metric: '14.0%',
    min: 'US$25,000',
    term: '5 yr · illiquid',
    risk: 'High',
    blocked: true,
    desc: 'A private note funding a pre-construction villa development. Returns depend entirely on construction milestones and unit sales. Capital is locked for the full term with no secondary market and no income until exit.',
    agentNote:
      'I recommend against this one for you, and I will not prepare it. It is listed so you can see exactly what I screen out and why.',
    blockReasons: [
      'High risk: your profile is balanced-income; this is a speculative development note',
      'Size: the US$25,000 minimum is 80% of your portfolio, far above your 15% single-position cap',
      'Liquidity: five years locked with no secondary market conflicts with your university-fund timeline',
      'Income: pays nothing until exit, while your stated goal is yield today',
    ],
  },
];

const TRADEABLE = OPPS.filter((o) => !o.blocked);
const BLOCKED = OPPS.filter((o) => o.blocked);
const FILTERS: (Kind | 'All')[] = ['All', 'Bond', 'Fund', 'Equity', 'Real Estate', 'Private'];
const minValue = (o: Opp) => Number.parseInt(o.min.replace(/[^0-9]/g, ''), 10) || 0;

const METRIC_BOX = 'rounded-xl bg-[#f4f0e7] px-[15px] py-[13px] dark:bg-white/[0.04]';
const METRIC_LBL =
  'mb-[5px] text-[11.5px] uppercase tracking-[.4px] text-[#6d6455] dark:text-faint';

/** Same card component as the live marketplace — demo parity by construction. */
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

function ExecDialog({ opp, onClose }: { opp: Opp | null; onClose: () => void }) {
  const titleId = useId();
  const [step, setStep] = useState(0);
  const [amt, setAmt] = useState('');

  // Reset the wizard whenever a new opportunity is opened.
  useEffect(() => {
    if (opp) {
      setStep(0);
      setAmt(String(minValue(opp)));
    }
  }, [opp]);

  if (!opp) return null;
  const t = TONE[opp.type];
  const blocked = !!opp.blocked;
  const amtNum = Number.parseInt(amt.replace(/[^0-9]/g, ''), 10) || 0;
  const amtFmt = `US$${amtNum.toLocaleString('en-US')}`;

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
              {blocked ? 'Screened out' : opp.type}
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
          {step === 0 && (
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
                <div className="mb-4 rounded-xl border border-[#ecd2c2] bg-[#fbeee7] dark:border-[#5a3f2e] dark:bg-[#2c1f17] px-[17px] py-[15px]">
                  <div className="mb-2 flex items-center gap-2">
                    <CircleAlert
                      className="h-4 w-4 flex-none text-[#a44e20] dark:text-terra"
                      aria-hidden
                    />
                    <span className="text-[13px] font-bold uppercase tracking-[.5px] text-[#9a4a1c] dark:text-[#e79b6f]">
                      Your agent recommends against this
                    </span>
                  </div>
                  <p className="mb-2.5 text-sm leading-snug text-[#5c4636] dark:text-[#d3b8a4]">
                    {opp.agentNote}
                  </p>
                  {opp.blockReasons?.map((reason) => (
                    <div
                      key={reason}
                      className="flex gap-2.5 border-t border-[#f0dfd2] dark:border-white/10 py-1.5 text-[13.5px] leading-snug text-[#5c4636] dark:text-[#d3b8a4]"
                    >
                      <span
                        aria-hidden
                        className="flex-none font-bold text-[#a44e20] dark:text-terra"
                      >
                        ×
                      </span>
                      <span>{reason}</span>
                    </div>
                  ))}
                  <div className="mt-2.5 text-[12.5px] leading-snug text-[#8a6a50] dark:text-[#b39a86]">
                    The agent will not route this order. If your goals or limits change, re-run
                    suitability from your profile and it will reassess.
                  </div>
                </div>
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

              {/* Same shape as the live flow: the amount is adjustable on the
                  first screen, before anything reads like a commitment. */}
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
                        US$
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
                Executed by {opp.partner} · Regulated by {opp.regulator}
              </div>
            </>
          )}

          {step === 1 && !blocked && (
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
                        US$
                      </span>
                      <Input
                        id={`${titleId}-amt`}
                        value={amt}
                        onChange={(e) => setAmt(e.target.value)}
                        inputMode="numeric"
                        className="h-10 w-[140px] pl-11 text-right font-mono font-bold"
                      />
                    </div>
                    <span className="text-[12.5px] text-faint">
                      Minimum {opp.min} · from your USD wallet
                    </span>
                  </div>
                </div>
                <div className="flex justify-between border-b border-solid border-x-0 border-t-0 border-[#ece6da] px-4 py-3.5">
                  <span className="text-sm text-dim">Executing partner</span>
                  <span className="text-sm font-semibold">{opp.partner}</span>
                </div>
                <div className="flex justify-between px-4 py-3.5">
                  <span className="text-sm text-dim">Settlement</span>
                  <span className="text-sm font-semibold">T+2 · USD wallet</span>
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
            </>
          )}

          {step === 2 && !blocked && (
            <div className="px-0 pb-1 pt-1.5 text-center">
              <div className="mx-auto mb-4 grid h-[68px] w-[68px] place-items-center rounded-full bg-[#e2f4ea] dark:bg-[#12352a]">
                <Check className="h-8 w-8 text-success" aria-hidden strokeWidth={2.2} />
              </div>
              <div className="font-display text-[21px] font-bold">Instruction submitted</div>
              <p className="mx-auto mb-[18px] mt-2 max-w-[330px] text-[14.5px] leading-snug text-dim">
                CCN routed your {amtFmt} instruction to {opp.partner}, who executes, custodies and
                settles it (T+2). CCN never holds your money. Projections are estimates, not
                guarantees.
              </p>
              <div className="mx-auto max-w-[320px] rounded-xl bg-[#f4f0e7] dark:bg-white/[0.04] px-4 py-3.5 text-left">
                <div className="flex justify-between py-1 text-[13.5px]">
                  <span className="text-dim">Reference</span>
                  <span className="font-mono font-bold">CCN-8F42-QX</span>
                </div>
                <div className="flex justify-between py-1 text-[13.5px]">
                  <span className="text-dim">Status</span>
                  <span className="font-bold text-[#a44e20] dark:text-terra">Processing</span>
                </div>
              </div>
            </div>
          )}

          <div className="mt-[18px] flex gap-2.5">
            {step === 1 && !blocked && (
              <Button variant="outline" size="lg" onClick={() => setStep(0)}>
                Back
              </Button>
            )}
            {blocked ? (
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
                  disabled={amtNum < minValue(opp)}
                  onClick={() => setStep(1)}
                >
                  {amtNum > 0 ? `Continue with ${amtFmt}` : 'Continue to authorize'}
                </Button>
                {amtNum > 0 && amtNum < minValue(opp) && (
                  <p className="text-center text-[12.5px] text-dim">
                    This product's minimum is {opp.min}.
                  </p>
                )}
              </div>
            ) : step === 1 ? (
              <Button
                size="lg"
                className="flex-1"
                disabled={amtNum < minValue(opp)}
                onClick={() => setStep(2)}
              >
                Authorize &amp; route {amtFmt}
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

/** Phone breakpoint for the screened-out disclosure — mirrors the live page. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return phone;
}

export default function OpportunitiesPage() {
  const [filter, setFilter] = useState<Kind | 'All'>('All');
  const [selected, setSelected] = useState<Opp | null>(null);
  const phone = useIsPhone();

  const shown = filter === 'All' ? TRADEABLE : TRADEABLE.filter((o) => o.type === filter);
  const count = (f: Kind | 'All') =>
    f === 'All' ? TRADEABLE.length : TRADEABLE.filter((o) => o.type === f).length;

  /** Same cards whether the section renders open (desktop) or behind the
   *  phone's disclosure — demo parity with the live marketplace. */
  const screenedOutCards = BLOCKED.map((b) => (
    <ScreenedOutCard
      key={b.id}
      o={{
        abbr: b.abbr,
        type: b.type,
        name: b.name,
        region: b.region,
        partner: b.partner,
        regulator: b.regulator,
        note: b.agentNote,
        reasons: b.blockReasons,
      }}
      onOpen={() => setSelected(b)}
    />
  ));

  return (
    <AppScreen active="opportunities" basePath="/demo">
      <PageHead
        eyebrow="Regional investments across jurisdictions · executed by licensed partners"
        title="Opportunities"
        right={
          <div className="flex items-center gap-2 rounded-xl border border-border bg-mint px-[15px] py-[9px]">
            <b className="font-display text-xl">6</b>
            <span className="text-[12.5px] leading-tight text-dim">
              matched to
              <br />
              your goals
            </span>
          </div>
        }
      />

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

      {/* What your agent screens out — the guardrail the product is built
          around. Collapsed behind a disclosure on phones, like the live page. */}
      {phone ? (
        <details className="mt-[30px]">
          <summary className="cursor-pointer list-none rounded-xl border border-solid border-[#ecd2c2] bg-card px-4 py-3 font-display text-[15px] font-bold marker:content-none dark:border-[#5a3f2e] [&::-webkit-details-marker]:hidden">
            What your agent screens out · {BLOCKED.length}
          </summary>
          <p className="mb-3 mt-3 text-sm text-dim">
            Listed so you can see exactly what fails your suitability profile, and why.
          </p>
          <div className="grid grid-cols-1 gap-3">{screenedOutCards}</div>
        </details>
      ) : (
        <>
          <h2 className="mb-1.5 mt-[30px] font-display text-xl font-bold">
            What your agent screens out
          </h2>
          <p className="mb-3.5 text-sm text-dim">
            Listed so you can see exactly what fails your suitability profile, and why.
          </p>
          <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">{screenedOutCards}</div>
        </>
      )}

      <ExecDialog opp={selected} onClose={() => setSelected(null)} />
    </AppScreen>
  );
}
