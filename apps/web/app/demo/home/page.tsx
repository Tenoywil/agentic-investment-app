'use client';

import {
  AppScreen,
  DEFAULT_DEMO_ACCOUNT_STATE,
  DEFAULT_DEMO_PROFILE,
  DEMO_JOURNEY_STORAGE_KEY,
  type DemoAccountState,
  type DemoProfile,
  PageHead,
  readDemoAccountState,
  readDemoProfile,
} from '@/app/_components/AppScreen';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { EmptyState } from '@/app/_components/ui/empty';
import { APPROVAL_TONE_CLASS, APPROVAL_TONE_PILL, type ApprovalTone, cn } from '@/app/_lib/utils';
import { CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type DemoJourneyId = 'complete' | 'opportunity' | 'connect' | 'funding' | 'agent' | 'institution';

const FREE_JOURNEY = 'free';
const JOURNEYS: {
  id: DemoJourneyId;
  title: string;
  description: string;
  startPath: string;
  recommended?: boolean;
}[] = [
  {
    id: 'complete',
    title: 'Start a new investor journey',
    description: 'Create a profile, complete the fact-find, then move into advice and approvals.',
    startPath: '/sign-in?demo=1',
    recommended: true,
  },
  {
    id: 'opportunity',
    title: 'Find and review an investment',
    description: 'See how opportunities are compared, screened and prepared for your decision.',
    startPath: '/demo/opportunities',
  },
  {
    id: 'connect',
    title: 'Connect an account',
    description: 'Link an existing partner account or request a new one for your portfolio.',
    startPath: '/demo/portfolio?connect=1',
  },
  {
    id: 'funding',
    title: 'Add money to a partner account',
    description: 'Explore consolidated holdings and submit funding evidence to a licensed partner.',
    startPath: '/demo/portfolio',
  },
  {
    id: 'agent',
    title: 'Review an agent proposal',
    description:
      'Inspect the rationale, checks and execution partner before approving or dismissing a prepared move.',
    startPath: '/demo/agent?review=1',
  },
  {
    id: 'institution',
    title: 'Review and accept as a partner',
    description:
      'Open the partner console to review a client, accept instructions and settle orders.',
    startPath: '/demo/institutions',
  },
];

function isDemoJourneyId(value: string | null): value is DemoJourneyId {
  return JOURNEYS.some((journey) => journey.id === value);
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** The same greeting the live home computes, so the preview does not tell a
 *  visitor "Good afternoon" at nine in the evening. */
function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const first = name.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

const ACTED = [
  {
    t: 'Prepared a US$400 move into the NCB Money Market Fund',
    s: 'Inside your US$500 within-limit cap · confirmation still required',
  },
  {
    t: 'Reinvested a US$388 GOJ coupon after you approved it',
    s: 'Human-in-the-loop · Last week',
  },
  {
    t: 'Paused a JMD transfer. FX spread was 0.4% above your rule',
    s: 'Held for your review · Last week',
  },
];

/** Shaped like a live approval: an instrument as the headline and the figure
 *  the decision is about, so the preview card renders through the same
 *  name/amount treatment the signed-in home gives a real one. */
const APPROVALS: {
  id: string;
  tag: string;
  tone: ApprovalTone;
  name: string;
  amount: string;
  when: string;
}[] = [
  {
    id: 'coupon',
    tag: 'Reinvest',
    tone: 'investment',
    name: 'Sagicor Real Estate X Fund',
    amount: 'US$412',
    when: 'Today',
  },
  {
    id: 'idle',
    tag: 'Idle cash',
    tone: 'transfer',
    name: 'NCB USD Money Market Fund',
    amount: 'US$2,150',
    when: '2d ago',
  },
];

/** `regulator` mirrors the live shape: each partner names its own regulator
 *  rather than the blanket line the preview used to print under all four. */
const HELD = [
  {
    code: 'NCB',
    name: 'NCB Capital Markets',
    sub: 'GOJ Bond 2029 · Chequing',
    amt: 'US$13,400',
    regulator: 'FSC-regulated',
    tint: '#e7edf8',
    color: '#1a4aa0',
  },
  {
    code: 'SAG',
    name: 'Sagicor Investments',
    sub: 'Sigma Global Fund',
    amt: 'US$8,200',
    regulator: 'FSC-regulated',
    tint: '#e6f2ea',
    color: '#1f7a44',
  },
  {
    code: 'PRV',
    name: 'PROVEN Wealth',
    sub: 'USD Income Fund',
    amt: 'US$5,600',
    regulator: 'FSC-regulated',
    tint: '#f6efe0',
    color: '#9a6a1e',
  },
  {
    code: 'JMMB',
    name: 'JMMB Group',
    sub: 'Money Market · Savings',
    amt: 'US$4,150',
    regulator: 'BOJ-regulated',
    tint: '#fae8e6',
    color: '#c4362b',
  },
];

const ALLOC = [
  { label: 'Fixed income', pct: 46, color: '#17786e' },
  { label: 'Real estate', pct: 18, color: '#f0b98d' },
  { label: 'Money market', pct: 15, color: '#7fb5ad' },
  { label: 'Equities', pct: 14, color: '#c56a3e' },
  { label: 'Cash', pct: 7, color: '#e6dccb' },
];

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

function Donut() {
  const r = 52;
  const cir = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
      <g transform="rotate(-90 66 66)">
        {ALLOC.map((a) => {
          const len = (a.pct / 100) * cir;
          const seg = (
            <circle
              key={a.label}
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth="20"
              strokeDasharray={`${len} ${cir - len}`}
              strokeDashoffset={-acc}
            />
          );
          acc += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [dateLabel, setDateLabel] = useState('');
  const [accountState, setAccountState] = useState<DemoAccountState>(DEFAULT_DEMO_ACCOUNT_STATE);
  const [profile, setProfile] = useState<DemoProfile>(DEFAULT_DEMO_PROFILE);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<DemoJourneyId>('complete');

  useEffect(() => {
    setDateLabel(todayLabel());
    setAccountState(readDemoAccountState());
    setProfile(readDemoProfile());
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(DEMO_JOURNEY_STORAGE_KEY);
    } catch {
      // Storage is optional; the selected journey still works for this visit.
    }
    if (isDemoJourneyId(stored)) {
      setSelectedJourney(stored);
    }
    const requested = new URLSearchParams(window.location.search).get('choose') === '1';
    setJourneyOpen(requested || !(stored === FREE_JOURNEY || isDemoJourneyId(stored)));
  }, []);

  function startJourney() {
    const journey = JOURNEYS.find((candidate) => candidate.id === selectedJourney);
    if (!journey) return;
    try {
      window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, journey.id);
    } catch {
      // The route still opens when storage is unavailable.
    }
    setJourneyOpen(false);
    router.push(journey.startPath);
  }

  const pendingApprovals = APPROVALS.filter(
    (approval) => !accountState.approvedActions.includes(approval.id),
  );

  return (
    <AppScreen active="home" basePath="/demo">
      <Dialog
        open={journeyOpen}
        onOpenChange={(open) => {
          setJourneyOpen(open);
          if (!open) {
            try {
              window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, FREE_JOURNEY);
            } catch {
              // Dismissal still works when storage is unavailable.
            }
            router.replace('/demo/home');
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] p-6 sm:max-w-[620px]">
          <DialogHeader className="pr-8">
            <DialogTitle>What would you like to explore?</DialogTitle>
            <DialogDescription>
              Choose a starting point. You will use the same screens and controls as the live
              product. Start with a new profile or jump to another part of the experience.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
            <legend className="sr-only">Choose a demo journey</legend>
            {JOURNEYS.map((journey) => {
              const selected = selectedJourney === journey.id;
              return (
                <label
                  key={journey.id}
                  className={cn(
                    'flex min-h-16 min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-solid p-4 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                    selected ? 'border-primary bg-mint' : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="demo-journey"
                    value={journey.id}
                    checked={selected}
                    onChange={() => setSelectedJourney(journey.id)}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {journey.title}
                      {journey.recommended ? <Badge variant="success">Recommended</Badge> : null}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-dim">
                      {journey.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                try {
                  window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, FREE_JOURNEY);
                } catch {
                  // Closing still works when storage is unavailable.
                }
                setJourneyOpen(false);
                router.replace('/demo/home');
              }}
            >
              Explore freely
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={startJourney}>
              Start journey
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No right-hand slot, exactly as on the live home. A notification bell
          and an account avatar stood here; the live screen carries neither —
          there is no notification record anywhere in the schema, and the
          account menu lives in the sidebar footer where it is on every screen.
          A preview that shows two controls the product does not have is a
          preview of a different product. */}
      <PageHead eyebrow={dateLabel} title={greeting(profile.name)} />

      {/* Hero card. `dark:bg-[#124e48]` is not decoration: without it the
          preview hero keeps the light-theme primary in dark mode while the
          live hero darkens, which is the single most visible difference
          between the two homes at night. */}
      <div className="g-hero rounded-[20px] bg-primary p-7 text-[#eafaf5] dark:bg-[#124e48]">
        <div data-tour="customer-net-worth">
          {/* Net worth is the only figure here, as on the live home. The
              "↑6.8% · +US$1,994 all-time" pill and the rising sparkline under
              it are gone: there is no valuation history in the schema, so the
              signed-in hero can never draw them, and a preview that does is
              promising a screen the product does not ship. */}
          <div className={cn(UPPR, 'text-[#eafaf5]/[.78]')}>Total net worth</div>
          <div className="my-[10px] mb-3 font-display text-[52px] font-bold leading-none tracking-[-1.5px]">
            US$31,350
          </div>
          <div className="text-sm text-[#eafaf5]/[.94]">
            47 holdings · 4 licensed partners · shown in USD
          </div>
        </div>
        {/* The same reserved height the live hero holds, so the two screens
            settle at the same size instead of the preview sitting 55px
            shorter. */}
        <div
          className="min-h-[207px] pl-[26px] max-[900px]:min-h-[297px]"
          data-tour="customer-agent"
        >
          <div className={cn(UPPR, 'flex items-center gap-[7px] text-[#eafaf5]/[.78]')}>
            <span className="h-[7px] w-[7px] rounded-full bg-peach" />
            {pendingApprovals.length > 0 ? 'Waiting on you' : 'Where to next'}
          </div>
          {/* Doors into the product, not a weekly digest from the agent. The
              live hero stopped narrating the agent's inner monologue above a
              person's own money; the preview narrated it anyway. */}
          <p className="my-3 mb-2 text-[17px] font-medium leading-relaxed text-white">
            {pendingApprovals.length > 0
              ? `${pendingApprovals.length === 1 ? 'One move is' : `${pendingApprovals.length} moves are`} waiting for your approval. Nothing happens until you say so.`
              : 'Browse what you can invest in, follow your orders, or ask your agent. It checks every move against your limits and asks you first.'}
          </p>
          <div className="mt-[18px] flex flex-wrap gap-2.5">
            {/* Every link in the demo stays inside /demo — the preview must
                never route a visitor into the signed-in app. */}
            {pendingApprovals.length > 0 && (
              <Button variant="peach" asChild>
                <Link href="/demo/agent?review=1">
                  Review {pendingApprovals.length} approval
                  {pendingApprovals.length === 1 ? '' : 's'}
                </Link>
              </Button>
            )}
            <Button
              asChild
              className={
                pendingApprovals.length > 0
                  ? 'border border-solid border-white/30 bg-transparent text-white hover:bg-white/10'
                  : undefined
              }
              variant={pendingApprovals.length > 0 ? undefined : 'peach'}
            >
              <Link href="/demo/opportunities">Invest</Link>
            </Button>
            <Button
              asChild
              className="border border-solid border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/demo/orders">My orders</Link>
            </Button>
            <Button
              asChild
              className="border border-solid border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/demo/agent">Ask your agent</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Held / Allocation — first under the hero, matching the live home:
          the person's money before the agent's commentary. The pipeline
          explainer that stood here lives on the Agent screen now. */}
      <div className="g-held mt-[18px]">
        <Card className="p-[22px]">
          <div className="mb-3.5 flex items-center justify-between">
            <b className="font-display text-lg">Held across partners</b>
            <Link href="/demo/portfolio" className="text-sm font-bold text-teal2 no-underline">
              View portfolio →
            </Link>
          </div>
          {HELD.map((h) => (
            <div key={h.code} className="flex items-center gap-3 border-t border-border py-[11px]">
              <span
                className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                style={{ background: h.tint, color: h.color }}
              >
                {h.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold">{h.name}</div>
                {/* Truncated, as live: a long holdings list wrapped here and
                    pushed the row taller than the same row signed in. */}
                <div className="truncate text-[12.5px] text-faint">{h.sub}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-bold">{h.amt}</div>
                {/* The partner's own regulator, not a blanket "· Licensed
                    partner" under all four — and without the orphaned middot
                    that had nothing before it. */}
                <div className="text-[11.5px] text-success-ink">{h.regulator}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card className="p-[22px]">
          <b className="font-display text-lg">Allocation</b>
          <div className="mb-2 text-[13px] text-faint">Blended across all 4 partners</div>
          <div className="flex items-center gap-[18px]">
            <Donut />
            <div className="flex-1">
              {ALLOC.map((a) => (
                <div key={a.label} className="mb-[7px] flex items-center gap-2 text-[13.5px]">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-[3px]"
                    style={{ background: a.color }}
                  />
                  <span className="flex-1 text-dim">{a.label}</span>
                  <b className="font-mono text-[13px]">{a.pct}%</b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Approvals first, then the agent's activity — the live order. The
          decision waiting on the reader outranks a log of what already
          happened. */}
      <div className="g2 mt-[18px]">
        <Card className="p-[22px]" data-tour="customer-approvals">
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
            {pendingApprovals.length > 0 && (
              <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra-ink">
                {pendingApprovals.length}
              </span>
            )}
          </div>
          {pendingApprovals.length === 0 && (
            <EmptyState
              icon={CheckCheck}
              title="Nothing needs your approval"
              body="Moves outside your limits wait here for a decision from you."
            />
          )}
          {pendingApprovals.map((a) => (
            <div
              key={a.id}
              className="mb-3 rounded-xl border border-solid border-border bg-muted/20 p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                {/* Theme-aware, shared with the live home. This pill used to
                    paint light-theme ink on an 8%-alpha fill of the same hex,
                    which in dark mode fell to roughly 1.7:1 — well under the
                    4.5:1 floor the live screen was fixed to meet. */}
                <span className={cn(APPROVAL_TONE_PILL, APPROVAL_TONE_CLASS[a.tone])}>{a.tag}</span>
                <span className="text-[12.5px] text-faint">{a.when}</span>
              </div>
              {/* Instrument as the headline, the amount as the figure being
                  decided on — the same treatment the live card gives a real
                  approval. */}
              <div className="mb-0.5 text-[15px] font-bold leading-snug">{a.name}</div>
              <div className="mb-3 font-display text-[22px] font-bold leading-none tracking-tight text-teal2">
                {a.amount}
              </div>
              <Button className="w-full" asChild>
                <Link href="/demo/agent?review=1">Review &amp; approve</Link>
              </Button>
            </div>
          ))}
        </Card>

        <Card className="p-[22px]" data-tour="customer-activity">
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cn(UPPR, 'text-foreground')}>Agent activity</span>
            <Badge variant="secondary">you confirm every move</Badge>
          </div>
          {ACTED.map((a) => (
            <div key={a.t} className="mb-[15px] flex gap-2.5">
              {/* One themed dot, as live. Two inline hex dots stood here and
                  neither had a dark-theme value. */}
              <span className="mt-1.5 h-[9px] w-[9px] flex-none rounded-full bg-teal2" />
              <div className="min-w-0">
                <div className="line-clamp-2 text-[14.5px] font-semibold leading-snug">{a.t}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">{a.s}</div>
              </div>
            </div>
          ))}
          <Button variant="outline" className="mt-1.5 w-full text-teal2" asChild>
            <Link href="/demo/agent">Adjust your agent's limits</Link>
          </Button>
        </Card>
      </div>

      {/* The three stat cards that closed this screen restated the hero's own
          net worth, the allocation card's own split and the approvals card's
          own count. The live home dropped them for exactly that reason; a
          preview that keeps them ends on a screenful the product does not
          have. */}
    </AppScreen>
  );
}
