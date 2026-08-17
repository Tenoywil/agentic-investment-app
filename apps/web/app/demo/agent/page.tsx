'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { ChatMarkdown } from '@/app/_components/ChatMarkdown';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Switch } from '@/app/_components/ui/switch';
import { cn } from '@/app/_lib/utils';
import { ArrowLeft, ArrowRight, Mic, Sparkles, Volume2, VolumeX } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';

type Msg = { role: 'agent' | 'user'; text: string };

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

const SUGGESTIONS: { label: string; key: string }[] = [
  { label: 'Summarize my week', key: 'summary' },
  { label: 'Rebalance ideas', key: 'rebalance' },
  { label: 'Best income deal?', key: 'income' },
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
  if (/rebalanc|allocat|overweight|diversif/.test(t)) return 'rebalance';
  if (/income|yield|best|deal|coupon|bond/.test(t)) return 'income';
  if (/idle|cash|spare|sitting/.test(t)) return 'idle';
  return '';
}

const APPROVALS: {
  id: string;
  tag: string;
  variant: BadgeProps['variant'];
  accent: string;
  when: string;
  title: string;
  body: string;
  cta: string;
  /** What the agent says in the chat when this card is approved. */
  confirm: string;
  /** The card's own settled line once approved. */
  done: string;
}[] = [
  {
    id: 'coupon',
    tag: 'Reinvest',
    variant: 'secondary',
    accent: '#0e5952',
    when: 'Today',
    title: 'Put your GOJ coupon to work',
    body: 'US$412 settles Friday. Reinvesting into the Real Estate X Fund lifts your blended yield to 6.9%.',
    cta: 'Approve reinvestment',
    confirm:
      "Done. I've routed the <b>US$412</b> reinvestment into the <b>Sagicor Real Estate X Fund</b> to Sagicor for execution. It settles T+2. You can follow it in My orders, and your blended yield moves to about <b>6.9%</b> once it lands.",
    done: 'Routed to Sagicor · settles T+2',
  },
  {
    id: 'idle',
    tag: 'Idle cash',
    variant: 'terra',
    accent: '#c56a3e',
    when: '2d ago',
    title: 'US$2,150 earning nothing',
    body: 'Sweep your USD cash into the NCB Money Market Fund for ~US$110/yr with same-day access.',
    cta: 'Move cash',
    confirm:
      'Done. Your <b>US$2,150</b> is on its way into the <b>NCB USD Money Market Fund</b> at the current 5.1% rate, worth about <b>US$110/yr</b>, with same-day access whenever you want it back.',
    done: 'Swept to NCB · same-day access',
  },
];

/** The question the demo mic "hears" — typed out live, so the voice flow can
 *  be shown without the demo ever asking the browser for microphone access. */
const DICTATION_SCRIPT = 'What about the idle cash?';

const RULES = [
  {
    label: 'Auto-invest idle cash',
    note: 'Into your money-market fund',
    value: '≤ US$500',
    on: true,
  },
  { label: 'Keep a cash floor', note: 'Never swept below this', value: 'US$1,000', on: true },
  { label: 'FX spread guardrail', note: 'Holds transfers for review', value: '≤ 0.3%', on: true },
  {
    label: 'Require approval above',
    note: 'Bigger moves always ask you',
    value: 'US$1,000',
    on: true,
  },
];

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
  const [rules, setRules] = useState(RULES.map((r) => r.on));
  /** Approval cards live locally: pending → approved, or dismissed away. */
  const [cardState, setCardState] = useState<Record<string, 'pending' | 'approved'>>(
    Object.fromEntries(APPROVALS.map((a) => [a.id, 'pending'])),
  );
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** The simulated dictation: null when idle, else the transcript so far. */
  const [hearing, setHearing] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  function scrollLog() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function reply(key: string) {
    const text = REPLIES[key] ?? FALLBACK;
    setChat((c) => [...c, { role: 'agent', text }]);
    scrollLog();
  }

  function send(text: string, key?: string) {
    const t = text.trim();
    if (!t) return;
    setChat((c) => [...c, { role: 'user', text: t }]);
    setDraft('');
    scrollLog();
    setTimeout(() => reply(key ?? classify(t)), 500);
  }

  function approveCard(a: (typeof APPROVALS)[number]) {
    setCardState((s) => ({ ...s, [a.id]: 'approved' }));
    setChat((c) => [...c, { role: 'agent', text: a.confirm }]);
    scrollLog();
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
    scrollLog();
  }

  /** Voice, without a single browser permission: the demo types its sample
   *  question into the composer word by word, then sends it — the feel of the
   *  live dictation flow with nothing captured and nothing asked for. */
  function playDictation() {
    if (hearing !== null) return;
    const words = DICTATION_SCRIPT.split(' ');
    let i = 0;
    setHearing('');
    const tick = setInterval(() => {
      i += 1;
      const sofar = words.slice(0, i).join(' ');
      setHearing(sofar);
      setDraft(sofar);
      if (i >= words.length) {
        clearInterval(tick);
        setTimeout(() => {
          setHearing(null);
          setDraft('');
          send(DICTATION_SCRIPT, 'idle');
        }, 450);
      }
    }, 220);
  }

  const visibleCards = APPROVALS.filter((a) => !dismissed.includes(a.id));
  const pendingCount = visibleCards.filter((a) => cardState[a.id] === 'pending').length;

  return (
    <AppScreen active="agent" basePath="/demo">
      <PageHead
        eyebrow="It finds and checks investments for you. Nothing happens without your yes"
        title="Your Capital Agent"
      />

      {/* One quiet line, matching the live screen's header. */}
      <div className="-mt-2.5 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
        <span className="flex items-center gap-1.5 font-bold text-teal2">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          Live
        </span>
        {STATS.slice(0, 2).map((s) => (
          <span key={s.t}>
            · <b className={cn('font-mono', s.cls)}>{s.n}</b> {s.t}
          </span>
        ))}
      </div>

      <div className="g-agent">
        {/* Chat */}
        <Card className="agent-chat flex flex-col overflow-hidden">
          <div className="agent-chat__head flex items-center gap-3 border-b border-solid border-x-0 border-t-0 border-border px-5 py-[18px]">
            {/* Phone only (CSS): the chat owns the whole screen there. */}
            <Link
              href="/demo/home"
              aria-label="Back to dashboard"
              className="agent-chat__back h-10 w-10 flex-none place-items-center rounded-[12px] text-foreground hover:bg-muted"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </Link>
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-[#eafaf5]">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-base font-bold">CCN Capital Agent</div>
              <div className="flex items-center gap-1.5 text-[13px] text-dim">
                <span className="h-[7px] w-[7px] rounded-full bg-success" />
                Suitability-aware · acts on your approval
              </div>
            </div>
            <button
              type="button"
              aria-pressed={voice}
              onClick={() => setVoice((v) => !v)}
              className={cn(
                'inline-flex flex-none items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[13.5px] font-bold',
                voice ? 'bg-mint text-teal2' : 'bg-card text-dim',
              )}
            >
              {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              Voice {voice ? 'on' : 'off'}
            </button>
          </div>

          <div
            ref={logRef}
            aria-live="polite"
            aria-label="Conversation with your agent"
            className="agent-chat__log flex max-h-[440px] flex-col gap-3.5 overflow-y-auto px-5 py-[18px]"
          >
            {chat.map((m, i) =>
              m.role === 'agent' ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="flex max-w-[88%] items-start gap-2.5"
                >
                  <span className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-mint text-teal2">
                    <Sparkles className="h-[15px] w-[15px]" aria-hidden />
                  </span>
                  <div className="min-w-0 rounded-[4px_14px_14px_14px] bg-[#f4f0e7] dark:bg-white/[0.05] px-[15px] py-3 text-[14.5px] leading-relaxed text-[#2c2925] dark:text-foreground">
                    <ChatMarkdown text={m.text} />
                  </div>
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="max-w-[82%] self-end"
                >
                  <div className="rounded-[14px_4px_14px_14px] bg-primary px-[15px] py-3 text-[14.5px] leading-normal text-white">
                    {m.text}
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="agent-chat__composer px-5 pb-[18px]">
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
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s.key}
                  variant="outline"
                  size="sm"
                  className="rounded-[20px] font-semibold text-teal2"
                  onClick={() => send(s.label, s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-center gap-2 rounded-[14px] border border-border bg-card py-1.5 pl-3.5 pr-1.5"
            >
              <label htmlFor={inputId} className="sr-only">
                Ask your agent
              </label>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="off"
                placeholder="Ask anything about your money…"
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[15px] text-foreground outline-none placeholder:text-faint"
              />
              <Button
                type="button"
                variant={hearing !== null ? 'default' : 'secondary'}
                size="icon"
                aria-label="Voice input (plays a sample question)"
                aria-pressed={hearing !== null}
                onClick={playDictation}
                className="h-[38px] w-[38px] flex-none rounded-[10px]"
              >
                <Mic className={cn('h-[17px] w-[17px]', hearing !== null && 'animate-pulse')} />
              </Button>
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                className="h-[38px] w-[38px] flex-none rounded-[10px]"
              >
                <ArrowRight className="h-[18px] w-[18px]" />
              </Button>
            </form>
          </div>
        </Card>

        {/* Approvals + limits */}
        <div className="flex flex-col gap-[18px]">
          <Card className="p-5">
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
              <div
                key={a.id}
                className="mb-3 rounded-xl border border-border p-4"
                style={{ borderLeft: `3px solid ${a.accent}` }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant={a.variant}>{a.tag}</Badge>
                  <span className="text-[12.5px] text-faint">{a.when}</span>
                </div>
                <div className="mb-1.5 text-[15px] font-bold">{a.title}</div>
                <p className="mb-3 text-[13.5px] leading-normal text-dim">{a.body}</p>
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

          <Card className="p-5">
            <div className="mb-3.5 flex items-baseline justify-between gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Your limits &amp; rules</span>
              <span className="text-[12.5px] text-faint">what it may do alone</span>
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
                <span className="font-mono text-[13.5px] font-bold text-teal2">{r.value}</span>
                <Switch
                  checked={rules[i]}
                  onCheckedChange={() => setRules((rs) => rs.map((v, j) => (j === i ? !v : v)))}
                  aria-label={`${r.label} — ${rules[i] ? 'on' : 'off'}`}
                  className="flex-none"
                />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </AppScreen>
  );
}
