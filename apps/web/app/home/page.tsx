'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AppSidebar } from '../_components/AppSidebar';
import { C, Icon, icons } from '../_lib/ui';

const PIPE = [
  { n: '1', t: 'Research', b: 'Scans 47 instruments across 8 partners', flag: false },
  { n: '2', t: 'Suitability', b: 'Matches your balanced-income risk band', flag: false },
  { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds checks', flag: false },
  { n: '4', t: 'Your approval', b: 'You confirm every move above your limits', flag: true },
  { n: '5', t: 'Execute', b: 'Routed to the licensed partner, then monitored', flag: false },
];

const ACTED = [
  {
    dot: C.green,
    t: 'Swept US$400 of idle cash into the NCB Money Market Fund',
    s: 'Inside your US$500 auto-invest limit · 2 days ago',
  },
  {
    dot: C.green,
    t: 'Reinvested a US$388 GOJ coupon after you approved it',
    s: 'Human-in-the-loop · Last week',
  },
  {
    dot: C.terra,
    t: 'Paused a JMD transfer. FX spread was 0.4% above your rule',
    s: 'Held for your review · Last week',
  },
];

const APPROVALS = [
  { tag: 'Reinvest', tagColor: C.teal, title: 'Put your GOJ coupon to work', when: 'Today' },
  { tag: 'Idle cash', tagColor: C.terra, title: 'US$2,150 earning nothing', when: '2d ago' },
];

const HELD = [
  {
    code: 'NCB',
    name: 'National Commercial Bank',
    sub: 'GOJ Bond 2029 · Chequing',
    amt: 'US$13,400',
    tint: '#e7edf8',
    color: '#1a4aa0',
  },
  {
    code: 'SAG',
    name: 'Sagicor Investments',
    sub: 'Sigma Global Fund',
    amt: 'US$8,200',
    tint: '#e6f2ea',
    color: '#1f7a44',
  },
  {
    code: 'PRV',
    name: 'Proven Wealth',
    sub: 'USD Income Fund',
    amt: 'US$5,600',
    tint: '#f6efe0',
    color: '#9a6a1e',
  },
  {
    code: 'JMMB',
    name: 'JMMB Group',
    sub: 'Money Market · Savings',
    amt: 'US$4,150',
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

const cardBox = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 } as const;
const uppr = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
} as const;

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
  const [cur, setCur] = useState<'USD' | 'JMD' | 'TTD'>('USD');

  return (
    <div className="app-shell" style={{ background: C.bg, color: C.ink, fontFamily: C.body }}>
      <AppSidebar active="home" />
      <main style={{ flex: 1, minWidth: 0, padding: '26px 32px 96px', position: 'relative' }}>
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 4 }}>Saturday, July 18</div>
            <h1
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: '-.4px',
                margin: 0,
              }}
            >
              Good afternoon, Marcus
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 10,
                padding: 3,
              }}
            >
              {(['USD', 'JMD', 'TTD'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={cur === c}
                  onClick={() => setCur(c)}
                  style={{
                    padding: '7px 13px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: C.mono,
                    fontWeight: 600,
                    fontSize: 13,
                    background: cur === c ? C.teal : 'transparent',
                    color: cur === c ? '#fff' : C.dim,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Notifications"
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: C.card,
                border: `1px solid ${C.line}`,
                display: 'grid',
                placeItems: 'center',
                color: C.dim,
                cursor: 'pointer',
              }}
            >
              <Icon path={icons.bell} size={19} />
            </button>
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: C.teal,
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
              }}
            >
              MB
            </span>
          </div>
        </div>

        {/* Hero card */}
        <div
          className="g-hero"
          style={{ background: C.teal, borderRadius: 20, padding: 28, color: C.tealInk }}
        >
          <div>
            <div style={{ ...uppr, color: 'rgba(234,250,245,.66)' }}>
              Total net worth · 4 licensed partners
            </div>
            <div
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 52,
                lineHeight: 1,
                letterSpacing: '-1.5px',
                margin: '10px 0 12px',
              }}
            >
              US$31,350
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'rgba(234,250,245,.82)',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  background: 'rgba(255,255,255,.12)',
                  color: '#9fe6c6',
                  padding: '3px 9px',
                  borderRadius: 7,
                  fontFamily: C.mono,
                  fontWeight: 700,
                }}
              >
                ↑ 6.8%
              </span>
              +US$1,994 all-time · 47 holdings · yield 6.2%
            </div>
            <svg
              width="100%"
              height="64"
              viewBox="0 0 420 64"
              preserveAspectRatio="none"
              style={{ marginTop: 16 }}
              aria-hidden="true"
            >
              <polyline
                points="0,52 40,48 80,50 120,40 160,44 200,32 240,36 280,24 320,26 360,16 420,10"
                fill="none"
                stroke="rgba(159,230,198,.75)"
                strokeWidth="2.5"
              />
            </svg>
          </div>
          <div style={{ borderLeft: '1px solid rgba(234,250,245,.16)', paddingLeft: 26 }}>
            <div
              style={{
                ...uppr,
                color: 'rgba(234,250,245,.66)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.peach }} />
              Your agent · acting within your limits
            </div>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.5,
                color: '#fff',
                margin: '12px 0 18px',
                fontWeight: 500,
              }}
            >
              This week I matched <b style={{ color: C.gold }}>6 opportunities</b>, swept{' '}
              <b style={{ color: C.gold }}>US$400</b> of idle cash inside your limit, and prepared{' '}
              <b style={{ color: C.gold }}>2 actions</b> for your approval.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link
                href="/agent"
                style={{
                  padding: '11px 18px',
                  borderRadius: 11,
                  background: C.peach,
                  color: '#3a2415',
                  fontWeight: 700,
                  fontSize: 14.5,
                  textDecoration: 'none',
                }}
              >
                Review 2 approvals
              </Link>
              <Link
                href="/opportunities"
                style={{
                  padding: '11px 18px',
                  borderRadius: 11,
                  background: 'transparent',
                  color: '#fff',
                  border: '1px solid rgba(234,250,245,.3)',
                  fontWeight: 700,
                  fontSize: 14.5,
                  textDecoration: 'none',
                }}
              >
                Opportunities
              </Link>
            </div>
          </div>
        </div>

        {/* How your agent works */}
        <section style={{ ...cardBox, padding: 22, marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ ...uppr, color: C.ink }}>How your agent works</span>
            <span style={{ fontSize: 14, color: C.dim }}>
              Every action is researched, screened and checked, then brought to you
            </span>
          </div>
          <div className="g5">
            {PIPE.map((s) => (
              <div
                key={s.n}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: `1px solid ${s.flag ? C.peachLine : C.line}`,
                  background: s.flag ? C.peachBg : C.card2,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: 'grid',
                      placeItems: 'center',
                      background: s.flag ? '#f0d3bd' : C.mint,
                      color: s.flag ? '#b4531f' : C.teal2,
                      fontFamily: C.mono,
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {s.n}
                  </span>
                  <b style={{ fontSize: 14.5 }}>{s.t}</b>
                </div>
                <div style={{ fontSize: 13, color: s.flag ? '#8a5a3e' : C.dim, lineHeight: 1.45 }}>
                  {s.b}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Acted / Approvals */}
        <div className="g2" style={{ marginTop: 18 }}>
          <section style={{ ...cardBox, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ ...uppr, color: C.ink }}>Acted on your behalf</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.teal2,
                  background: C.mint,
                  padding: '3px 9px',
                  borderRadius: 7,
                }}
              >
                within your limits
              </span>
            </div>
            {ACTED.map((a) => (
              <div key={a.t} style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: a.dot,
                    flex: 'none',
                    marginTop: 6,
                  }}
                />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.4 }}>{a.t}</div>
                  <div style={{ fontSize: 12.5, color: C.faint, marginTop: 2 }}>{a.s}</div>
                </div>
              </div>
            ))}
            <Link
              href="/agent"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: 12,
                borderRadius: 11,
                border: `1px solid ${C.line}`,
                color: C.teal2,
                fontWeight: 700,
                fontSize: 14.5,
                textDecoration: 'none',
                marginTop: 6,
              }}
            >
              Adjust your agent's limits
            </Link>
          </section>

          <section style={{ ...cardBox, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
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
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{a.title}</div>
                <Link
                  href="/agent"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: 11,
                    borderRadius: 10,
                    background: C.teal,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: 'none',
                  }}
                >
                  Review &amp; approve
                </Link>
              </div>
            ))}
          </section>
        </div>

        {/* Stat cards */}
        <div className="g3" style={{ marginTop: 18 }}>
          {[
            {
              label: 'Tracked across partners',
              icon: icons.portfolio,
              val: 'US$31,350',
              valColor: C.ink,
              sub: '47 holdings · 4 institutions · live',
            },
            {
              label: 'Blended yield',
              icon: icons.opportunities,
              val: '6.2%',
              valColor: C.green,
              sub: '≈ US$1,940 income / year',
            },
            {
              label: 'Matched to your goals',
              icon: icons.agent,
              val: '6',
              valColor: C.ink,
              sub: '2 ready for your approval →',
              subColor: C.terra,
            },
          ].map((s) => (
            <div key={s.label} style={{ ...cardBox, padding: 20 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 14, color: C.dim }}>{s.label}</span>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: C.mint,
                    display: 'grid',
                    placeItems: 'center',
                    color: C.teal2,
                  }}
                >
                  <Icon path={s.icon} size={18} />
                </span>
              </div>
              <div
                style={{
                  fontFamily: C.disp,
                  fontWeight: 700,
                  fontSize: 30,
                  color: s.valColor,
                  letterSpacing: '-.5px',
                }}
              >
                {s.val}
              </div>
              <div
                style={{
                  fontSize: 13.5,
                  color: s.subColor ?? C.faint,
                  marginTop: 4,
                  fontWeight: s.subColor ? 700 : 400,
                }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Held / Allocation */}
        <div className="g-held" style={{ marginTop: 18 }}>
          <section style={{ ...cardBox, padding: 22 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <b style={{ fontFamily: C.disp, fontSize: 18 }}>Held across partners</b>
              <Link
                href="/portfolio"
                style={{ color: C.teal2, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
              >
                View portfolio →
              </Link>
            </div>
            {HELD.map((h) => (
              <div
                key={h.code}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 0',
                  borderTop: `1px solid ${C.line}`,
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: h.tint,
                    color: h.color,
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: C.mono,
                    fontWeight: 700,
                    fontSize: 12,
                    flex: 'none',
                  }}
                >
                  {h.code}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{h.name}</div>
                  <div style={{ fontSize: 12.5, color: C.faint }}>{h.sub}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 14 }}>{h.amt}</div>
                  <div style={{ fontSize: 11.5, color: C.green }}>· FSC-regulated</div>
                </div>
              </div>
            ))}
          </section>

          <section style={{ ...cardBox, padding: 22 }}>
            <b style={{ fontFamily: C.disp, fontSize: 18 }}>Allocation</b>
            <div style={{ fontSize: 13, color: C.faint, marginBottom: 8 }}>
              Blended across all 4 partners
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <Donut />
              <div style={{ flex: 1 }}>
                {ALLOC.map((a) => (
                  <div
                    key={a.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 7,
                      fontSize: 13.5,
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: a.color,
                        flex: 'none',
                      }}
                    />
                    <span style={{ flex: 1, color: C.dim }}>{a.label}</span>
                    <b style={{ fontFamily: C.mono, fontSize: 13 }}>{a.pct}%</b>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Ask CCN */}
        <button
          type="button"
          style={{
            position: 'fixed',
            right: 30,
            bottom: 26,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            padding: '13px 20px',
            borderRadius: 999,
            background: C.teal,
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 12px 30px rgba(18,78,72,.4)',
            fontFamily: C.body,
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          <Icon path={icons.mic} size={18} />
          Ask CCN
        </button>
      </main>
    </div>
  );
}
