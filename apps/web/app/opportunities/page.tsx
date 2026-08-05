'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AppScreen, PageHead } from '../_components/AppScreen';
import { C } from '../_lib/ui';

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
const RISK: Record<string, { fg: string; bg: string }> = {
  Low: { fg: '#0a6e44', bg: '#e2f4ea' },
  Medium: { fg: '#7a5712', bg: '#f6efdf' },
  High: { fg: '#a44e20', bg: '#f5e7d9' },
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
    partner: 'Sagicor',
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
      'Matches your income + growth blend. I’d cap this at 15% of your portfolio to keep real-estate concentration in range.',
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
      'Adds equity growth you’re currently light on. Higher volatility than your bonds — sizing matters.',
  },
  {
    id: 'provfd',
    abbr: 'PWF',
    type: 'Fund',
    partner: 'Proven Wealth',
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
      'You already hold this. Topping up would concentrate credit exposure — consider the GOJ bond instead for diversification.',
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
    desc: 'A private credit note providing senior secured financing to mid-market Caribbean firms. Higher return for reduced liquidity — capital is locked for the term.',
    agentNote:
      'Unlocked by your source-of-funds verification. Illiquid — only suitable for capital you won’t need for 3 years.',
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
      'Time-sensitive — the rights window closes in 9 days. Discount is attractive but adds financial-sector concentration.',
  },
  {
    id: 'ncbmm',
    abbr: 'MMF',
    type: 'Fund',
    partner: 'NCB',
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
const BLOCKED = OPPS.find((o) => o.blocked) as Opp;
const FILTERS: (Kind | 'All')[] = ['All', 'Bond', 'Fund', 'Equity', 'Real Estate', 'Private'];
const minValue = (o: Opp) => Number.parseInt(o.min.replace(/[^0-9]/g, ''), 10) || 0;

function chipStyle(active: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 17px',
    borderRadius: 22,
    border: `1px solid ${active ? C.teal : '#ddd6c8'}`,
    background: active ? C.teal : C.card,
    color: active ? '#fff' : C.dim,
    fontFamily: C.body,
    fontWeight: 600,
    fontSize: 14.5,
    cursor: 'pointer',
  } as const;
}

const metricBox = { background: '#f4f0e7', borderRadius: 12, padding: '13px 15px' } as const;
const metricLbl = {
  fontSize: 11.5,
  letterSpacing: '.4px',
  textTransform: 'uppercase',
  color: '#6d6455',
  marginBottom: 5,
} as const;

function OppCard({ o, onOpen }: { o: Opp; onOpen: (o: Opp) => void }) {
  const t = TONE[o.type];
  const r = RISK[o.risk];
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderLeft: `4px solid ${t.ink}`,
        borderRadius: 16,
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: t.tint,
            color: t.ink,
            display: 'grid',
            placeItems: 'center',
            fontFamily: C.mono,
            fontWeight: 700,
            fontSize: 12,
            flex: 'none',
          }}
        >
          {o.abbr}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: '.6px',
              textTransform: 'uppercase',
              color: t.ink,
            }}
          >
            {o.type}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '2px 9px',
              borderRadius: 6,
              color: r?.fg,
              background: r?.bg,
            }}
          >
            {o.risk} risk
          </span>
        </div>
      </div>
      <div style={{ fontSize: 13, color: C.faint, marginBottom: 4 }}>{o.region}</div>
      <div
        style={{
          fontFamily: C.disp,
          fontWeight: 700,
          fontSize: 18,
          lineHeight: 1.25,
          marginBottom: 14,
        }}
      >
        {o.name}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginBottom: 14 }}>
        <div style={metricBox}>
          <div style={metricLbl}>{o.metricLabel}</div>
          <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: '#0a6e44' }}>
            {o.metric}
          </div>
        </div>
        <div style={metricBox}>
          <div style={metricLbl}>Minimum</div>
          <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: C.ink }}>
            {o.min}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: C.dim,
          marginBottom: 16,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: `1.6px solid ${C.teal2}`,
            flex: 'none',
          }}
        />
        {o.partner} · {o.regulator}
      </div>
      <button
        type="button"
        onClick={() => onOpen(o)}
        style={{
          marginTop: 'auto',
          width: '100%',
          padding: 13,
          borderRadius: 12,
          border: 'none',
          background: C.teal,
          color: '#fff',
          fontFamily: C.body,
          fontWeight: 700,
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        Review &amp; invest
      </button>
    </div>
  );
}

function ExecDialog({ opp, onClose }: { opp: Opp | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [step, setStep] = useState(0);
  const [amt, setAmt] = useState('');

  // Open/close the native dialog in step with the selected opportunity.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (opp) {
      setStep(0);
      setAmt(String(minValue(opp)));
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [opp]);

  if (!opp) return null;
  const t = TONE[opp.type];
  const blocked = !!opp.blocked;
  const amtNum = Number.parseInt(amt.replace(/[^0-9]/g, ''), 10) || 0;
  const amtFmt = `US$${amtNum.toLocaleString('en-US')}`;

  return (
    <dialog ref={ref} className="ccn-modal" aria-labelledby={titleId} onClose={onClose}>
      <div style={{ fontFamily: C.body, color: C.ink }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 13,
            padding: '20px 22px',
            borderBottom: '1px solid #ece6da',
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: t.tint,
              color: t.ink,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 14,
              fontFamily: C.mono,
              flex: 'none',
            }}
          >
            {opp.abbr}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: '.4px',
                textTransform: 'uppercase',
                color: '#6d6455',
              }}
            >
              {blocked ? 'Screened out' : opp.type}
            </div>
            <div
              id={titleId}
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 18,
                lineHeight: 1.25,
                marginTop: 3,
              }}
            >
              {opp.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              border: 'none',
              borderRadius: 9,
              background: '#ece6da',
              color: '#6b6459',
              cursor: 'pointer',
              fontSize: 16,
              flex: 'none',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {step === 0 && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 11,
                  marginBottom: 18,
                }}
              >
                <div style={metricBox}>
                  <div style={metricLbl}>{opp.metricLabel}</div>
                  <div
                    style={{ fontFamily: C.mono, fontSize: 21, fontWeight: 700, color: '#0a6e44' }}
                  >
                    {opp.metric}
                  </div>
                </div>
                <div style={metricBox}>
                  <div style={metricLbl}>Minimum</div>
                  <div style={{ fontFamily: C.mono, fontSize: 21, fontWeight: 700, color: C.ink }}>
                    {opp.min}
                  </div>
                </div>
                <div style={metricBox}>
                  <div style={metricLbl}>Term</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{opp.term}</div>
                </div>
                <div style={metricBox}>
                  <div style={metricLbl}>Risk rating</div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{opp.risk}</div>
                </div>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 15, lineHeight: 1.6, color: C.dim }}>
                {opp.desc}
              </p>

              {blocked ? (
                <div
                  style={{
                    background: '#fbeee7',
                    border: '1px solid #ecd2c2',
                    borderRadius: 12,
                    padding: '15px 17px',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#a44e20"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v5M12 16.5v.5" />
                    </svg>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '.5px',
                        textTransform: 'uppercase',
                        color: '#9a4a1c',
                      }}
                    >
                      Your agent recommends against this
                    </span>
                  </div>
                  <p
                    style={{ margin: '0 0 11px', fontSize: 14, lineHeight: 1.55, color: '#5c4636' }}
                  >
                    {opp.agentNote}
                  </p>
                  {opp.blockReasons?.map((reason) => (
                    <div
                      key={reason}
                      style={{
                        display: 'flex',
                        gap: 9,
                        padding: '6px 0',
                        fontSize: 13.5,
                        lineHeight: 1.45,
                        color: '#5c4636',
                        borderTop: '1px solid #f0dfd2',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{ color: '#a44e20', fontWeight: 700, flex: 'none' }}
                      >
                        ×
                      </span>
                      <span>{reason}</span>
                    </div>
                  ))}
                  <div
                    style={{ marginTop: 11, fontSize: 12.5, color: '#8a6a50', lineHeight: 1.45 }}
                  >
                    The agent will not route this order. If your goals or limits change, re-run
                    suitability from your profile and it will reassess.
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: C.mint,
                    border: '1px solid #cde0d8',
                    borderRadius: 12,
                    padding: '14px 16px',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={C.teal2}
                      strokeWidth="1.9"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="8.5" />
                      <circle cx="12" cy="12" r="2.2" fill={C.teal2} stroke="none" />
                    </svg>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal2 }}>
                      Agent assessment
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#2c2925' }}>
                    {opp.agentNote}
                  </p>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13.5,
                  color: C.dim,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0a6e44"
                  strokeWidth="1.9"
                  aria-hidden="true"
                >
                  <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
                </svg>
                Executed by {opp.partner} · Regulated by {opp.regulator}
              </div>
            </>
          )}

          {step === 1 && !blocked && (
            <>
              <div
                style={{
                  fontSize: 12.5,
                  letterSpacing: '.5px',
                  textTransform: 'uppercase',
                  color: C.teal2,
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                Review &amp; authorize
              </div>
              <div
                style={{
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '13px 16px',
                    borderBottom: '1px solid #ece6da',
                  }}
                >
                  <span style={{ fontSize: 14, color: C.dim }}>Instrument</span>
                  <span
                    style={{ fontSize: 14, fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}
                  >
                    {opp.name}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '13px 16px',
                    borderBottom: '1px solid #ece6da',
                  }}
                >
                  <label
                    htmlFor={`${titleId}-amt`}
                    style={{ fontSize: 14, color: C.dim, paddingTop: 9 }}
                  >
                    Amount
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        border: '1.5px solid #cde0d8',
                        borderRadius: 9,
                        background: C.card,
                        padding: '6px 11px',
                      }}
                    >
                      <span
                        style={{ fontFamily: C.mono, fontSize: 14, fontWeight: 700, color: C.dim }}
                      >
                        US$
                      </span>
                      <input
                        id={`${titleId}-amt`}
                        value={amt}
                        onChange={(e) => setAmt(e.target.value)}
                        inputMode="numeric"
                        style={{
                          width: 90,
                          border: 'none',
                          background: 'transparent',
                          outline: 'none',
                          fontFamily: C.mono,
                          fontSize: 16,
                          fontWeight: 700,
                          color: C.ink,
                          textAlign: 'right',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12.5, color: C.faint }}>
                      Minimum {opp.min} · from your USD wallet
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '13px 16px',
                    borderBottom: '1px solid #ece6da',
                  }}
                >
                  <span style={{ fontSize: 14, color: C.dim }}>Executing partner</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{opp.partner}</span>
                </div>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 16px' }}
                >
                  <span style={{ fontSize: 14, color: C.dim }}>Settlement</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>T+2 · USD wallet</span>
                </div>
              </div>
              <div
                style={{
                  background: C.mint,
                  border: '1px solid #cde0d8',
                  borderRadius: 12,
                  padding: '14px 16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#0a6e44"
                    strokeWidth="1.9"
                    aria-hidden="true"
                  >
                    <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
                  </svg>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal2 }}>
                    Agent ran your compliance checks
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    'Identity verified (KYC · Tier 2)',
                    'Suitability: matches your balanced-income profile',
                    'Source of funds confirmed',
                  ].map((line) => (
                    <div
                      key={line}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 14,
                        color: '#2c2925',
                      }}
                    >
                      <span aria-hidden="true" style={{ color: '#0a6e44', fontWeight: 700 }}>
                        ✓
                      </span>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && !blocked && (
            <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
              <div
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: '#e2f4ea',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0a6e44"
                  strokeWidth="2.2"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 21 }}>
                Instruction submitted
              </div>
              <p
                style={{
                  margin: '8px auto 18px',
                  maxWidth: 330,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: C.dim,
                }}
              >
                CCN routed your {amtFmt} instruction to {opp.partner}, who executes, custodies and
                settles it (T+2). CCN never holds your money. Projections are estimates, not
                guarantees.
              </p>
              <div
                style={{
                  background: '#f4f0e7',
                  borderRadius: 12,
                  padding: '14px 16px',
                  textAlign: 'left',
                  maxWidth: 320,
                  margin: '0 auto',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 13.5,
                    padding: '4px 0',
                  }}
                >
                  <span style={{ color: C.dim }}>Reference</span>
                  <span style={{ fontFamily: C.mono, fontWeight: 700 }}>CCN-8F42-QX</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 13.5,
                    padding: '4px 0',
                  }}
                >
                  <span style={{ color: C.dim }}>Status</span>
                  <span style={{ color: '#a44e20', fontWeight: 700 }}>Processing</span>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            {step === 1 && !blocked && (
              <button
                type="button"
                onClick={() => setStep(0)}
                style={{
                  padding: '14px 18px',
                  border: '1px solid #ddd6c8',
                  borderRadius: 13,
                  background: C.card,
                  color: C.dim,
                  fontFamily: C.body,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            )}
            {blocked ? (
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: 14,
                  border: 'none',
                  borderRadius: 13,
                  background: C.terra,
                  color: '#fff',
                  fontFamily: C.body,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Close — understood
              </button>
            ) : step === 0 ? (
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  flex: 1,
                  padding: 14,
                  border: 'none',
                  borderRadius: 13,
                  background: C.teal,
                  color: '#fff',
                  fontFamily: C.body,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Continue to authorize
              </button>
            ) : step === 1 ? (
              <button
                type="button"
                disabled={amtNum < minValue(opp)}
                onClick={() => setStep(2)}
                style={{
                  flex: 1,
                  padding: 14,
                  border: 'none',
                  borderRadius: 13,
                  background: C.teal,
                  color: '#fff',
                  fontFamily: C.body,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: amtNum < minValue(opp) ? 'not-allowed' : 'pointer',
                  opacity: amtNum < minValue(opp) ? 0.5 : 1,
                }}
              >
                Authorize &amp; route {amtFmt}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: 14,
                  border: 'none',
                  borderRadius: 13,
                  background: C.teal,
                  color: '#fff',
                  fontFamily: C.body,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

export default function OpportunitiesPage() {
  const [filter, setFilter] = useState<Kind | 'All'>('All');
  const [selected, setSelected] = useState<Opp | null>(null);

  const shown = filter === 'All' ? TRADEABLE : TRADEABLE.filter((o) => o.type === filter);
  const count = (f: Kind | 'All') =>
    f === 'All' ? TRADEABLE.length : TRADEABLE.filter((o) => o.type === f).length;

  return (
    <AppScreen active="opportunities">
      <PageHead
        eyebrow="Regional investments across jurisdictions · executed by licensed partners"
        title="Opportunities"
        right={
          <div
            style={{
              background: C.mint,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: '9px 15px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <b style={{ fontFamily: C.disp, fontSize: 20 }}>6</b>
            <span style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.2 }}>
              matched to
              <br />
              your goals
            </span>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            style={chipStyle(filter === f)}
          >
            {f}
            <span style={{ opacity: 0.6, fontFamily: C.mono }}>{count(f)}</span>
          </button>
        ))}
      </div>

      <div className="g2">
        {shown.map((o) => (
          <OppCard key={o.id} o={o} onOpen={setSelected} />
        ))}
      </div>

      {/* What your agent screens out — the guardrail the product is built around. */}
      <h2 style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 20, margin: '30px 0 6px' }}>
        What your agent screens out
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: C.dim }}>
        Listed so you can see exactly what fails your suitability profile, and why.
      </p>
      <div
        style={{
          background: C.card,
          border: '1px solid #ecd2c2',
          borderLeft: `4px solid ${C.terra}`,
          borderRadius: 16,
          padding: 22,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: '#f2e7de',
            color: '#7d4f36',
            display: 'grid',
            placeItems: 'center',
            fontFamily: C.mono,
            fontWeight: 700,
            fontSize: 12,
            flex: 'none',
          }}
        >
          {BLOCKED.abbr}
        </span>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: '.6px',
                textTransform: 'uppercase',
                color: '#7d4f36',
              }}
            >
              {BLOCKED.type}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: 6,
                color: '#a44e20',
                background: '#f5e7d9',
              }}
            >
              Screened out
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.faint, marginBottom: 4 }}>{BLOCKED.region}</div>
          <div
            style={{
              fontFamily: C.disp,
              fontWeight: 700,
              fontSize: 18,
              lineHeight: 1.25,
              marginBottom: 8,
            }}
          >
            {BLOCKED.name}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.dim }}>
            {BLOCKED.agentNote}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSelected(BLOCKED)}
          style={{
            padding: '12px 18px',
            borderRadius: 12,
            border: 'none',
            background: C.terra,
            color: '#fff',
            fontFamily: C.body,
            fontWeight: 700,
            fontSize: 14.5,
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          Why the agent flags this
        </button>
      </div>

      <ExecDialog opp={selected} onClose={() => setSelected(null)} />
    </AppScreen>
  );
}
