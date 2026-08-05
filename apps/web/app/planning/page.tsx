'use client';

import { AppScreen, PageHead } from '../_components/AppScreen';
import { C } from '../_lib/ui';

const STATUS: Record<string, { fg: string; bg: string }> = {
  Recommended: { fg: '#0a7c53', bg: '#e2f4ea' },
  Available: { fg: C.teal2, bg: C.mint },
  Explore: { fg: C.terra, bg: C.peachBg },
};

const PRODUCTS = [
  {
    code: 'LI',
    title: 'Life insurance',
    provider: 'Sagicor · Guardian Life',
    status: 'Recommended',
    desc: 'Term or whole-life cover priced for diaspora residents, protecting your family across borders.',
  },
  {
    code: 'RA',
    title: 'Retirement annuity',
    provider: 'NCB · JMMB',
    status: 'Recommended',
    desc: 'Tax-efficient retirement income — whether you retire abroad or return home to the region.',
  },
  {
    code: 'CI',
    title: 'Health & critical illness',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Cover medical costs at home and abroad, with critical-illness lump-sum protection.',
  },
  {
    code: 'ES',
    title: 'Estate planning',
    provider: 'CCN Legal Network',
    status: 'Explore',
    desc: 'Wills, trusts and cross-border succession so wealth transfers smoothly to the next generation.',
  },
  {
    code: 'MG',
    title: 'Diaspora mortgage',
    provider: 'NCB · Republic Bank',
    status: 'Available',
    desc: 'Finance property in the region with income earned abroad fully recognized.',
  },
  {
    code: 'ED',
    title: 'Education savings',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Ring-fenced, goal-linked savings that grow toward tuition with automated top-ups.',
  },
];

const GOALS = [
  {
    name: 'University fund',
    from: 'NCB · Sagicor',
    pct: 82,
    of: 'US$41,000 of US$50,000',
    eta: 'On track · mid-2028',
    color: '#17786e',
    etaColor: C.teal2,
  },
  {
    name: 'Retirement',
    from: 'Sagicor · Proven',
    pct: 24,
    of: 'US$118,000 of US$500,000',
    eta: 'Projected 2044',
    color: C.terra,
    etaColor: C.terra,
  },
  {
    name: 'Emergency fund',
    from: 'JMMB',
    pct: 100,
    of: 'US$15,000 of US$15,000',
    eta: 'Complete',
    color: C.green,
    etaColor: C.green,
  },
];

const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 } as const;

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 26;
  const cir = 2 * Math.PI * r;
  const on = (pct / 100) * cir;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" stroke={C.line} strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${on} ${cir - on}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill={C.ink}
        fontFamily={C.body}
      >
        {pct}%
      </text>
    </svg>
  );
}

export default function PlanningPage() {
  return (
    <AppScreen active="planning">
      <PageHead
        eyebrow="Cover, retirement, property and legacy planning across borders"
        title="Planning"
      />

      <div className="g3">
        <div style={{ background: C.teal, borderRadius: 16, padding: 20, color: C.tealInk }}>
          <div style={{ fontSize: 13.5, opacity: 0.8 }}>Financial health</div>
          <div style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 30, margin: '6px 0 4px' }}>
            72 / 100
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#9fe6c6' }}>Good · on track</div>
        </div>
        {[
          {
            label: 'Protection gap',
            val: 'US$120,000',
            valColor: C.terra,
            sub: 'Recommended life cover',
          },
          {
            label: 'Est. legacy value',
            val: 'US$310,000',
            valColor: C.ink,
            sub: 'Projected at retirement',
          },
        ].map((s) => (
          <div key={s.label} style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 13.5, color: C.dim }}>{s.label}</div>
            <div
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 30,
                color: s.valColor,
                margin: '6px 0 4px',
              }}
            >
              {s.val}
            </div>
            <div style={{ fontSize: 13.5, color: C.faint }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 22, margin: '28px 0 14px' }}>
        Recommended for you
      </h2>
      <div className="g2">
        {PRODUCTS.map((p) => {
          const st = STATUS[p.status] ?? STATUS.Available;
          return (
            <div key={p.code} style={{ ...card, padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: C.mint,
                    color: C.teal2,
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: C.mono,
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {p.code}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{p.title}</div>
                  <div style={{ fontSize: 13, color: C.faint }}>{p.provider}</div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: st?.fg,
                    background: st?.bg,
                    padding: '4px 10px',
                    borderRadius: 7,
                  }}
                >
                  {p.status}
                </span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: C.dim, margin: '0 0 16px' }}>
                {p.desc}
              </p>
              <button
                type="button"
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 11,
                  border: `1px solid ${C.line}`,
                  background: C.mint,
                  color: C.teal2,
                  fontFamily: C.body,
                  fontWeight: 700,
                  fontSize: 14.5,
                  cursor: 'pointer',
                }}
              >
                Explore with agent
              </button>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 22, margin: '28px 0 14px' }}>
        Your goals
      </h2>
      <div className="g3">
        {GOALS.map((g) => (
          <div key={g.name} style={{ ...card, padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <Ring pct={g.pct} color={g.color} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{g.name}</div>
                <div style={{ fontSize: 13, color: C.faint }}>{g.from}</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <div style={{ fontFamily: C.mono, fontSize: 14 }}>{g.of}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: g.etaColor, marginTop: 4 }}>
                {g.eta}
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppScreen>
  );
}
