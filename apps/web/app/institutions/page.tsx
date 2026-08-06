'use client';

import Link from 'next/link';
import { type ReactNode, useRef, useState } from 'react';
import { C } from '../_lib/ui';

/* The partner console is a distinct surface from the investor app: a dark navy
   shell (not the warm AppSidebar), matching demo/assets/institutions.png. The
   sidebar sections are an APG tablist; the main area is the active tabpanel. */
const NAVY = {
  bg: '#0c2b26',
  active: '#134b43',
  line: 'rgba(255,255,255,.10)',
  text: '#d3e0da',
  muted: 'rgba(211,224,218,.62)',
} as const;

/* Contrast-safe tones for the light panels (darkened from the prototype so small
   text clears WCAG 1.4.3 on white). */
const MUTED = '#6d6455';
const SLATE = '#45596d';
const TREND = '#0a7a4c';

type TabKey = 'overview' | 'orders' | 'products' | 'clients' | 'compliance';

const icons: Record<TabKey, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  orders: <path d="M4 7h16M4 12h16M4 17h10" />,
  products: <path d="M3 9l9-6 9 6v9a2 2 0 01-2 2H5a2 2 0 01-2-2z M3 9l9 6 9-6" />,
  clients: (
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87" />
  ),
  compliance: <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />,
};

const TAB_TITLES: Record<TabKey, string> = {
  overview: 'overview',
  orders: 'order flow',
  products: 'products',
  clients: 'clients & KYC',
  compliance: 'compliance',
};

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
  {
    id: 'o4',
    product: 'Proven USD Income Fund',
    client: 'Client ••5567',
    when: '3h ago',
    amount: 10000,
    status: 'settled',
  },
];

const PRODUCTS = [
  { name: 'GOJ USD Global Bond 2032', type: 'Bond', clients: 412, aum: 'US$14.2M', trend: '+22%' },
  {
    name: 'Sagicor Real Estate X Fund',
    type: 'Real Estate',
    clients: 286,
    aum: 'US$11.8M',
    trend: '+31%',
  },
  { name: 'Proven USD Income Fund', type: 'Fund', clients: 508, aum: 'US$9.4M', trend: '+12%' },
  {
    name: 'NCB Money Market Fund',
    type: 'Money Market',
    clients: 640,
    aum: 'US$7.1M',
    trend: '+8%',
  },
  {
    name: 'Sygnus Private Credit III',
    type: 'Private',
    clients: 74,
    aum: 'US$5.7M',
    trend: '+44%',
  },
];

const KYC_STAGES = [
  { label: 'Invited', count: '4,120', pct: 100, color: '#6b6459' },
  { label: 'KYC started', count: '3,180', pct: 77, color: '#7fb5ad' },
  { label: 'Verified', count: '2,760', pct: 67, color: '#17786e' },
  { label: 'Funded', count: '1,284', pct: 31, color: '#124e48' },
];

const AUDIT = [
  {
    actor: 'AI Agent',
    action: 'Suitability check passed for order CCN-8F42-QX',
    time: '2 min ago',
    dot: C.green,
  },
  {
    actor: 'Compliance',
    action: 'KYC Tier-2 approved · client #10482',
    time: '14 min ago',
    dot: C.green,
  },
  {
    actor: 'AI Agent',
    action: 'Flagged source-of-funds review · client #10517',
    time: '38 min ago',
    dot: C.terra,
  },
  {
    actor: 'System',
    action: 'Settlement confirmed T+2 · US$5,000 · Sagicor',
    time: '1 hr ago',
    dot: '#17786e',
  },
  {
    actor: 'Compliance',
    action: 'PEP screening completed · 12 clients',
    time: '2 hr ago',
    dot: C.green,
  },
];

const WHY = [
  'Qualified, KYC-cleared demand into products you already run',
  'Diaspora reach without building cross-border onboarding',
  'Your name and regulator on every deal card, no channel conflict',
  'You keep execution, custody and settlement under your license',
];

const KPIS = [
  { label: 'Referred AUM', value: 'US$48.2M', sub: '+18% QoQ', color: C.teal2 },
  { label: 'Funded clients (MTD)', value: '1,284', sub: '+9%', color: C.ink },
];

const TABS: TabKey[] = ['overview', 'orders', 'products', 'clients', 'compliance'];
const uppr = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
} as const;
const cardLight = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16 } as const;
const fmt = (n: number) => `US$${n.toLocaleString('en-US')}`;

function Icn({ path, size = 20 }: { path: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

export default function InstitutionsPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
  const [paused, setPaused] = useState<Record<string, boolean>>({});
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pending = orders.filter((o) => o.status === 'new').length;
  const settled = orders.filter((o) => o.status === 'settled').length;
  const badge: Partial<Record<TabKey, number>> = { orders: pending };

  const advance = (id: string) =>
    setOrders((os) =>
      os.map((o) =>
        o.id === id ? { ...o, status: o.status === 'new' ? 'accepted' : 'settled' } : o,
      ),
    );

  function onTabKey(e: React.KeyboardEvent, idx: number) {
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
      next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const key = TABS[next];
      if (key) setTab(key);
      tabRefs.current[next]?.focus();
    }
  }

  return (
    <div className="app-shell" style={{ background: C.bg, color: C.ink, fontFamily: C.body }}>
      {/* Dark partner-console sidebar — an APG vertical tablist */}
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

        <div
          role="tablist"
          aria-label="Partner console sections"
          aria-orientation="vertical"
          style={{ flex: 'none' }}
        >
          {TABS.map((key, idx) => {
            const on = tab === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                id={`ptab-${key}`}
                aria-selected={on}
                aria-controls={`ppanel-${key}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => onTabKey(e, idx)}
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
                  background: on ? NAVY.active : 'transparent',
                  color: on ? '#fff' : NAVY.text,
                  fontFamily: C.body,
                  fontWeight: on ? 700 : 500,
                  fontSize: 15,
                  textTransform: 'capitalize',
                }}
              >
                <Icn path={icons[key]} />
                <span style={{ flex: 1 }}>
                  {key === 'compliance' ? 'Compliance' : TAB_TITLES[key]}
                </span>
                {badge[key] ? (
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
                    {badge[key]}
                  </span>
                ) : null}
              </button>
            );
          })}
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
            padding: 12,
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
              Partner console · {TAB_TITLES[tab]}
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

        {/* The tab↔panel relationship (aria-controls / aria-labelledby) makes each
            panel reachable by assistive tech; most panels also hold focusable controls. */}
        <div role="tabpanel" id={`ppanel-${tab}`} aria-labelledby={`ptab-${tab}`}>
          {tab === 'overview' && (
            <Overview orders={orders} pending={pending} settled={settled} advance={advance} />
          )}
          {tab === 'orders' && <OrderFlow orders={orders} advance={advance} />}
          {tab === 'products' && (
            <Products paused={paused} toggle={(n) => setPaused((p) => ({ ...p, [n]: !p[n] }))} />
          )}
          {tab === 'clients' && <Clients />}
          {tab === 'compliance' && <Compliance />}
        </div>
      </main>
    </div>
  );
}

function Overview({
  orders,
  pending,
  settled,
  advance,
}: { orders: Order[]; pending: number; settled: number; advance: (id: string) => void }) {
  return (
    <>
      <div className="g4">
        {KPIS.map((k) => (
          <div key={k.label} style={{ ...cardLight, padding: 20 }}>
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
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
        <div style={{ ...cardLight, padding: 20 }}>
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
          <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>awaiting your accept</div>
        </div>
        <div style={{ ...cardLight, padding: 20 }}>
          <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 8 }}>Settled this session</div>
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
          <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>confirmed to clients</div>
        </div>
      </div>

      <div className="g-agent" style={{ marginTop: 18 }}>
        <section style={{ ...cardLight, padding: 22 }}>
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
          <OrderRows orders={orders.slice(0, 3)} advance={advance} />
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section style={{ background: C.teal, color: C.tealInk, borderRadius: 16, padding: 22 }}>
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
                <span aria-hidden="true" style={{ color: C.peach, fontWeight: 700, flex: 'none' }}>
                  +
                </span>
                <span style={{ color: '#fff' }}>{w}</span>
              </div>
            ))}
          </section>
          <section style={{ ...cardLight, padding: 22 }}>
            <b style={{ fontFamily: C.disp, fontSize: 17 }}>The line CCN never crosses</b>
            <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: C.dim }}>
              CCN holds no client money, executes nothing and never becomes custodian. The regulated
              duties stay with you; CCN routes signed instructions and keeps the audit trail.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function OrderRows({ orders, advance }: { orders: Order[]; advance: (id: string) => void }) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          ...uppr,
          fontSize: 11,
          color: MUTED,
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
            <div style={{ fontSize: 12.5, color: MUTED }}>
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
            <OrderAction order={o} advance={advance} />
          </div>
        </div>
      ))}
    </>
  );
}

function OrderAction({ order, advance }: { order: Order; advance: (id: string) => void }) {
  if (order.status === 'settled')
    return <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>Settled ✓</span>;
  if (order.status === 'new')
    return (
      <button
        type="button"
        onClick={() => advance(order.id)}
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
    );
  return (
    <button
      type="button"
      onClick={() => advance(order.id)}
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
  );
}

function OrderFlow({ orders, advance }: { orders: Order[]; advance: (id: string) => void }) {
  const counts = `${orders.filter((o) => o.status === 'new').length} to accept · ${orders.filter((o) => o.status === 'accepted').length} to settle · ${orders.filter((o) => o.status === 'settled').length} settled`;
  return (
    <div style={{ ...cardLight, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          padding: '20px 24px 14px',
        }}
      >
        <div>
          <b style={{ fontFamily: C.disp, fontSize: 18 }}>Order flow</b>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{counts}</div>
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: MUTED,
            maxWidth: 360,
            textAlign: 'right',
            lineHeight: 1.4,
          }}
        >
          Accept moves an order to your desk for execution. Settle confirms it back to the client's
          unified portfolio.
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2.2fr 1.1fr 1fr 1.1fr',
              padding: '0 24px 8px',
              ...uppr,
              fontSize: 11.5,
              color: MUTED,
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <span>Product</span>
            <span>Client</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>
          {orders.map((o) => (
            <div
              key={o.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2.2fr 1.1fr 1fr 1.1fr',
                alignItems: 'center',
                padding: '14px 24px',
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {o.product}
                </div>
                <div style={{ fontSize: 12, color: MUTED }}>{o.when}</div>
              </div>
              <div style={{ fontSize: 13.5, color: SLATE }}>{o.client}</div>
              <div
                style={{ textAlign: 'right', fontFamily: C.mono, fontWeight: 700, fontSize: 14 }}
              >
                {fmt(o.amount)}
              </div>
              <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end' }}>
                <OrderAction order={o} advance={advance} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Products({
  paused,
  toggle,
}: { paused: Record<string, boolean>; toggle: (name: string) => void }) {
  return (
    <div style={{ ...cardLight, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '20px 24px 14px',
        }}
      >
        <div>
          <b style={{ fontFamily: C.disp, fontSize: 18 }}>Your products on CCN</b>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
            Listed products the agent can match to suitable clients.
          </div>
        </div>
        <button
          type="button"
          style={{
            padding: '10px 16px',
            border: 'none',
            borderRadius: 10,
            background: C.teal,
            color: '#fff',
            fontFamily: C.body,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          List a product
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2.2fr 1fr 1fr .9fr 1fr',
              padding: '0 24px 8px',
              ...uppr,
              fontSize: 11.5,
              color: MUTED,
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            <span>Product</span>
            <span style={{ textAlign: 'right' }}>Clients</span>
            <span style={{ textAlign: 'right' }}>AUM via CCN</span>
            <span style={{ textAlign: 'right' }}>Inflow</span>
            <span style={{ textAlign: 'right' }}>Status</span>
          </div>
          {PRODUCTS.map((p) => {
            const isPaused = !!paused[p.name];
            return (
              <div
                key={p.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.2fr 1fr 1fr .9fr 1fr',
                  alignItems: 'center',
                  padding: '14px 24px',
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED }}>{p.type}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 14, color: SLATE }}>{p.clients}</div>
                <div
                  style={{
                    textAlign: 'right',
                    fontFamily: C.mono,
                    fontWeight: 700,
                    fontSize: 13.5,
                  }}
                >
                  {p.aum}
                </div>
                <div style={{ textAlign: 'right', fontSize: 13.5, color: TREND, fontWeight: 700 }}>
                  {p.trend}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    aria-pressed={!isPaused}
                    onClick={() => toggle(p.name)}
                    style={{
                      padding: '6px 13px',
                      borderRadius: 8,
                      border: `1px solid ${isPaused ? C.line : '#bfe0cf'}`,
                      background: isPaused ? C.card : C.mint,
                      color: isPaused ? MUTED : C.teal2,
                      fontFamily: C.body,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {isPaused ? 'Paused' : 'Live'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Clients() {
  return (
    <div className="g-held">
      <section style={{ ...cardLight, padding: '22px 24px' }}>
        <b style={{ fontFamily: C.disp, fontSize: 18 }}>Onboarding pipeline</b>
        <div style={{ fontSize: 13, color: MUTED, margin: '4px 0 18px' }}>
          Agent-referred clients, last 90 days
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {KYC_STAGES.map((k) => (
            <div key={k.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 14.5, color: SLATE, fontWeight: 500 }}>{k.label}</span>
                <span style={{ fontFamily: C.mono, fontSize: 14.5, fontWeight: 700 }}>
                  {k.count}
                </span>
              </div>
              <div
                style={{ height: 9, borderRadius: 6, background: '#ece6da', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', width: `${k.pct}%`, background: k.color }} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        style={{
          background: '#f4f0e7',
          border: `1px solid ${C.line}`,
          borderRadius: 16,
          padding: '22px 24px',
        }}
      >
        <b style={{ fontFamily: C.disp, fontSize: 17 }}>KYC stays yours</b>
        <p style={{ margin: '10px 0 14px', fontSize: 14, lineHeight: 1.55, color: C.dim }}>
          You already verified these clients. CCN links that status with their consent rather than
          re-collecting it, so a referral becomes a funded account instead of an abandoned form. You
          remain the regulated owner of KYC and AML.
        </p>
        {[
          { l: 'Verification reused (with consent)', v: '2,760', c: C.ink },
          { l: 'Re-verification required', v: '0', c: C.green },
          { l: 'Onboarding time saved', v: '~6 days / client', c: C.ink },
        ].map((r) => (
          <div
            key={r.l}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13.5,
              padding: '5px 0',
            }}
          >
            <span style={{ color: C.dim }}>{r.l}</span>
            <span style={{ fontWeight: 700, color: r.c }}>{r.v}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Compliance() {
  return (
    <div className="g-agent" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
      <section
        style={{
          background: C.teal,
          borderRadius: 16,
          padding: '22px 24px',
          color: C.tealInk,
          height: 'fit-content',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8fe3c0"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
            <path d="M9.4 12l1.9 1.9 3.3-3.6" />
          </svg>
          <b style={{ fontFamily: C.disp, fontSize: 16 }}>Agreement &amp; residency</b>
        </div>
        {[
          { l: 'Regulator', v: 'FSC Jamaica', c: '#fff' },
          { l: 'Partner agreement', v: 'Active', c: '#8fe3c0' },
          { l: 'Data residency', v: 'In-region', c: '#fff' },
          { l: 'CCN role', v: 'Orchestration only', c: '#fff' },
          { l: 'Last audit', v: 'Jun 12, 2026', c: '#fff' },
        ].map((r) => (
          <div
            key={r.l}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 14,
              padding: '6px 0',
            }}
          >
            <span style={{ opacity: 0.78 }}>{r.l}</span>
            <span style={{ fontWeight: 700, color: r.c }}>{r.v}</span>
          </div>
        ))}
      </section>
      <section style={{ ...cardLight, padding: '22px 24px' }}>
        <b style={{ fontFamily: C.disp, fontSize: 17 }}>Live audit trail</b>
        <div style={{ marginTop: 12 }}>
          {AUDIT.map((a) => (
            <div
              key={a.action}
              style={{
                display: 'flex',
                gap: 11,
                padding: '11px 0',
                borderBottom: `1px solid ${C.line}`,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: a.dot,
                  flex: 'none',
                  marginTop: 5,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: '#33475b' }}>{a.action}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                  {a.actor} · {a.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
