'use client';

import { type ReactNode, useId, useRef, useState } from 'react';
import { AppScreen, PageHead } from '../_components/AppScreen';
import { C, Icon, icons } from '../_lib/ui';

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

/** Render the seeded messages' <b>…</b> emphasis without dangerouslySetInnerHTML. */
function renderRich(text: string): ReactNode {
  return text.split(/(<b>.*?<\/b>)/g).map((part, i) => {
    if (part.startsWith('<b>')) {
      // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable segments
      return <strong key={i}>{part.slice(3, -4)}</strong>;
    }
    return part;
  });
}

const APPROVALS = [
  {
    tag: 'Reinvest',
    tagColor: C.teal2,
    when: 'Today',
    title: 'Put your GOJ coupon to work',
    body: 'US$412 settles Friday. Reinvesting into the Real Estate X Fund lifts your blended yield to 6.9%.',
    cta: 'Review deal',
  },
  {
    tag: 'Idle cash',
    tagColor: C.terra,
    when: '2d ago',
    title: 'US$2,150 earning nothing',
    body: 'Sweep your USD cash into the NCB Money Market Fund for ~US$110/yr with same-day access.',
    cta: 'Move cash',
  },
];

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

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 } as const;
const uppr = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
} as const;

export default function AgentPage() {
  const [chat, setChat] = useState<Msg[]>(SEED);
  const [draft, setDraft] = useState('');
  const [voice, setVoice] = useState(false);
  const [rules, setRules] = useState(RULES.map((r) => r.on));
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  function reply(key: string) {
    const text = REPLIES[key] ?? FALLBACK;
    setChat((c) => [...c, { role: 'agent', text }]);
    // keep the newest message in view
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function send(text: string, key?: string) {
    const t = text.trim();
    if (!t) return;
    setChat((c) => [...c, { role: 'user', text: t }]);
    setDraft('');
    setTimeout(() => reply(key ?? classify(t)), 500);
  }

  return (
    <AppScreen active="agent">
      <PageHead
        eyebrow="Discovers, screens and coordinates execution, always on your approval"
        title="Your Capital Agent"
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          margin: '-10px 0 8px',
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, color: C.dim }}>
          {[
            { n: '47', c: C.ink, t: 'instruments monitored' },
            { n: '8', c: C.teal2, t: 'licensed partners' },
            { n: '6', c: C.terra, t: 'matched to goals' },
            { n: '11', c: C.green, t: 'actions this month' },
          ].map((s) => (
            <span key={s.t}>
              <b style={{ color: s.c, fontFamily: C.mono }}>{s.n}</b> {s.t}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: C.mint,
          color: C.teal2,
          borderRadius: 999,
          padding: '6px 13px',
          fontSize: 13.5,
          fontWeight: 700,
          marginBottom: 18,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.green }} />
        Live · monitoring the region
      </div>

      <div className="g-agent">
        {/* Chat */}
        <section style={{ ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '18px 20px',
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: C.teal,
                color: C.tealInk,
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              <Icon path={icons.agent} size={20} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 16 }}>
                CCN Capital Agent
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: C.dim,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />
                Suitability-aware · acts on your approval
              </div>
            </div>
            <button
              type="button"
              aria-pressed={voice}
              onClick={() => setVoice((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 13px',
                borderRadius: 10,
                border: `1px solid ${C.line}`,
                background: voice ? C.mint : C.card,
                color: voice ? C.teal2 : C.dim,
                fontFamily: C.body,
                fontWeight: 700,
                fontSize: 13.5,
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                aria-hidden="true"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                {voice ? (
                  <path d="M15.5 8.5a5 5 0 010 7M19 5a9 9 0 010 14" />
                ) : (
                  <path d="M22 9l-6 6M16 9l6 6" />
                )}
              </svg>
              Voice {voice ? 'on' : 'off'}
            </button>
          </div>

          <div
            ref={logRef}
            aria-live="polite"
            aria-label="Conversation with your agent"
            style={{
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxHeight: 440,
              overflowY: 'auto',
            }}
          >
            {chat.map((m, i) =>
              m.role === 'agent' ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '88%' }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: C.mint,
                      color: C.teal2,
                      display: 'grid',
                      placeItems: 'center',
                      flex: 'none',
                      marginTop: 2,
                    }}
                  >
                    <Icon path={icons.agent} size={15} />
                  </span>
                  <div
                    style={{
                      background: '#f4f0e7',
                      borderRadius: '4px 14px 14px 14px',
                      padding: '12px 15px',
                      fontSize: 14.5,
                      lineHeight: 1.55,
                      color: '#2c2925',
                    }}
                  >
                    {renderRich(m.text)}
                  </div>
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  style={{ alignSelf: 'flex-end', maxWidth: '82%' }}
                >
                  <div
                    style={{
                      background: C.teal,
                      color: '#fff',
                      borderRadius: '14px 4px 14px 14px',
                      padding: '12px 15px',
                      fontSize: 14.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {renderRich(m.text)}
                  </div>
                </div>
              ),
            )}
          </div>

          <div style={{ padding: '0 20px 18px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => send(s.label, s.key)}
                  style={{
                    fontSize: 14,
                    padding: '8px 14px',
                    borderRadius: 20,
                    border: `1px solid ${C.line}`,
                    background: C.card,
                    color: C.teal2,
                    fontFamily: C.body,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${C.line}`,
                borderRadius: 14,
                background: C.card,
                padding: '6px 6px 6px 14px',
              }}
            >
              <label htmlFor={inputId} className="sr-only">
                Ask your agent
              </label>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask your agent about income, rebalancing, or a specific deal…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontFamily: C.body,
                  fontSize: 15,
                  color: C.ink,
                }}
              />
              <button
                type="button"
                aria-label="Voice input"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: 'none',
                  background: C.mint,
                  color: C.teal2,
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                }}
              >
                <Icon path={icons.mic} size={17} />
              </button>
              <button
                type="submit"
                aria-label="Send message"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  border: 'none',
                  background: C.teal,
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </form>
          </div>
        </section>

        {/* Approvals + limits */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section style={{ ...card, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ ...uppr, color: C.ink }}>Needs your approval</span>
              <span
                style={{
                  minWidth: 22,
                  textAlign: 'center',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: C.terra,
                  background: C.peachBg,
                  padding: '1px 8px',
                  borderRadius: 999,
                }}
              >
                2
              </span>
            </div>
            {APPROVALS.map((a) => (
              <div
                key={a.title}
                style={{
                  border: `1px solid ${C.line}`,
                  borderLeft: `3px solid ${a.tagColor}`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '.5px',
                      textTransform: 'uppercase',
                      color: a.tagColor,
                      background: `${a.tagColor}14`,
                      padding: '3px 9px',
                      borderRadius: 6,
                    }}
                  >
                    {a.tag}
                  </span>
                  <span style={{ fontSize: 12.5, color: C.faint }}>{a.when}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{a.title}</div>
                <p style={{ margin: '0 0 12px', fontSize: 13.5, lineHeight: 1.5, color: C.dim }}>
                  {a.body}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: 10,
                      borderRadius: 10,
                      border: 'none',
                      background: C.teal,
                      color: '#fff',
                      fontFamily: C.body,
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {a.cta}
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '10px 16px',
                      borderRadius: 10,
                      border: `1px solid ${C.line}`,
                      background: C.card,
                      color: C.dim,
                      fontFamily: C.body,
                      fontWeight: 700,
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section style={{ ...card, padding: 20 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <span style={{ ...uppr, color: C.ink }}>Your limits &amp; rules</span>
              <span style={{ fontSize: 12.5, color: C.faint }}>what it may do alone</span>
            </div>
            {RULES.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{r.label}</div>
                  <div style={{ fontSize: 12.5, color: C.faint }}>{r.note}</div>
                </div>
                <span
                  style={{ fontFamily: C.mono, fontSize: 13.5, fontWeight: 700, color: C.teal2 }}
                >
                  {r.value}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rules[i]}
                  aria-label={`${r.label} — ${rules[i] ? 'on' : 'off'}`}
                  onClick={() => setRules((rs) => rs.map((v, j) => (j === i ? !v : v)))}
                  style={{
                    width: 44,
                    height: 26,
                    borderRadius: 999,
                    border: 'none',
                    background: rules[i] ? C.teal : '#cfc8b8',
                    position: 'relative',
                    cursor: 'pointer',
                    flex: 'none',
                    transition: 'background .15s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: rules[i] ? 21 : 3,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left .15s',
                    }}
                  />
                </button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </AppScreen>
  );
}
