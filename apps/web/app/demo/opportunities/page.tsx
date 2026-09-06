'use client';

import {
  AppScreen,
  type DemoProfile,
  PageHead,
  demoVillaScreenReasons,
  nextDemoOrderId,
  readDemoAccountState,
  readDemoProfile,
  writeDemoAccountState,
} from '@/app/_components/AppScreen';
import { DealCard, ScreenedOutCard } from '@/app/_components/DealCard';
import type { BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
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
  DEMO_REFERENCE_PROFILE,
  DEMO_OPPORTUNITIES as OPPS,
  type DemoOpportunity as Opp,
  rankDemoRecommendations,
  selectDemoRecommendations,
} from '@/lib/demo-recommendations';
import { Check, CircleAlert, ShieldCheck, Target } from 'lucide-react';
import Link from 'next/link';
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

function FeedbackComparison({
  opportunities,
  profile,
  onInvest,
}: {
  opportunities: Opp[];
  profile: DemoProfile;
  onInvest: (opportunity: Opp) => void;
}) {
  return (
    <section aria-labelledby="feedback-matches" className="mb-8">
      <h2 id="feedback-matches" className="font-display text-2xl font-bold">
        Recommended investments
      </h2>
      <p className="mb-4 mt-2 text-sm text-dim">
        {profile.name} · age {profile.age} · {profile.risk.toLowerCase()} risk appetite ·{' '}
        {profile.objective.toLowerCase()} · {profile.horizon} · target total return{' '}
        {profile.targetReturn}.
      </p>
      <div className="g2">
        {opportunities.map((opportunity) => (
          <div key={opportunity.id} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-dim">{opportunity.region}</p>
            <h3 className="mt-1 font-display text-xl font-bold">{opportunity.name}</h3>
            <p className="mt-3 font-mono text-3xl font-bold text-success">
              {opportunity.match}% <span className="font-sans text-sm">match</span>
            </p>
            <p className="mt-2 text-sm text-dim">{opportunity.agentNote}</p>
            <a
              className="mt-3 inline-block text-sm font-semibold underline"
              href="#investment-comparison"
            >
              Compare side by side
            </a>
          </div>
        ))}
      </div>
      <section
        className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card"
        aria-label="Investment comparison"
        id="investment-comparison"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the comparison horizontally.
        tabIndex={0}
      >
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">
            Compare the two recommended investments for the example client
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="p-4">
                Client profile
              </th>
              {opportunities.map((opportunity) => (
                <th scope="col" className="p-4" key={opportunity.id}>
                  {opportunity.name}
                  <span className="block font-normal text-dim">{opportunity.region}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <th scope="row" className="p-4">
                Target: {profile.targetReturn} over {profile.horizon}
              </th>
              {opportunities.map((opportunity) => (
                <td className="p-4" key={opportunity.id}>
                  {opportunity.metricLabel}: {opportunity.metric} · {opportunity.term}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="p-4">
                Country GDP growth
              </th>
              {opportunities.map((opportunity) => (
                <td className="p-4" key={opportunity.id}>
                  {opportunity.gdpGrowth ?? 'Not supplied'}
                  <span className="block text-xs text-dim">Period unspecified in feedback</span>
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="p-4">
                Minimum investment
              </th>
              {opportunities.map((opportunity) => (
                <td className="p-4" key={opportunity.id}>
                  {opportunity.min}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="p-4">
                Key risk to review
              </th>
              {opportunities.map((opportunity) => (
                <td className="max-w-xs p-4 align-top" key={opportunity.id}>
                  {opportunity.keyRisk ?? opportunity.agentNote}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="p-4">
                Your decision
              </th>
              {opportunities.map((opportunity) => (
                <td className="p-4" key={opportunity.id}>
                  <Button
                    onClick={() => onInvest(opportunity)}
                    aria-label={`Invest in ${opportunity.name}`}
                  >
                    Invest
                  </Button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-xs text-dim">
        Illustrative figures and risk statements supplied in feedback; not verified company
        research. Match scores change with your profile; they are not the probability of a return.
        GDP growth is not an investment return. Investment actions are simulated.
      </p>
      <article className="mt-5 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-terra">Not a match</p>
        <h3 className="mt-1 font-display text-xl font-bold">Lance Ltd APO</h3>
        <p className="mt-2 text-sm text-dim">
          Weak cash flow and debt servicing conflict with the example’s growth objective. High risk
          tolerance alone does not make it a suitable growth investment.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          <li>Audited financial statements signal weak cash flow in the supplied scenario.</li>
          <li>The scenario’s prospectus states that APO proceeds will service debt.</li>
        </ul>
      </article>
    </section>
  );
}

const BLOCKED = OPPS.filter((o) => o.blocked);
const FILTERS: (Kind | 'All')[] = ['All', 'Bond', 'Fund', 'Equity', 'Real Estate', 'Private'];
const minValue = (o: Opp) => Number.parseInt(o.min.replace(/[^0-9]/g, ''), 10) || 0;
const VILLA_SCREEN_CONTEXT = {
  minimumAmount: 'US$25,000',
  portfolioShare: '80%',
  singlePositionCap: '15%',
};

function screenedOutForProfile(opportunity: Opp, profile: DemoProfile): Opp {
  return {
    ...opportunity,
    agentNote:
      'I recommend against this one under the current profile and will not prepare it. The failing constraints below were re-run from the saved fact-find.',
    blockReasons: demoVillaScreenReasons(profile, VILLA_SCREEN_CONTEXT),
  };
}

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
  const formId = useId();
  const [step, setStep] = useState(0);
  const [amt, setAmt] = useState('');
  const [orderReference, setOrderReference] = useState('');

  // Reset the wizard whenever a new opportunity is opened.
  useEffect(() => {
    if (opp) {
      setStep(0);
      setAmt(String(minValue(opp)));
    }
  }, [opp]);

  if (!opp) return null;
  const selectedOpp = opp;
  const t = TONE[opp.type];
  const blocked = !!opp.blocked;
  const amtNum = Number.parseInt(amt.replace(/[^0-9]/g, ''), 10) || 0;
  const amtFmt = `US$${amtNum.toLocaleString('en-US')}`;

  function authorizeOrder() {
    if (blocked || amtNum < minValue(selectedOpp)) return;
    const accountState = readDemoAccountState();
    const orderId = nextDemoOrderId(selectedOpp.id, accountState.opportunityOrders);
    setOrderReference(orderId);
    writeDemoAccountState({
      ...accountState,
      opportunityOrders: [
        ...accountState.opportunityOrders,
        {
          id: orderId,
          name: selectedOpp.name,
          partner: selectedOpp.partner,
          amount: amtFmt,
          status: 'created',
          settlementEta: null,
          rejectedReason: null,
        },
      ],
    });
    setStep(2);
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
              {blocked ? 'Screened out' : opp.type}
            </div>
            <DialogTitle className="mt-1 text-lg">{opp.name}</DialogTitle>
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
                  <label htmlFor={`${formId}-amt0`} className="pt-2 text-sm font-semibold">
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
                        id={`${formId}-amt0`}
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
                Executed by {opp.partner} · Regulatory status: {opp.regulator}
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
                  <label htmlFor={`${formId}-amt`} className="pt-2 text-sm text-dim">
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
                        id={`${formId}-amt`}
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
                    Declarations prepared for partner review
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {[
                    'Identity intake recorded · partner verification required before execution',
                    'Suitability: final assessment remains with the licensed partner',
                    'Source-of-funds declaration recorded',
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
              <div className="font-display text-[21px] font-bold">Simulated instruction saved</div>
              <p className="mx-auto mb-[18px] mt-2 max-w-[330px] text-[14.5px] leading-snug text-dim">
                Your {amtFmt} instruction for {opp.partner} is saved in this demo’s order history.
                No instruction or money was sent. A licensed partner would verify, execute and
                settle a real investment.
              </p>
              <div className="mx-auto max-w-[320px] rounded-xl bg-[#f4f0e7] dark:bg-white/[0.04] px-4 py-3.5 text-left">
                <div className="flex justify-between py-1 text-[13.5px]">
                  <span className="text-dim">Reference</span>
                  <span className="font-mono font-bold">{orderReference}</span>
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
                onClick={authorizeOrder}
              >
                Authorize &amp; route {amtFmt}
              </Button>
            ) : (
              <Button size="lg" className="flex-1" asChild>
                <Link href="/demo/orders">Follow this order</Link>
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
  const [profile, setProfile] = useState<DemoProfile>(DEMO_REFERENCE_PROFILE);
  const phone = useIsPhone();

  useEffect(() => {
    setProfile(readDemoProfile(DEMO_REFERENCE_PROFILE));
  }, []);

  const ranked = rankDemoRecommendations(profile);
  const recommendations = selectDemoRecommendations(profile);
  const screenedOut = BLOCKED.map((opportunity) => screenedOutForProfile(opportunity, profile));
  const recommendationIds = new Set(recommendations.map((opportunity) => opportunity.id));
  const alternatives = ranked.filter((opportunity) => !recommendationIds.has(opportunity.id));
  const shown = filter === 'All' ? alternatives : alternatives.filter((o) => o.type === filter);
  const count = (f: Kind | 'All') =>
    f === 'All' ? alternatives.length : alternatives.filter((o) => o.type === f).length;

  /** Same cards whether the section renders open (desktop) or behind the
   *  phone's disclosure — demo parity with the live marketplace. */
  const screenedOutCards = screenedOut.map((b) => (
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
            <b className="font-display text-xl">{ranked.length}</b>
            <span className="text-[12.5px] leading-tight text-dim">
              open to
              <br />
              invest
            </span>
          </div>
        }
      />

      <div className="mb-5 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold">Your research and matching results</h2>
          <Button asChild variant="outline">
            <Link href="/demo/planning?setup=1&edit=1">Review or edit my profile</Link>
          </Button>
        </div>
        <ol className="mt-4 grid gap-3 p-0 text-sm sm:grid-cols-3">
          <li className="list-none">
            <b>Research</b>
            <p className="mt-1 text-dim">
              Reviewed {ranked.length} sample opportunities and the financial-health exclusion
              below.
            </p>
          </li>
          <li className="list-none">
            <b>Matching</b>
            <p className="mt-1 text-dim">
              Ranked against your {profile.risk.toLowerCase()} risk appetite, {profile.horizon}{' '}
              horizon and {profile.liquidity.toLowerCase()} need.
            </p>
          </li>
          <li className="list-none">
            <b>Compliance</b>
            <p className="mt-1 text-dim">
              Partner verification remains required before any real investment.
            </p>
          </li>
        </ol>
        <Button asChild variant="secondary" className="mt-4">
          <Link href="/demo/agent?compare=1">Talk to your advisor about these matches</Link>
        </Button>
      </div>
      <FeedbackComparison
        opportunities={recommendations}
        profile={profile}
        onInvest={setSelected}
      />
      <h2 className="mb-3 font-display text-xl font-bold">Alternative opportunities</h2>
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

      <div className="g2" data-tour="customer-marketplace">
        {shown.map((o) => (
          <OppCard key={o.id} o={o} onOpen={setSelected} />
        ))}
      </div>

      {/* What your agent screens out — the guardrail the product is built
          around. Collapsed behind a disclosure on phones, like the live page. */}
      {phone ? (
        <details className="mt-[30px]">
          <summary className="cursor-pointer list-none rounded-xl border border-solid border-[#ecd2c2] bg-card px-4 py-3 font-display text-[15px] font-bold marker:content-none dark:border-[#5a3f2e] [&::-webkit-details-marker]:hidden">
            What your agent screens out · {screenedOut.length}
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
