'use client';

import { AppScreen } from '@/app/_components/AppScreen';
import { ChatMarkdown } from '@/app/_components/ChatMarkdown';
import { AgentDisplayCard } from '@/app/_components/agent-displays';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
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
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { Switch } from '@/app/_components/ui/switch';
import { cn } from '@/app/_lib/utils';
import type { AgentDisplayData } from '@/lib/agent-api';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Mic,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

type Msg = { role: 'agent' | 'user'; text: string } | { role: 'agent'; display: AgentDisplayData };

const SEED: Msg[] = [
  {
    role: 'agent',
    text: "Welcome back, Marcus. Your portfolio is up <b>6.8%</b> this year and I'm tracking <b>47 instruments</b> across <b>8 licensed partners</b>. Two things need your attention this week.",
  },
  {
    role: 'agent',
    text: 'Your <b>GOJ 2026 coupon of US$412</b> settles Friday. Reinvesting it into the <b>Sagicor Real Estate X Fund</b> would lift your blended yield to <b>6.9%</b> and stay inside your risk band. Want me to prepare it?',
  },
  { role: 'user', text: 'What about the idle cash?' },
  {
    role: 'agent',
    text: "Good instinct. You have <b>US$2,150</b> earning nothing. Sweeping it into the <b>NCB USD Money Market Fund</b> adds about <b>US$110/yr</b> at the current rate, with same-day access. I've queued both for your approval.",
  },
];

const SUGGESTIONS: { label: string; mobileLabel: string; key: string }[] = [
  { label: 'Summarize my week', mobileLabel: 'Weekly recap', key: 'summary' },
  { label: 'Chart my allocation', mobileLabel: 'Allocation chart', key: 'rebalance' },
  { label: 'Best income deal?', mobileLabel: 'Income idea', key: 'income' },
];

const REPLIES: Record<string, string> = {
  summary:
    "Here's your week: your GOJ 2026 coupon of US$412 settles Friday. I'd reinvest it into the Real Estate X Fund, which is projected to lift blended yield to about 6.9%. Your US$2,150 cash is idle; a money-market sweep is projected to add about US$110 a year. Both are queued for your approval.",
  rebalance:
    "You're overweight fixed income at 46% and light on equities at 14%. Shifting about US$3,000 from cash into the GraceKennedy offering moves you toward your balanced-income target while keeping risk in band. I can prepare it, and Barita would execute it.",
  income:
    'For income right now the Government of Jamaica USD Bond 2032 at 7.875% is the standout: hard currency, sovereign, and projected to lift your blended yield to about 6.9%. Coupon rates are set at issue; the projection is not a guarantee. Shall I prepare it for your approval?',
  idle: 'You have US$2,150 sitting idle. Sweeping it into the NCB USD Money Market Fund at the current 5.1% rate is projected to add about US$110 a year, with same-day access. Rates move; the fund’s rate is variable. I can queue it now.',
  whynot:
    'The Beachfront Villas Development Note fails your suitability screen on four counts: it is a high-risk speculative note against your balanced-income profile, the US$25,000 minimum is about 80% of your portfolio versus your 15% single-position cap, five illiquid years conflict with your university-fund timeline, and it pays no income until exit. I keep it visible so you can see what I screen out, but I will not prepare or route it.',
  safety:
    "Here's the honest split: I research, screen and prepare. The licensed, FSC-regulated partners execute, custody and settle. CCN never holds your money and never executes a trade itself. Everything I do is inside limits you set, and every action is written to an audit log you can read.",
  fees: "CCN charges a flat platform fee; the partners' own product fees are shown on each deal card before you approve, and there are no hidden spreads from me. I always show the partner's fee line next to any projection.",
  kyc: 'Your identity checks live with the licensed partners, not with me. NCB already verified you to Tier 2, and with your consent CCN reuses that status across partners, so there’s no new paperwork. Each partner remains the regulated entity responsible for KYC and AML on its own accounts.',
};

/** Sample-only numbers for the public preview. The live surface receives this
 *  same shape from the read-only allocation tool over the structured display
 *  channel; neither surface asks the model to invent chart coordinates. */
const REBALANCE_DISPLAY: AgentDisplayData = {
  kind: 'allocation',
  data: {
    currency: 'USD',
    total: 'US$28,600',
    band: 'balanced income',
    byType: [
      {
        key: 'cash',
        label: 'Cash',
        valueMinor: '572000',
        value: 'US$5,720',
        pct: 20,
        targetPct: 10,
        gapPts: -10,
      },
      {
        key: 'bond',
        label: 'Fixed income',
        valueMinor: '1315600',
        value: 'US$13,156',
        pct: 46,
        targetPct: 30,
        gapPts: -16,
      },
      {
        key: 'fund',
        label: 'Funds',
        valueMinor: '228800',
        value: 'US$2,288',
        pct: 8,
        targetPct: 15,
        gapPts: 7,
      },
      {
        key: 'equity',
        label: 'Equities',
        valueMinor: '400400',
        value: 'US$4,004',
        pct: 14,
        targetPct: 25,
        gapPts: 11,
      },
      {
        key: 'real_estate',
        label: 'Real estate',
        valueMinor: '343200',
        value: 'US$3,432',
        pct: 12,
        targetPct: 10,
        gapPts: -2,
      },
      {
        key: 'private',
        label: 'Private markets',
        valueMinor: '0',
        value: 'US$0',
        pct: 0,
        targetPct: 10,
        gapPts: 10,
      },
    ],
    byPartner: [
      {
        key: 'ncb',
        label: 'NCB',
        valueMinor: '1887600',
        value: 'US$18,876',
        pct: 66,
      },
      {
        key: 'sagicor',
        label: 'Sagicor',
        valueMinor: '572000',
        value: 'US$5,720',
        pct: 20,
      },
      {
        key: 'barita',
        label: 'Barita',
        valueMinor: '400400',
        value: 'US$4,004',
        pct: 14,
      },
    ],
    byCurrency: [
      {
        key: 'USD',
        label: 'USD',
        valueMinor: '2860000',
        value: 'US$28,600',
        pct: 100,
      },
    ],
  },
};

const REPLY_DISPLAYS: Partial<Record<string, AgentDisplayData>> = {
  rebalance: REBALANCE_DISPLAY,
};

const FALLBACK =
  'I research regional opportunities, screen them against your suitability profile, and prepare them for your approval. Execution, custody and settlement always stay with the licensed partner that holds the instrument. Ask me about income, rebalancing, idle cash, fees, or how your data and KYC are handled.';

function classify(text: string): string {
  const t = text.toLowerCase();
  if (/villa|beachfront|development note|why not|reject|declin|flag|against/.test(t))
    return 'whynot';
  if (/kyc|verif|identity|paperwork|document/.test(t)) return 'kyc';
  if (/safe|secure|regulat|custod|trust|hold my|licen/.test(t)) return 'safety';
  if (/fee|cost|charge|commission|spread/.test(t)) return 'fees';
  if (/summar|week|overview/.test(t)) return 'summary';
  if (/chart|graph|pie|bar graph|plot|visual/.test(t)) return 'rebalance';
  if (/rebalanc|allocat|overweight|diversif/.test(t)) return 'rebalance';
  if (/income|yield|best|deal|coupon|bond/.test(t)) return 'income';
  if (/idle|cash|spare|sitting/.test(t)) return 'idle';
  return '';
}

const APPROVALS: {
  id: string;
  tag: string;
  variant: BadgeProps['variant'];
  when: string;
  title: string;
  body: string;
  cta: string;
  /** What the agent says in the chat when this card is approved. */
  confirm: string;
  /** The card's own settled line once approved. */
  done: string;
  /** The visible specialist hand-offs behind this sample recommendation. */
  trace: { agent: string; summary: string }[];
}[] = [
  {
    id: 'coupon',
    tag: 'Reinvest',
    variant: 'secondary',
    when: 'Today',
    title: 'Put your GOJ coupon to work',
    body: 'US$412 settles Friday. Reinvesting into the Real Estate X Fund lifts your blended yield to 6.9%.',
    cta: 'Approve reinvestment',
    confirm:
      'Demo complete. In the live app, approval would route the <b>US$412</b> reinvestment into the <b>Sagicor Real Estate X Fund</b> to Sagicor for execution. The resulting order would remain visible in My orders.',
    done: 'Sample routed to Sagicor · no transaction placed',
    trace: [
      {
        agent: 'Research agent',
        summary: 'Flagged the maturing coupon and compared the listed income products.',
      },
      {
        agent: 'Portfolio fit agent',
        summary:
          'Favoured real-estate income to reduce the portfolio’s fixed-income concentration.',
      },
      {
        agent: 'Suitability agent',
        summary: 'Checked the risk band, minimum, cash floor and single-position cap.',
      },
      {
        agent: 'Compliance agent',
        summary: 'Verified KYC readiness and the active Sagicor account relationship.',
      },
      {
        agent: 'Coordinator',
        summary: 'Sized the sample move to the coupon and prepared it for human approval.',
      },
    ],
  },
  {
    id: 'idle',
    tag: 'Idle cash',
    variant: 'terra',
    when: '2d ago',
    title: 'US$2,150 earning nothing',
    body: 'Sweep your USD cash into the NCB Money Market Fund for ~US$110/yr with same-day access.',
    cta: 'Move cash',
    confirm:
      'Demo complete. In the live app, approval would ask <b>NCB</b> to place <b>US$2,150</b> into its USD Money Market Fund. No money moved in this preview.',
    done: 'Sample routed to NCB · no money moved',
    trace: [
      {
        agent: 'Research agent',
        summary: 'Compared the idle balance with listed short-duration cash products.',
      },
      {
        agent: 'Portfolio fit agent',
        summary: 'Selected the option that preserves same-day access for near-term goals.',
      },
      {
        agent: 'Suitability agent',
        summary: 'Verified the cash floor, approval threshold and enabled sweep rule.',
      },
      {
        agent: 'Compliance agent',
        summary: 'Verified KYC readiness and the active NCB account relationship.',
      },
      {
        agent: 'Coordinator',
        summary: 'Prepared the sample sweep for a person to approve before NCB executes.',
      },
    ],
  },
];

/** The question the demo mic "hears" — typed out live, so the voice flow can
 *  be shown without the demo ever asking the browser for microphone access. */
const DICTATION_SCRIPT = 'What about the idle cash?';

type DemoRuleKey = 'autoInvest' | 'cashFloor' | 'approval' | 'singlePosition' | 'dailyCap';

interface DemoLimits {
  autoInvestCap: string;
  cashFloor: string;
  approvalThreshold: string;
  singlePositionPct: string;
  dailyCap: string;
}

const DEMO_LIMITS: DemoLimits = {
  autoInvestCap: '500',
  cashFloor: '1000',
  approvalThreshold: '1000',
  singlePositionPct: '15',
  dailyCap: '2500',
};

const RULES: {
  key: DemoRuleKey;
  label: string;
  note: string;
  value: (limits: DemoLimits) => string;
}[] = [
  {
    key: 'autoInvest',
    label: 'Auto-invest idle cash',
    note: 'The most it may commit without asking',
    value: (limits) => `≤ ${formatDemoUsd(limits.autoInvestCap)}`,
  },
  {
    key: 'cashFloor',
    label: 'Keep a cash floor',
    note: 'Never swept below this',
    value: (limits) => formatDemoUsd(limits.cashFloor),
  },
  {
    key: 'approval',
    label: 'Require approval above',
    note: 'Bigger moves always ask you',
    value: (limits) => formatDemoUsd(limits.approvalThreshold),
  },
  {
    key: 'singlePosition',
    label: 'Single-position cap',
    note: 'Share of your portfolio in any one holding',
    value: (limits) => `≤ ${limits.singlePositionPct}%`,
  },
  {
    key: 'dailyCap',
    label: 'Daily cap',
    note: 'Total it may commit in a single day',
    value: (limits) => formatDemoUsd(limits.dailyCap),
  },
];

const DEMO_RULES: Record<DemoRuleKey, boolean> = {
  autoInvest: true,
  cashFloor: true,
  approval: true,
  singlePosition: true,
  dailyCap: true,
};

const DEMO_LIMIT_FIELDS: {
  key: keyof DemoLimits;
  label: string;
  note: string;
  inputMode: 'decimal' | 'numeric';
}[] = [
  {
    key: 'autoInvestCap',
    label: 'Auto-invest cap (USD)',
    note: 'Most it may commit alone.',
    inputMode: 'decimal',
  },
  {
    key: 'approvalThreshold',
    label: 'Always ask above (USD)',
    note: 'Approval takes priority.',
    inputMode: 'decimal',
  },
  {
    key: 'cashFloor',
    label: 'Cash floor (USD)',
    note: 'Cash it must leave untouched.',
    inputMode: 'decimal',
  },
  {
    key: 'singlePositionPct',
    label: 'Single-position maximum (%)',
    note: 'Whole percentage from 1 to 100.',
    inputMode: 'numeric',
  },
  {
    key: 'dailyCap',
    label: 'Daily commitment cap (USD)',
    note: 'Total it may commit in one day.',
    inputMode: 'decimal',
  },
];

function formatDemoUsd(value: string): string {
  const amount = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(amount)) return 'Not set';
  return `US$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

const STATS: { n: string; cls: string; t: string }[] = [
  { n: '47', cls: 'text-foreground', t: 'instruments monitored' },
  { n: '8', cls: 'text-teal2', t: 'licensed partners' },
  { n: '6', cls: 'text-terra', t: 'matched to goals' },
  { n: '11', cls: 'text-success', t: 'actions this month' },
];

export default function AgentPage() {
  const [chat, setChat] = useState<Msg[]>(SEED);
  const [draft, setDraft] = useState('');
  const [voice, setVoice] = useState(false);
  const [rules, setRules] = useState(DEMO_RULES);
  const [limits, setLimits] = useState(DEMO_LIMITS);
  const [limitsDraft, setLimitsDraft] = useState(DEMO_LIMITS);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  /** Approval cards live locally: pending → approved, or dismissed away. */
  const [cardState, setCardState] = useState<Record<string, 'pending' | 'approved'>>(
    Object.fromEntries(APPROVALS.map((a) => [a.id, 'pending'])),
  );
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** The simulated dictation: null when idle, else the transcript so far. */
  const [hearing, setHearing] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dictationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dictationSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (chat.length === 0 && !replying) return;
    const frame = requestAnimationFrame(() => {
      const el = logRef.current;
      if (!el) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [chat, replying]);

  useEffect(
    () => () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
      if (dictationIntervalRef.current) clearInterval(dictationIntervalRef.current);
      if (dictationSendTimerRef.current) clearTimeout(dictationSendTimerRef.current);
    },
    [],
  );

  function reply(key: string) {
    const text = REPLIES[key] ?? FALLBACK;
    const display = REPLY_DISPLAYS[key];
    setChat((c) =>
      display
        ? [...c, { role: 'agent', text }, { role: 'agent', display }]
        : [...c, { role: 'agent', text }],
    );
    setReplying(false);
    replyTimerRef.current = null;
  }

  function send(text: string, key?: string) {
    const t = text.trim();
    if (!t || replying) return;
    setChat((c) => [...c, { role: 'user', text: t }]);
    setDraft('');
    setReplying(true);
    replyTimerRef.current = setTimeout(() => reply(key ?? classify(t)), 450);
  }

  function approveCard(a: (typeof APPROVALS)[number]) {
    setCardState((s) => ({ ...s, [a.id]: 'approved' }));
    setChat((c) => [...c, { role: 'agent', text: a.confirm }]);
  }

  function dismissCard(a: (typeof APPROVALS)[number]) {
    setDismissed((d) => [...d, a.id]);
    setChat((c) => [
      ...c,
      {
        role: 'agent',
        text: `Understood. I've set "${a.title}" aside. I'll flag it again only if the numbers change.`,
      },
    ]);
  }

  /** Voice, without a single browser permission: the demo types its sample
   *  question into the composer word by word, then sends it — the feel of the
   *  live dictation flow with nothing captured and nothing asked for. */
  function playDictation() {
    if (hearing !== null || replying || draft.trim() !== '') return;
    const words = DICTATION_SCRIPT.split(' ');
    let i = 0;
    setHearing('');
    dictationIntervalRef.current = setInterval(() => {
      i += 1;
      const sofar = words.slice(0, i).join(' ');
      setHearing(sofar);
      setDraft(sofar);
      if (i >= words.length) {
        if (dictationIntervalRef.current) clearInterval(dictationIntervalRef.current);
        dictationIntervalRef.current = null;
        dictationSendTimerRef.current = setTimeout(() => {
          setHearing(null);
          setDraft('');
          dictationSendTimerRef.current = null;
          send(DICTATION_SCRIPT, 'idle');
        }, 450);
      }
    }, 220);
  }

  function openLimits() {
    setLimitsDraft(limits);
    setLimitsError(null);
    setLimitsOpen(true);
  }

  function saveLimits() {
    const moneyFields: { key: keyof DemoLimits; label: string }[] = [
      { key: 'autoInvestCap', label: 'Auto-invest cap' },
      { key: 'cashFloor', label: 'Cash floor' },
      { key: 'approvalThreshold', label: 'Approval threshold' },
      { key: 'dailyCap', label: 'Daily cap' },
    ];
    for (const { key, label } of moneyFields) {
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(limitsDraft[key].trim())) {
        setLimitsError(`${label} must be a non-negative dollar amount with up to two decimals.`);
        return;
      }
    }
    const positionPct = Number(limitsDraft.singlePositionPct);
    if (!Number.isInteger(positionPct) || positionPct < 1 || positionPct > 100) {
      setLimitsError('Single-position maximum must be a whole percentage from 1 to 100.');
      return;
    }
    setLimits(limitsDraft);
    setLimitsOpen(false);
  }

  const visibleCards = APPROVALS.filter((a) => !dismissed.includes(a.id));
  const pendingCount = visibleCards.filter((a) => cardState[a.id] === 'pending').length;

  return (
    <AppScreen active="agent" basePath="/demo">
      {/* One compact line, matching the live screen: this is a chat
          experience, and header rows are lines taken from the conversation. */}
      <div className="agent-preamble mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="m-0 font-display text-[22px] font-bold tracking-tight">
          Your Capital Agent
        </h1>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-dim">
          <span className="flex items-center gap-1.5 font-bold text-teal2">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            Interactive demo
          </span>
          {STATS.slice(0, 2).map((s) => (
            <span key={s.t}>
              · <b className={cn('font-mono', s.cls)}>{s.n}</b> {s.t}
            </span>
          ))}
        </span>
      </div>

      <div className="g-agent">
        {/* Chat */}
        <Card
          className="agent-chat agent-chat--demo flex flex-col overflow-hidden"
          data-tour="customer-agent"
        >
          <div className="agent-chat__head flex items-center gap-3 border-b border-solid border-x-0 border-t-0 border-border px-5 py-[18px] max-[900px]:gap-2 max-[900px]:px-3 max-[900px]:py-3">
            {/* Phone only (CSS): the chat owns the whole screen there. */}
            <Link
              href="/demo/home"
              aria-label="Back to dashboard"
              className="agent-chat__back h-10 w-10 flex-none place-items-center rounded-[12px] text-foreground hover:bg-muted max-[900px]:h-9 max-[900px]:w-9"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </Link>
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-[#eafaf5] max-[900px]:h-9 max-[900px]:w-9">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-bold max-[900px]:text-[15px]">
                CCN Capital Agent
              </div>
              <div className="flex items-center gap-1.5 text-[13px] text-dim max-[900px]:hidden">
                <span className="h-[7px] w-[7px] rounded-full bg-success" />
                Suitability-aware · acts on your approval
              </div>
            </div>
            <button
              type="button"
              aria-pressed={voice}
              aria-label={voice ? 'Turn voice replies off' : 'Turn voice replies on'}
              onClick={() => setVoice((v) => !v)}
              className={cn(
                'inline-flex flex-none items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[13.5px] font-bold max-[900px]:h-9 max-[900px]:w-9 max-[900px]:justify-center max-[900px]:p-0',
                voice ? 'bg-mint text-teal2' : 'bg-card text-dim',
              )}
            >
              {voice ? (
                <Volume2 className="h-4 w-4" aria-hidden />
              ) : (
                <VolumeX className="h-4 w-4" aria-hidden />
              )}
              <span className="max-[900px]:hidden">Voice {voice ? 'on' : 'off'}</span>
            </button>
          </div>

          <div
            ref={logRef}
            aria-live="polite"
            aria-label="Conversation with your agent"
            className="agent-chat__log flex max-h-[440px] flex-col gap-3.5 overflow-y-auto px-5 py-[18px] max-[900px]:gap-3 max-[900px]:px-3 max-[900px]:py-4"
          >
            {chat.map((m, i) => {
              if ('display' in m) {
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                    key={i}
                    className="ml-9 min-w-0 max-w-[95%] max-[900px]:ml-8"
                  >
                    <AgentDisplayCard display={m.display} />
                  </div>
                );
              }
              return m.role === 'agent' ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="flex max-w-[88%] items-start gap-2.5 max-[900px]:max-w-[680px] max-[900px]:gap-2"
                >
                  <span className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-mint text-teal2">
                    <Sparkles className="h-[15px] w-[15px]" aria-hidden />
                  </span>
                  <div className="min-w-0 rounded-[4px_14px_14px_14px] bg-[#f4f0e7] dark:bg-white/[0.05] px-[15px] py-3 text-[14.5px] leading-relaxed text-[#2c2925] dark:text-foreground max-[900px]:px-3 max-[900px]:py-2.5 max-[900px]:text-sm">
                    <ChatMarkdown text={m.text} />
                  </div>
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="max-w-[82%] self-end max-[900px]:max-w-[560px]"
                >
                  <div className="rounded-[14px_4px_14px_14px] bg-primary px-[15px] py-3 text-[14.5px] leading-normal text-white max-[900px]:px-3 max-[900px]:py-2.5 max-[900px]:text-sm">
                    {m.text}
                  </div>
                </div>
              );
            })}
            {replying ? (
              <output
                className="flex max-w-[680px] items-start gap-2"
                aria-label="Agent is replying"
              >
                <span className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-mint text-teal2">
                  <Sparkles className="h-[15px] w-[15px]" aria-hidden />
                </span>
                <span className="inline-flex h-10 items-center gap-1 rounded-[4px_14px_14px_14px] bg-[#f4f0e7] px-4 dark:bg-white/[0.05]">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal2 [animation-delay:-0.3s] motion-reduce:animate-none" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal2 [animation-delay:-0.15s] motion-reduce:animate-none" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal2 motion-reduce:animate-none" />
                </span>
              </output>
            ) : null}
          </div>

          <div className="agent-chat__composer px-5 pb-[18px] max-[900px]:mx-auto max-[900px]:w-full max-[900px]:max-w-[720px] max-[900px]:px-3">
            {/* The words as they are "heard" — the live screen's dictation
                preview, driven by the script above rather than a microphone. */}
            {hearing !== null && (
              <output
                aria-live="polite"
                className="mb-2.5 flex items-start gap-2 rounded-xl bg-mint/70 px-3.5 py-2.5 text-[13.5px] leading-snug text-foreground dark:bg-white/[0.06]"
              >
                <Mic className="mt-0.5 h-4 w-4 flex-none animate-pulse text-teal2" aria-hidden />
                <span className="min-w-0">{hearing || 'Listening…'}</span>
              </output>
            )}
            <div className="mb-3 flex gap-2 max-[900px]:mb-2.5 max-[900px]:gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s.key}
                  variant="outline"
                  size="sm"
                  className="h-8 flex-none rounded-[20px] px-3 text-xs font-semibold text-teal2 max-[900px]:min-w-0 max-[900px]:flex-1 max-[900px]:px-1.5"
                  disabled={replying || hearing !== null}
                  onClick={() => send(s.label, s.key)}
                >
                  <span className="max-[900px]:hidden">{s.label}</span>
                  <span className="min-[901px]:hidden">{s.mobileLabel}</span>
                </Button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-center gap-2 rounded-[14px] border border-border bg-card py-1.5 pl-3.5 pr-1.5 max-[900px]:gap-1.5 max-[900px]:pl-3"
            >
              <label htmlFor={inputId} className="sr-only">
                Ask your agent
              </label>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={hearing !== null}
                autoComplete="off"
                placeholder="Ask your agent…"
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[15px] text-foreground outline-none placeholder:text-faint max-[900px]:text-sm"
              />
              <Button
                type="button"
                variant={hearing !== null ? 'default' : 'secondary'}
                size="icon"
                aria-label="Voice input (plays a sample question)"
                aria-pressed={hearing !== null}
                onClick={playDictation}
                disabled={replying || hearing !== null || draft.trim() !== ''}
                className="h-[38px] w-[38px] flex-none rounded-[10px] max-[900px]:h-9 max-[900px]:w-9"
              >
                <Mic className={cn('h-[17px] w-[17px]', hearing !== null && 'animate-pulse')} />
              </Button>
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={replying || hearing !== null || draft.trim() === ''}
                className="h-[38px] w-[38px] flex-none rounded-[10px] max-[900px]:h-9 max-[900px]:w-9"
              >
                <ArrowRight className="h-[18px] w-[18px]" />
              </Button>
            </form>
          </div>
        </Card>

        {/* Approvals + limits */}
        <div className="flex flex-col gap-[18px]">
          <Card className="p-5" data-tour="customer-approvals">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
              {pendingCount > 0 && (
                <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra-ink">
                  {pendingCount}
                </span>
              )}
            </div>
            {visibleCards.length === 0 && (
              <p className="py-2 text-[13.5px] leading-normal text-dim">
                Nothing needs your approval. When the agent prepares a move outside your limits, it
                waits for you here.
              </p>
            )}
            {visibleCards.map((a) => (
              <div key={a.id} className="mb-3 rounded-xl border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant={a.variant}>{a.tag}</Badge>
                  <span className="text-[12.5px] text-faint">{a.when}</span>
                </div>
                <div className="mb-1.5 text-[15px] font-bold">{a.title}</div>
                <p className="mb-3 text-[13.5px] leading-normal text-dim">{a.body}</p>
                <details className="mb-3 rounded-lg border border-solid border-border bg-muted/40 px-3 py-2 text-[12.5px]">
                  <summary className="cursor-pointer font-bold text-teal2">
                    How the agents reached this
                  </summary>
                  <ol className="mb-0 mt-2 space-y-1.5 pl-4 text-dim">
                    {a.trace.map((stage) => (
                      <li key={stage.agent}>
                        <b className="text-foreground">{stage.agent}:</b> {stage.summary}
                      </li>
                    ))}
                  </ol>
                </details>
                {cardState[a.id] === 'approved' ? (
                  <p className="m-0 flex items-center gap-1.5 text-[13.5px] font-bold text-success-ink">
                    <span aria-hidden>✓</span> Approved · {a.done}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Button className="h-10 flex-1" onClick={() => approveCard(a)}>
                      {a.cta}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 text-dim"
                      onClick={() => dismissCard(a)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>

          <Card className="p-5" data-tour="customer-limits">
            <div className="mb-3.5 flex items-center justify-between gap-2.5">
              <div>
                <span className={cn(UPPR, 'text-foreground')}>Your limits &amp; rules</span>
                <span className="ml-2 text-[12.5px] text-faint">what it may do alone</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-teal2"
                onClick={openLimits}
              >
                <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden />
                Adjust
              </Button>
            </div>
            {RULES.map((r, i) => (
              <div
                key={r.label}
                className={cn(
                  'flex items-center gap-3 py-3',
                  i === 0 ? '' : 'border-t border-solid border-x-0 border-b-0 border-border',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-bold">{r.label}</div>
                  <div className="text-[12.5px] text-faint">{r.note}</div>
                </div>
                <span
                  className={cn(
                    'font-mono text-[13.5px] font-bold',
                    rules[r.key] ? 'text-teal2' : 'text-faint line-through',
                  )}
                >
                  {r.value(limits)}
                </span>
                <Switch
                  checked={rules[r.key]}
                  onCheckedChange={() =>
                    setRules((current) => ({ ...current, [r.key]: !current[r.key] }))
                  }
                  aria-label={`${r.label}, ${rules[r.key] ? 'on' : 'off'}`}
                  className="flex-none"
                />
              </div>
            ))}
            <Dialog open={limitsOpen} onOpenChange={setLimitsOpen}>
              <DialogContent className="max-w-[620px] p-0">
                <DialogHeader className="border-b border-solid border-x-0 border-t-0 border-border px-6 pb-5 pt-6 pr-16">
                  <DialogTitle>Adjust your agent limits</DialogTitle>
                  <DialogDescription>
                    Try the same controls available on the live account. These sample changes stay
                    inside this walkthrough and never reach an account.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="grid gap-5 px-6 pb-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveLimits();
                  }}
                >
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    {DEMO_LIMIT_FIELDS.map(({ key, label, note, inputMode }) => (
                      <div className="grid gap-2" key={key}>
                        <Label htmlFor={`demo-${key}`}>{label}</Label>
                        <Input
                          id={`demo-${key}`}
                          inputMode={inputMode}
                          value={limitsDraft[key]}
                          onChange={(event) =>
                            setLimitsDraft((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                        <p className="m-0 text-xs text-faint">{note}</p>
                      </div>
                    ))}
                  </div>
                  {limitsError && (
                    <p
                      className="m-0 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra"
                      aria-live="polite"
                    >
                      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                      {limitsError}
                    </p>
                  )}
                  <DialogFooter className="justify-end max-sm:flex-col-reverse">
                    <Button type="button" variant="outline" onClick={() => setLimitsOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Apply sample limits</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </Card>
        </div>
      </div>
    </AppScreen>
  );
}
