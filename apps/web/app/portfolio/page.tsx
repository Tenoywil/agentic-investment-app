'use client';

import { AppScreen, PageHead } from '../_components/AppScreen';
import { C, Icon, icons } from '../_lib/ui';

const INSTITUTIONS = [
  {
    code: 'NCB',
    name: 'National Commercial Bank',
    kind: 'Bank · Capital Markets',
    total: 'US$13,400',
    tint: '#e7edf8',
    color: '#1a4aa0',
    holdings: [
      { name: 'GOJ USD Global Bond 2029', value: 'US$12,400', ret: '+6.8%' },
      { name: 'USD Chequing', value: 'US$1,000', ret: '—' },
    ],
  },
  {
    code: 'SAG',
    name: 'Sagicor Investments',
    kind: 'Funds · Insurance',
    total: 'US$8,200',
    tint: '#e6f2ea',
    color: '#1f7a44',
    holdings: [{ name: 'Sagicor Sigma Global Fund', value: 'US$8,200', ret: '+4.1%' }],
  },
  {
    code: 'PRV',
    name: 'Proven Wealth',
    kind: 'Wealth Management',
    total: 'US$5,600',
    tint: '#f6efe0',
    color: '#9a6a1e',
    holdings: [{ name: 'Proven USD Income Fund', value: 'US$5,600', ret: '+5.9%' }],
  },
  {
    code: 'JMMB',
    name: 'JMMB Group',
    kind: 'Bank · Money Market',
    total: 'US$4,150',
    tint: '#fae8e6',
    color: '#c4362b',
    holdings: [
      { name: 'JMMB Money Market Fund', value: 'US$3,000', ret: '+2.0%' },
      { name: 'USD Savings', value: 'US$1,150', ret: '—' },
    ],
  },
];

export default function PortfolioPage() {
  return (
    <AppScreen active="portfolio">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          <div
            style={{
              background: C.mint,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
            }}
          >
            <b style={{ fontFamily: C.disp, fontSize: 20 }}>US$31,350</b>
            <span style={{ fontSize: 12.5, color: C.dim }}>
              total
              <br />
              net worth
            </span>
          </div>
        }
      />

      <div className="g2">
        {INSTITUTIONS.map((inst) => (
          <div
            key={inst.code}
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              padding: 22,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: inst.tint,
                  color: inst.color,
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: C.mono,
                  fontWeight: 700,
                  fontSize: 12,
                  flex: 'none',
                }}
              >
                {inst.code}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{inst.name}</div>
                <div style={{ fontSize: 12.5, color: C.faint }}>{inst.kind}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 15 }}>
                  {inst.total}
                </div>
                <div style={{ fontSize: 11.5, color: C.green }}>· FSC-regulated</div>
              </div>
            </div>
            {inst.holdings.map((h) => (
              <div
                key={h.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '11px 0',
                  borderTop: `1px solid ${C.line}`,
                }}
              >
                <span style={{ fontSize: 14 }}>{h.name}</span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <b style={{ fontFamily: C.mono, fontSize: 13.5 }}>{h.value}</b>
                  <span
                    style={{
                      fontSize: 13,
                      color: h.ret === '—' ? C.faint : C.green,
                      minWidth: 42,
                      textAlign: 'right',
                    }}
                  >
                    {h.ret}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          marginTop: 18,
          background: C.mint,
          border: `1px solid ${C.line}`,
          borderRadius: 16,
          padding: '18px 22px',
        }}
      >
        <span style={{ color: C.teal2, marginTop: 2 }}>
          <Icon path={icons.planning} size={22} />
        </span>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: C.dim }}>
          <b style={{ color: C.ink }}>Held at licensed, FSC-regulated partners.</b> Every instrument
          is custodied and executed by a regulated institution. Your agent coordinates and monitors;
          you approve every move.
        </p>
      </div>
    </AppScreen>
  );
}
