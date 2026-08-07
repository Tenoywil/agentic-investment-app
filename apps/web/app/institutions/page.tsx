'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Switch } from '@/app/_components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/_components/ui/tabs';
import { ArrowLeft, ArrowRightLeft, Boxes, LayoutGrid, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

/* The partner console: a dark-navy shell (Warm-themed shadcn) matching
   demo/assets/institutions.png. Radix Tabs drive the sidebar sections — the APG
   tab keyboard model (arrow keys, roving focus, aria-selected) comes for free. */

type TabKey = 'overview' | 'orders' | 'products' | 'clients' | 'compliance';

const TABS: { key: TabKey; label: string; Icon: typeof LayoutGrid }[] = [
  { key: 'overview', label: 'Overview', Icon: LayoutGrid },
  { key: 'orders', label: 'Order flow', Icon: ArrowRightLeft },
  { key: 'products', label: 'Products', Icon: Boxes },
  { key: 'clients', label: 'Clients & KYC', Icon: Users },
  { key: 'compliance', label: 'Compliance', Icon: ShieldCheck },
];
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
    action: 'Suitability check passed for order CCN-8F42-QX',
    by: 'AI Agent · 2 min ago',
    dot: '#0a8f5b',
  },
  { action: 'KYC Tier-2 approved · client #10482', by: 'Compliance · 14 min ago', dot: '#0a8f5b' },
  {
    action: 'Flagged source-of-funds review · client #10517',
    by: 'AI Agent · 38 min ago',
    dot: '#c56a3e',
  },
  {
    action: 'Settlement confirmed T+2 · US$5,000 · Sagicor',
    by: 'System · 1 hr ago',
    dot: '#17786e',
  },
  { action: 'PEP screening completed · 12 clients', by: 'Compliance · 2 hr ago', dot: '#0a8f5b' },
];

const WHY = [
  'Qualified, KYC-cleared demand into products you already run',
  'Diaspora reach without building cross-border onboarding',
  'Your name and regulator on every deal card, no channel conflict',
  'You keep execution, custody and settlement under your license',
];

const KPIS = [
  { label: 'Referred AUM', value: 'US$48.2M', sub: '+18% QoQ', valClass: 'text-teal2' },
  { label: 'Funded clients (MTD)', value: '1,284', sub: '+9%', valClass: 'text-foreground' },
];

const fmt = (n: number) => `US$${n.toLocaleString('en-US')}`;
const uppr = 'text-[11px] font-bold uppercase tracking-wider text-faint';

function OrderAction({ order, advance }: { order: Order; advance: (id: string) => void }) {
  if (order.status === 'settled')
    return <span className="text-sm font-bold text-success">Settled ✓</span>;
  if (order.status === 'new')
    return (
      <Button size="sm" onClick={() => advance(order.id)}>
        Accept
      </Button>
    );
  return (
    <Button
      size="sm"
      variant="outline"
      className="border-terra text-terra hover:bg-transparent hover:text-terra"
      onClick={() => advance(order.id)}
    >
      Settle
    </Button>
  );
}

export default function InstitutionsPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
  const [live, setLive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRODUCTS.map((p) => [p.name, true])),
  );

  const pending = orders.filter((o) => o.status === 'new').length;
  const settled = orders.filter((o) => o.status === 'settled').length;
  const advance = (id: string) =>
    setOrders((os) =>
      os.map((o) =>
        o.id === id ? { ...o, status: o.status === 'new' ? 'accepted' : 'settled' } : o,
      ),
    );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      orientation="vertical"
      className="app-shell bg-background font-sans text-foreground"
    >
      {/* Dark navy sidebar */}
      <nav className="console-sidebar sticky top-0 flex h-screen w-[260px] flex-none flex-col bg-navy px-4 pb-[18px] pt-6 text-[#d3e0da]">
        <div className="flex items-center gap-3 px-2 pb-5">
          <Avatar className="h-[42px] w-[42px] rounded-xl">
            <AvatarFallback className="rounded-xl font-display text-[19px]">S</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-display text-base font-bold">Sagicor Group</div>
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#d3e0da]/60">
              Partner console
            </div>
          </div>
        </div>

        <TabsList
          aria-label="Partner console sections"
          className="flex flex-col items-stretch gap-[3px]"
        >
          {TABS.map(({ key, label, Icon }) => (
            <TabsTrigger
              key={key}
              value={key}
              className="justify-start gap-3 rounded-xl px-3.5 py-3 text-[15px] font-medium text-[#d3e0da] data-[state=active]:bg-navy-active data-[state=active]:font-bold data-[state=active]:text-white"
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {key === 'orders' && pending > 0 ? (
                <span className="min-w-[22px] rounded-full bg-peach px-1.5 py-px text-center text-xs font-bold text-[#3a2415]">
                  {pending}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1" />

        <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">
            <span className="h-[7px] w-[7px] rounded-full bg-[#5fd3a6]" />
            Agreement active · FSC Jamaica
          </div>
          <div className="text-[12.5px] leading-snug text-[#d3e0da]/60">
            CCN routes orders. You execute, custody and settle.
          </div>
        </div>

        <Button
          asChild
          variant="outline"
          className="justify-center gap-2.5 border-white/10 bg-transparent text-[#d3e0da] hover:bg-white/5 hover:text-white"
        >
          <Link href="/home">
            <ArrowLeft className="h-4 w-4" /> Switch to investor view
          </Link>
        </Button>
      </nav>

      <main className="min-w-0 flex-1 px-8 pb-[60px] pt-[26px]">
        {/* Header */}
        <div className="mb-[22px] flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 text-[13.5px] text-dim">Partner console · {TAB_TITLES[tab]}</div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Sagicor Group</h1>
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <div className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1.5 pl-4 pr-1.5">
              <span className="text-[13.5px] text-dim">Preview with sample data</span>
              <Badge className="rounded-full px-3 py-1.5 text-[13px]">Partner view</Badge>
            </div>
          </div>
        </div>

        {/* Overview */}
        <TabsContent value="overview" className="mt-0">
          <div className="g4">
            {KPIS.map((k) => (
              <Card key={k.label} className="p-5">
                <div className="mb-2 text-[13.5px] text-dim">{k.label}</div>
                <div className={`font-display text-[28px] font-bold tracking-tight ${k.valClass}`}>
                  {k.value}
                </div>
                <div className="mt-1 text-[13px] text-faint">{k.sub}</div>
              </Card>
            ))}
            <Card className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">Orders pending</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${pending ? 'text-terra' : 'text-foreground'}`}
              >
                {pending}
              </div>
              <div className="mt-1 text-[13px] text-faint">awaiting your accept</div>
            </Card>
            <Card className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">Settled this session</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${settled ? 'text-success' : 'text-foreground'}`}
              >
                {settled}
              </div>
              <div className="mt-1 text-[13px] text-faint">confirmed to clients</div>
            </Card>
          </div>

          <div className="g-agent mt-[18px]">
            <Card className="p-[22px]">
              <div className="mb-1.5 flex items-center justify-between">
                <b className="font-display text-lg">Incoming order flow</b>
                <span className="text-sm font-bold text-teal2">Open queue</span>
              </div>
              <p className="mb-4 text-sm leading-normal text-dim">
                Orders arrive here when a CCN client approves a deal in your products. You execute,
                custody and settle each one.
              </p>
              <div className={`flex justify-between border-b border-border pb-2.5 ${uppr}`}>
                <span>Product · Client</span>
                <span className="flex gap-10">
                  <span>Amount</span>
                  <span>Action</span>
                </span>
              </div>
              {orders.slice(0, 3).map((o) => (
                <div key={o.id} className="flex items-center gap-3 border-b border-border py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold">{o.product}</div>
                    <div className="text-[12.5px] text-faint">
                      {o.client} · {o.when}
                    </div>
                  </div>
                  <span className="min-w-[78px] text-right font-mono text-sm font-bold">
                    {fmt(o.amount)}
                  </span>
                  <div className="flex min-w-[92px] justify-end">
                    <OrderAction order={o} advance={advance} />
                  </div>
                </div>
              ))}
            </Card>

            <div className="flex flex-col gap-[18px]">
              <Card className="border-none bg-primary p-[22px] text-[#eafaf5]">
                <div className={`mb-3.5 font-mono ${uppr} text-[#eafaf5]/70`}>
                  Why this flow matters
                </div>
                {WHY.map((w) => (
                  <div key={w} className="mb-3 flex gap-2.5 text-[14.5px] leading-normal">
                    <span aria-hidden className="flex-none font-bold text-peach">
                      +
                    </span>
                    <span className="text-white">{w}</span>
                  </div>
                ))}
              </Card>
              <Card className="p-[22px]">
                <b className="font-display text-[17px]">The line CCN never crosses</b>
                <p className="mt-2 text-sm leading-relaxed text-dim">
                  CCN holds no client money, executes nothing and never becomes custodian. The
                  regulated duties stay with you; CCN routes signed instructions and keeps the audit
                  trail.
                </p>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Order flow */}
        <TabsContent value="orders" className="mt-0">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2.5 px-6 pb-3.5 pt-5">
              <div>
                <b className="font-display text-lg">Order flow</b>
                <div className="mt-0.5 text-[13px] text-faint">
                  {orders.filter((o) => o.status === 'new').length} to accept ·{' '}
                  {orders.filter((o) => o.status === 'accepted').length} to settle ·{' '}
                  {orders.filter((o) => o.status === 'settled').length} settled
                </div>
              </div>
              <div className="max-w-[360px] text-right text-[12.5px] leading-snug text-faint">
                Accept moves an order to your desk for execution. Settle confirms it back to the
                client's unified portfolio.
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div
                  className={`grid grid-cols-[2.2fr_1.1fr_1fr_1.1fr] border-b border-border px-6 pb-2 ${uppr}`}
                >
                  <span>Product</span>
                  <span>Client</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Status</span>
                </div>
                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="grid grid-cols-[2.2fr_1.1fr_1fr_1.1fr] items-center border-b border-border px-6 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{o.product}</div>
                      <div className="text-xs text-faint">{o.when}</div>
                    </div>
                    <div className="text-[13.5px] text-[#45596d]">{o.client}</div>
                    <div className="text-right font-mono text-sm font-bold">{fmt(o.amount)}</div>
                    <div className="flex justify-end">
                      <OrderAction order={o} advance={advance} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Products */}
        <TabsContent value="products" className="mt-0">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3.5 pt-5">
              <div>
                <b className="font-display text-lg">Your products on CCN</b>
                <div className="mt-0.5 text-[13px] text-faint">
                  Listed products the agent can match to suitable clients.
                </div>
              </div>
              <Button size="sm">List a product</Button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div
                  className={`grid grid-cols-[2.2fr_1fr_1fr_0.9fr_1fr] border-b border-border px-6 pb-2 ${uppr}`}
                >
                  <span>Product</span>
                  <span className="text-right">Clients</span>
                  <span className="text-right">AUM via CCN</span>
                  <span className="text-right">Inflow</span>
                  <span className="text-right">Status</span>
                </div>
                {PRODUCTS.map((p) => (
                  <div
                    key={p.name}
                    className="grid grid-cols-[2.2fr_1fr_1fr_0.9fr_1fr] items-center border-b border-border px-6 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{p.name}</div>
                      <div className="text-xs text-faint">{p.type}</div>
                    </div>
                    <div className="text-right text-sm text-[#45596d]">{p.clients}</div>
                    <div className="text-right font-mono text-[13.5px] font-bold">{p.aum}</div>
                    <div className="text-right text-[13.5px] font-bold text-[#0a7a4c]">
                      {p.trend}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[13px] font-bold text-dim">
                        {live[p.name] ? 'Live' : 'Paused'}
                      </span>
                      <Switch
                        checked={live[p.name]}
                        onCheckedChange={(v) => setLive((s) => ({ ...s, [p.name]: v }))}
                        aria-label={`${p.name} listing ${live[p.name] ? 'live' : 'paused'}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Clients & KYC */}
        <TabsContent value="clients" className="mt-0">
          <div className="g-held">
            <Card className="p-6">
              <b className="font-display text-lg">Onboarding pipeline</b>
              <div className="mb-[18px] mt-1 text-[13px] text-faint">
                Agent-referred clients, last 90 days
              </div>
              <div className="flex flex-col gap-[15px]">
                {KYC_STAGES.map((k) => (
                  <div key={k.label}>
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-[14.5px] font-medium text-[#45596d]">{k.label}</span>
                      <span className="font-mono text-[14.5px] font-bold">{k.count}</span>
                    </div>
                    <div className="h-[9px] overflow-hidden rounded-md bg-[#ece6da]">
                      <div
                        className="h-full rounded-md"
                        style={{ width: `${k.pct}%`, background: k.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="border-border bg-[#f4f0e7] p-6">
              <b className="font-display text-[17px]">KYC stays yours</b>
              <p className="mb-3.5 mt-2.5 text-sm leading-normal text-dim">
                You already verified these clients. CCN links that status with their consent rather
                than re-collecting it, so a referral becomes a funded account instead of an
                abandoned form. You remain the regulated owner of KYC and AML.
              </p>
              {[
                { l: 'Verification reused (with consent)', v: '2,760', c: 'text-foreground' },
                { l: 'Re-verification required', v: '0', c: 'text-success' },
                { l: 'Onboarding time saved', v: '~6 days / client', c: 'text-foreground' },
              ].map((r) => (
                <div key={r.l} className="flex justify-between py-[5px] text-[13.5px]">
                  <span className="text-dim">{r.l}</span>
                  <span className={`font-bold ${r.c}`}>{r.v}</span>
                </div>
              ))}
            </Card>
          </div>
        </TabsContent>

        {/* Compliance */}
        <TabsContent value="compliance" className="mt-0">
          <div className="g-agent" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
            <Card className="h-fit border-none bg-primary p-6 text-[#eafaf5]">
              <div className="mb-4 flex items-center gap-2.5">
                <ShieldCheck className="h-[18px] w-[18px] text-[#8fe3c0]" />
                <b className="font-display text-base">Agreement &amp; residency</b>
              </div>
              {[
                { l: 'Regulator', v: 'FSC Jamaica', c: 'text-white' },
                { l: 'Partner agreement', v: 'Active', c: 'text-[#8fe3c0]' },
                { l: 'Data residency', v: 'In-region', c: 'text-white' },
                { l: 'CCN role', v: 'Orchestration only', c: 'text-white' },
                { l: 'Last audit', v: 'Jun 12, 2026', c: 'text-white' },
              ].map((r) => (
                <div key={r.l} className="flex justify-between py-1.5 text-sm">
                  <span className="opacity-[0.78]">{r.l}</span>
                  <span className={`font-bold ${r.c}`}>{r.v}</span>
                </div>
              ))}
            </Card>
            <Card className="p-6">
              <b className="font-display text-[17px]">Live audit trail</b>
              <div className="mt-3">
                {AUDIT.map((a) => (
                  <div key={a.action} className="flex gap-2.5 border-b border-border py-2.5">
                    <span
                      className="mt-[5px] h-[9px] w-[9px] flex-none rounded-full"
                      style={{ background: a.dot }}
                    />
                    <div className="flex-1">
                      <div className="text-sm text-[#33475b]">{a.action}</div>
                      <div className="mt-0.5 text-[12.5px] text-faint">{a.by}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>
      </main>
    </Tabs>
  );
}
