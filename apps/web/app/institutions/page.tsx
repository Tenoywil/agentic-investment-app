'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { C } from '../_lib/ui';

/* The partner console is a distinct surface from the investor app: a dark navy
   shell (not the warm AppSidebar), matching demo/assets/institutions.png. */
const NAVY = {
  bg: '#0c2b26',
  active: '#134b43',
  line: 'rgba(255,255,255,.10)',
  text: '#d3e0da',
  muted: 'rgba(211,224,218,.62)',
} as const;

const NAV: { label: string; icon: ReactNode; badge?: number; on?: boolean }[] = [
  {
    label: 'Overview',
    on: true,
    icon: (
      <>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
      </>
    ),
  },
  { label: 'Order flow', badge: 2, icon: <path d="M4 7h16M4 12h16M4 17h10" /> },
  {
    label: 'Products',
    icon: <path d="M3 9l9-6 9 6v9a2 2 0 01-2 2H5a2 2 0 01-2-2z M3 9l9 6 9-6" />,
  },
  {
    label: 'Clients & KYC',
    icon: (
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87" />
    ),
  },
  { label: 'Compliance', icon: <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" /> },
];

const KPIS = [
  { label: 'Referred AUM', value: 'US$48.2M', sub: '+18% QoQ', color: C.teal2 },
  { label: 'Funded clients (MTD)', value: '1,284', sub: '+9%', color: C.ink },
];

type Order = {
  id: string;
  product: string;
  client: string;
  when: string;
  amount: number;
  status: 'new' | 'accepted' | 'settled';
};
const SEED_ORDERS: Order[] = [
  {
    id: 'o1',
    product: 'Sagicor Real Estate X Fund',
    client: 'Client ••4821',
    when: '2m ago',
    amount: 5000,
    status: 'new',
  },
  {
    id: 'o2',
    product: 'GOJ USD Global Bond 2032',
    client: 'Client ••7134',
    when: '11m ago',
    amount: 2000,
    status: 'new',
  },
  {
    id: 'o3',
    product: 'Sagicor Sigma Global Fund',
    client: 'Client ••2290',
    when: '1h ago',
    amount: 3500,
    status: 'accepted',
  },
];

const WHY = [
  'Qualified, KYC-cleared demand into products you already run',
  'Diaspora reach without building cross-border onboarding',
  'Your name and regulator on every deal card, no channel conflict',
  'You keep execution, custody and settlement under your license',
];

function Icn({ path }: { path: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const uppr = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
} as const;
const fmt = (n: number) => `US$${n.toLocaleString('en-US')}`;

export default function InstitutionsPage() {
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);

  const pending = orders.filter((o) => o.status === 'new').length;
  const settled = orders.filter((o) => o.status === 'settled').length;

  const act = (id: string) =>
    setOrders((os) =>
      os.map((o) =>
        o.id === id ? { ...o, status: o.status === 'new' ? 'accepted' : 'settled' } : o,
      ),
    );

  return (
    <div className="app-shell" style={{ background: C.bg, color: C.ink, fontFamily: C.body }}>
      {/* Dark partner-console sidebar */}
      <nav
        className="console-sidebar"
        aria-label="Partner console"
        style={{
          width: 260,
          flex: 'none',
          position: 'sticky',
          top: 0,
          height: '100vh',
          background: NAVY.bg,
          color: NAVY.text,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 16px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px 20px' }}>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: C.teal,
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontFamily: C.disp,
              fontWeight: 700,
              fontSize: 19,
              flex: 'none',
            }}
          >
            S
          </span>
          <div>
            <div style={{ fontFamily: C.disp, fontWeight: 700, fontSize: 16 }}>Sagicor Group</div>
            <div style={{ ...uppr, fontSize: 10.5, color: NAVY.muted, fontFamily: C.mono }}>
              Partner console
            </div>
          </div>
        </div>

        <div style={{ flex: 'none' }}>
          {NAV.map((n) => (
            <button
              key={n.label}
              type="button"
              aria-current={n.on ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '12px 14px',
                marginBottom: 3,
                borderRadius: 12,
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                background: n.on ? NAVY.active : 'transparent',
                color: n.on ? '#fff' : NAVY.text,
                fontFamily: C.body,
                fontWeight: n.on ? 700 : 500,
                fontSize: 15,
              }}
            >
              <Icn path={n.icon} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge ? (
                <span
                  style={{
                    minWidth: 22,
                    textAlign: 'center',
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: C.peach,
                    color: '#3a2415',
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                >
                  {n.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            background: 'rgba(255,255,255,.06)',
            border: `1px solid ${NAVY.line}`,
            borderRadius: 14,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5fd3a6' }} />
            Agreement active · FSC Jamaica
          </div>
          <div style={{ fontSize: 12.5, color: NAVY.muted, lineHeight: 1.45 }}>
            CCN routes orders. You execute, custody and settle.
          </div>
        </div>

        <Link
          href="/home"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            padding: '12px',
            borderRadius: 12,
            border: `1px solid ${NAVY.line}`,
            color: NAVY.text,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 14.5,
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Switch to investor view
        </Link>
      </nav>

      <main style={{ flex: 1, minWidth: 0, padding: '26px 32px 60px' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 22,
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 4 }}>
              Partner console · overview
            </div>
            <h1
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: '-.4px',
                margin: 0,
              }}
            >
              Sagicor Group
            </h1>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              padding: '6px 6px 6px 15px',
            }}
          >
            <span style={{ fontSize: 13.5, color: C.dim }}>Preview with sample data</span>
            <span
              style={{
                background: C.teal,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                padding: '6px 13px',
                borderRadius: 999,
              }}
            >
              Partner view
            </span>
          </div>
        </div>

        {/* KPIs */}
        <div className="g4">
          {KPIS.map((k) => (
            <div
              key={k.label}
              style={{
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 16,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 8 }}>{k.label}</div>
              <div
                style={{
                  fontFamily: C.disp,
                  fontWeight: 700,
                  fontSize: 28,
                  color: k.color,
                  letterSpacing: '-.5px',
                }}
              >
                {k.value}
              </div>
              <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 8 }}>Orders pending</div>
            <div
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 28,
                color: pending ? C.terra : C.ink,
                letterSpacing: '-.5px',
              }}
            >
              {pending}
            </div>
            <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>awaiting your accept</div>
          </div>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 8 }}>
              Settled this session
            </div>
            <div
              style={{
                fontFamily: C.disp,
                fontWeight: 700,
                fontSize: 28,
                color: settled ? C.green : C.ink,
                letterSpacing: '-.5px',
              }}
            >
              {settled}
            </div>
            <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>confirmed to clients</div>
          </div>
        </div>

        {/* Order flow + why */}
        <div className="g-agent" style={{ marginTop: 18 }}>
          <section
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 16,
              padding: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <b style={{ fontFamily: C.disp, fontSize: 18 }}>Incoming order flow</b>
              <span style={{ color: C.teal2, fontWeight: 700, fontSize: 14 }}>Open queue</span>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: C.dim }}>
              Orders arrive here when a CCN client approves a deal in your products. You execute,
              custody and settle each one.
            </p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                ...uppr,
                fontSize: 11,
                color: C.faint,
                paddingBottom: 10,
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <span>Product · Client</span>
              <span style={{ display: 'flex', gap: 40 }}>
                <span>Amount</span>
                <span>Action</span>
              </span>
            </div>
            {orders.map((o) => (
              <div
                key={o.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 0',
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{o.product}</div>
                  <div style={{ fontSize: 12.5, color: C.faint }}>
                    {o.client} · {o.when}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: C.mono,
                    fontWeight: 700,
                    fontSize: 14,
                    minWidth: 78,
                    textAlign: 'right',
                  }}
                >
                  {fmt(o.amount)}
                </span>
                <div style={{ minWidth: 92, display: 'flex', justifyContent: 'flex-end' }}>
                  {o.status === 'settled' ? (
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Settled ✓</span>
                  ) : o.status === 'new' ? (
                    <button
                      type="button"
                      onClick={() => act(o.id)}
                      style={{
                        padding: '9px 18px',
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
                      Accept
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act(o.id)}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 10,
                        border: `1px solid ${C.terra}`,
                        background: C.card,
                        color: C.terra,
                        fontFamily: C.body,
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      Settle
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section
              style={{ background: C.teal, color: C.tealInk, borderRadius: 16, padding: 22 }}
            >
              <div
                style={{
                  ...uppr,
                  fontSize: 12,
                  color: 'rgba(234,250,245,.7)',
                  fontFamily: C.mono,
                  marginBottom: 14,
                }}
              >
                Why this flow matters
              </div>
              {WHY.map((w) => (
                <div
                  key={w}
                  style={{
                    display: 'flex',
                    gap: 10,
                    marginBottom: 12,
                    fontSize: 14.5,
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: C.peach, fontWeight: 700, flex: 'none' }}
                  >
                    +
                  </span>
                  <span style={{ color: '#fff' }}>{w}</span>
                </div>
              ))}
            </section>

            <section
              style={{
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 16,
                padding: 22,
              }}
            >
              <b style={{ fontFamily: C.disp, fontSize: 17 }}>The line CCN never crosses</b>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: C.dim }}>
                CCN holds no client money, executes nothing and never becomes custodian. The
                regulated duties stay with you; CCN routes signed instructions and keeps the audit
                trail.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
