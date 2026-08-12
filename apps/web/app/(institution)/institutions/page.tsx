'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Switch } from '@/app/_components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/_components/ui/tabs';
import {
  ConsoleApiError,
  type ConsoleCurrency,
  type ConsoleFunnelStage,
  type ConsoleKpi,
  type ConsoleOrder,
  type ConsoleProduct,
  type ConsoleReconciliationItem,
  acceptOrder,
  getFunnel,
  getKpis,
  getOrders,
  getProducts,
  getReconciliation,
  matchReconciliation,
  rejectOrder,
  rejectReconciliation,
  settleOrder,
} from '@/lib/console-api';
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  CircleAlert,
  LayoutGrid,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/* The partner console: a dark-navy shell (Warm-themed shadcn) matching
   demo/assets/institutions.png. Radix Tabs drive the sidebar sections — the APG
   tab keyboard model (arrow keys, roving focus, aria-selected) comes for free.

   Every /api/console/* route requires the caller to hold the partner_operator
   role bound to a partner (apps/api/src/routes/console.ts's partnerScope()) —
   an ordinary signed-in customer gets a 403 from all of them. That's handled
   once, at the top level: if the initial batch of fetches comes back 403, we
   never mount the tabbed console at all, just a single explanatory screen. */

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

/* Static, illustrative content with no backing endpoint among the nine
   /api/console/* routes this screen wires up. Kept as clearly-labeled sample
   content rather than invented as if it were live. */
const WHY = [
  'Qualified, KYC-cleared demand into products you already run',
  'Diaspora reach without building cross-border onboarding',
  'Your name and regulator on every deal card, no channel conflict',
  'You keep execution, custody and settlement under your license',
];

const AGREEMENT_ROWS: { l: string; v: string; c: string }[] = [
  { l: 'Regulator', v: 'FSC Jamaica', c: 'text-white' },
  { l: 'Partner agreement', v: 'Active', c: 'text-[#8fe3c0]' },
  { l: 'Data residency', v: 'In-region', c: 'text-white' },
  { l: 'CCN role', v: 'Orchestration only', c: 'text-white' },
  { l: 'Last audit', v: 'Jun 12, 2026', c: 'text-white' },
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

const FUNNEL_COLORS = ['#6b6459', '#7fb5ad', '#17786e', '#124e48'];
const CURRENCY_PREFIX: Record<ConsoleCurrency, string> = { USD: 'US$', JMD: 'J$', TTD: 'TT$' };

const uppr = 'text-[11px] font-bold uppercase tracking-wider text-faint';
const errorText = 'flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra';
const TERRA_GHOST_BTN =
  'text-[#a44e20] hover:bg-[#f5e7d9] hover:text-[#a44e20] dark:text-terra dark:hover:bg-[#3a281c] dark:hover:text-terra';

function fmtMinor(minor: string, currency: ConsoleCurrency): string {
  const n = Number(minor) / 100;
  return `${CURRENCY_PREFIX[currency]}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Product AUM has no currency column (console products are USD-denominated
 *  by convention, matching the seeded fixtures); compact-formatted for the
 *  table like the original "US$14.2M" style. */
function fmtAumUSD(minor: string): string {
  const n = Number(minor) / 100;
  if (n >= 1_000_000) return `US$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `US$${(n / 1_000).toFixed(1)}K`;
  return `US$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Reconciliation rows carry `parsed` as untyped JSONB — the ingestion
 *  pipeline (apps/api/src/services/ingestion.ts) writes it as
 *  { name, valueMinor, currency, returnLabel? }, but nothing guarantees that
 *  shape at the type level, so this reads it defensively. */
interface ParsedHoldingGuess {
  name: string;
  valueMinor: string;
  currency: ConsoleCurrency;
  returnLabel?: string;
}

function guessParsedHolding(parsed: unknown): ParsedHoldingGuess | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.name !== 'string' ||
    typeof p.valueMinor !== 'string' ||
    (p.currency !== 'USD' && p.currency !== 'JMD' && p.currency !== 'TTD')
  ) {
    return null;
  }
  return {
    name: p.name,
    valueMinor: p.valueMinor,
    currency: p.currency,
    returnLabel: typeof p.returnLabel === 'string' ? p.returnLabel : undefined,
  };
}

function IllustrativeNote() {
  return (
    <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-[#f4f0e7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-faint dark:bg-white/[0.04]">
      Illustrative · not yet wired to a live endpoint
    </div>
  );
}

function OrderAction({
  order,
  busyId,
  compact,
  onAccept,
  onSettle,
  onReject,
}: {
  order: ConsoleOrder;
  busyId: string | null;
  compact?: boolean;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const busy = busyId === order.id;

  if (order.status === 'settled')
    return <span className="text-sm font-bold text-success">Settled ✓</span>;
  if (order.status === 'rejected')
    return <span className="text-sm font-bold text-[#a44e20] dark:text-terra">Rejected</span>;
  if (order.status === 'expired')
    return <span className="text-sm font-bold text-faint">Expired</span>;

  if (order.status === 'created') {
    return (
      <div className="flex justify-end gap-1.5">
        {!compact && (
          <Button
            size="sm"
            variant="ghost"
            className={TERRA_GHOST_BTN}
            disabled={busy}
            onClick={() => onReject(order.id)}
          >
            Reject
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => onAccept(order.id)}>
          {busy ? 'Accepting…' : 'Accept'}
        </Button>
      </div>
    );
  }

  // accepted → awaiting settlement
  return (
    <div className="flex justify-end gap-1.5">
      {!compact && (
        <Button
          size="sm"
          variant="ghost"
          className={TERRA_GHOST_BTN}
          disabled={busy}
          onClick={() => onReject(order.id)}
        >
          Reject
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="border-terra text-terra hover:bg-transparent hover:text-terra"
        disabled={busy}
        onClick={() => onSettle(order.id)}
      >
        {busy ? 'Settling…' : 'Settle'}
      </Button>
    </div>
  );
}

/** Sidebar + branding shared by the loading and access-denied states, before
 *  we know whether there's a real console to show. */
function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell bg-background font-sans text-foreground">
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
        <div className="flex-1" />
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
      <main className="flex min-w-0 flex-1 items-center justify-center px-8 pb-[60px] pt-[26px]">
        {children}
      </main>
    </div>
  );
}

type AccessState = 'checking' | 'denied' | 'granted';

export default function InstitutionsPage() {
  const [access, setAccess] = useState<AccessState>('checking');
  const [tab, setTab] = useState<TabKey>('overview');

  const [orders, setOrders] = useState<ConsoleOrder[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [products, setProducts] = useState<ConsoleProduct[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<ConsoleKpi[]>([]);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<ConsoleFunnelStage[]>([]);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ConsoleReconciliationItem[]>([]);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);

  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  const [reconBusyId, setReconBusyId] = useState<string | null>(null);
  const [reconActionError, setReconActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ordersR, productsR, kpisR, funnelR, reconR] = await Promise.allSettled([
        getOrders(),
        getProducts(),
        getKpis(),
        getFunnel(),
        getReconciliation(),
      ]);
      if (cancelled) return;

      // partnerScope() is the same check on every route, so a 403 on any one
      // of them means the whole console is off-limits — treat it as a single
      // top-level state rather than five separate "access required" tabs.
      const denied = [ordersR, productsR, kpisR, funnelR, reconR].some(
        (r) =>
          r.status === 'rejected' && r.reason instanceof ConsoleApiError && r.reason.status === 403,
      );
      if (denied) {
        setAccess('denied');
        return;
      }

      if (ordersR.status === 'fulfilled') setOrders(ordersR.value.orders);
      else setOrdersError(errorMessage(ordersR.reason, 'Could not load order flow.'));

      if (productsR.status === 'fulfilled') setProducts(productsR.value.products);
      else setProductsError(errorMessage(productsR.reason, 'Could not load products.'));

      if (kpisR.status === 'fulfilled') setKpis(kpisR.value.kpis);
      else setKpisError(errorMessage(kpisR.reason, 'Could not load KPIs.'));

      if (funnelR.status === 'fulfilled') setFunnel(funnelR.value.stages);
      else setFunnelError(errorMessage(funnelR.reason, 'Could not load the onboarding funnel.'));

      if (reconR.status === 'fulfilled') setReconciliation(reconR.value.items);
      else
        setReconciliationError(errorMessage(reconR.reason, 'Could not load reconciliation items.'));

      setAccess('granted');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAccept(id: string) {
    setOrderBusyId(id);
    setOrderActionError(null);
    try {
      const { order } = await acceptOrder(id);
      setOrders((os) => os.map((o) => (o.id === id ? order : o)));
    } catch (err) {
      setOrderActionError(errorMessage(err, 'Could not accept the order.'));
    } finally {
      setOrderBusyId(null);
    }
  }

  async function handleSettle(id: string) {
    setOrderBusyId(id);
    setOrderActionError(null);
    try {
      const { order } = await settleOrder(id);
      setOrders((os) => os.map((o) => (o.id === id ? order : o)));
    } catch (err) {
      setOrderActionError(errorMessage(err, 'Could not settle the order.'));
    } finally {
      setOrderBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setOrderBusyId(id);
    setOrderActionError(null);
    try {
      const { order } = await rejectOrder(id);
      setOrders((os) => os.map((o) => (o.id === id ? order : o)));
    } catch (err) {
      setOrderActionError(errorMessage(err, 'Could not reject the order.'));
    } finally {
      setOrderBusyId(null);
    }
  }

  async function handleMatch(id: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await matchReconciliation(id);
      setReconciliation((items) => items.filter((i) => i.id !== id));
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not match this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  async function handleReconReject(id: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await rejectReconciliation(id);
      setReconciliation((items) => items.filter((i) => i.id !== id));
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not reject this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  if (access === 'checking') {
    return (
      <ConsoleShell>
        <p className="text-[15px] text-dim">Loading partner console…</p>
      </ConsoleShell>
    );
  }

  if (access === 'denied') {
    return (
      <ConsoleShell>
        <Card className="max-w-[480px] p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 h-9 w-9 text-faint" aria-hidden />
          <h1 className="mb-2 font-display text-2xl font-bold">Partner console access required</h1>
          <p className="text-[15px] leading-relaxed text-dim">
            This console is only available to signed-in partner operators bound to a partner
            account. Your account doesn't currently hold the partner-operator role, so order flow,
            products, client and compliance data can't be loaded here — sign in with a partner
            operator account, or ask your administrator to grant that role.
          </p>
        </Card>
      </ConsoleShell>
    );
  }

  const pending = orders.filter((o) => o.status === 'created').length;
  const accepted = orders.filter((o) => o.status === 'accepted').length;
  const settled = orders.filter((o) => o.status === 'settled').length;

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
              {key === 'orders' && pending > 0 && !ordersError ? (
                <span className="min-w-[22px] rounded-full bg-peach px-1.5 py-px text-center text-xs font-bold text-[#3a2415]">
                  {pending}
                </span>
              ) : null}
              {key === 'clients' && reconciliation.length > 0 && !reconciliationError ? (
                <span className="min-w-[22px] rounded-full bg-peach px-1.5 py-px text-center text-xs font-bold text-[#3a2415]">
                  {reconciliation.length}
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
              <span className="text-[13.5px] text-dim">Live partner data</span>
              <Badge className="rounded-full px-3 py-1.5 text-[13px]">Partner view</Badge>
            </div>
          </div>
        </div>

        {/* Overview */}
        <TabsContent value="overview" className="mt-0">
          <div className="g4">
            {kpisError && (
              <p className={errorText}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {kpisError}
              </p>
            )}
            {kpis.map((k, i) => (
              <Card key={k.id} className="p-5">
                <div className="mb-2 text-[13.5px] text-dim">{k.label}</div>
                <div
                  className={`font-display text-[28px] font-bold tracking-tight ${i % 2 === 0 ? 'text-teal2' : 'text-foreground'}`}
                >
                  {k.value}
                </div>
                {k.sub && <div className="mt-1 text-[13px] text-faint">{k.sub}</div>}
              </Card>
            ))}
            <Card className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">Orders pending</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${pending ? 'text-terra' : 'text-foreground'}`}
              >
                {ordersError ? '—' : pending}
              </div>
              <div className="mt-1 text-[13px] text-faint">awaiting your accept</div>
            </Card>
            <Card className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">Settled this session</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${settled ? 'text-success' : 'text-foreground'}`}
              >
                {ordersError ? '—' : settled}
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
              {ordersError && (
                <p className={`mb-3 ${errorText}`}>
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {ordersError}
                </p>
              )}
              {orderActionError && (
                <p className={`mb-3 ${errorText}`}>
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {orderActionError}
                </p>
              )}
              {!ordersError && orders.length === 0 && (
                <p className="text-sm text-dim">No orders yet.</p>
              )}
              {!ordersError && orders.length > 0 && (
                <div className={`flex justify-between border-b border-border pb-2.5 ${uppr}`}>
                  <span>Product · Client</span>
                  <span className="flex gap-10">
                    <span>Amount</span>
                    <span>Action</span>
                  </span>
                </div>
              )}
              {orders.slice(0, 3).map((o) => (
                <div key={o.id} className="flex items-center gap-3 border-b border-border py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold">
                      {o.instrumentId ? `Instrument ${o.instrumentId.slice(0, 8)}` : 'Order'}
                    </div>
                    <div className="text-[12.5px] text-faint">
                      {o.clientRef ?? 'Client —'} · {timeAgo(o.createdAt)}
                    </div>
                  </div>
                  <span className="min-w-[78px] text-right font-mono text-sm font-bold">
                    {fmtMinor(o.amountMinor, o.currency)}
                  </span>
                  <div className="flex min-w-[92px] justify-end">
                    <OrderAction
                      order={o}
                      busyId={orderBusyId}
                      compact
                      onAccept={handleAccept}
                      onSettle={handleSettle}
                      onReject={handleReject}
                    />
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
                  {pending} to accept · {accepted} to settle · {settled} settled
                </div>
              </div>
              <div className="max-w-[360px] text-right text-[12.5px] leading-snug text-faint">
                Accept moves an order to your desk for execution. Settle confirms it back to the
                client's unified portfolio.
              </div>
            </div>
            {ordersError && (
              <p className={`px-6 pb-3.5 ${errorText}`}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {ordersError}
              </p>
            )}
            {orderActionError && (
              <p className={`px-6 pb-3.5 ${errorText}`}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {orderActionError}
              </p>
            )}
            {!ordersError && orders.length === 0 && (
              <p className="px-6 pb-5 text-sm text-dim">No orders yet.</p>
            )}
            {!ordersError && orders.length > 0 && (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div
                    className={`grid grid-cols-[2fr_1fr_0.9fr_1.3fr] border-b border-border px-6 pb-2 ${uppr}`}
                  >
                    <span>Order</span>
                    <span>Client</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">Status</span>
                  </div>
                  {orders.map((o) => (
                    <div
                      key={o.id}
                      className="grid grid-cols-[2fr_1fr_0.9fr_1.3fr] items-center border-b border-border px-6 py-3.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">
                          {o.instrumentId ? `Instrument ${o.instrumentId.slice(0, 8)}` : 'Order'}
                        </div>
                        <div className="text-xs text-faint">{timeAgo(o.createdAt)}</div>
                      </div>
                      <div className="text-[13.5px] text-[#45596d]">{o.clientRef ?? '—'}</div>
                      <div className="text-right font-mono text-sm font-bold">
                        {fmtMinor(o.amountMinor, o.currency)}
                      </div>
                      <div className="flex justify-end">
                        <OrderAction
                          order={o}
                          busyId={orderBusyId}
                          onAccept={handleAccept}
                          onSettle={handleSettle}
                          onReject={handleReject}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
            {productsError && (
              <p className={`px-6 pb-3.5 ${errorText}`}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {productsError}
              </p>
            )}
            {!productsError && products.length === 0 && (
              <p className="px-6 pb-5 text-sm text-dim">No products listed yet.</p>
            )}
            {!productsError && products.length > 0 && (
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
                  {products.map((p) => (
                    <div
                      key={p.id}
                      className="grid grid-cols-[2.2fr_1fr_1fr_0.9fr_1fr] items-center border-b border-border px-6 py-3.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold">{p.name}</div>
                        <div className="text-xs text-faint">{p.type ?? '—'}</div>
                      </div>
                      <div className="text-right text-sm text-[#45596d]">{p.clients}</div>
                      <div className="text-right font-mono text-[13.5px] font-bold">
                        {fmtAumUSD(p.aumMinor)}
                      </div>
                      <div className="text-right text-[13.5px] font-bold text-[#0a7a4c]">
                        {p.trend ?? '—'}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[13px] font-bold text-dim">
                          {p.status === 'live' ? 'Live' : 'Paused'}
                        </span>
                        <Switch
                          checked={p.status === 'live'}
                          disabled
                          aria-label={`${p.name} listing ${p.status} — read-only, no listing-status endpoint yet`}
                          title="Read-only: listing status has no write endpoint yet"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              {funnelError && (
                <p className={errorText}>
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {funnelError}
                </p>
              )}
              {!funnelError && funnel.length === 0 && (
                <p className="text-sm text-dim">No funnel data yet.</p>
              )}
              <div className="flex flex-col gap-[15px]">
                {funnel.map((k, i) => (
                  <div key={k.id}>
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-[14.5px] font-medium text-[#45596d]">{k.label}</span>
                      <span className="font-mono text-[14.5px] font-bold">
                        {k.count.toLocaleString('en-US')}
                      </span>
                    </div>
                    <div className="h-[9px] overflow-hidden rounded-md bg-[#ece6da]">
                      <div
                        className="h-full rounded-md"
                        style={{
                          width: `${k.pct}%`,
                          background: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="border-border bg-[#f4f0e7] p-6 dark:bg-white/[0.04]">
              <IllustrativeNote />
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

          <Card className="mt-[18px] p-6">
            <div className="mb-1 flex items-center justify-between">
              <b className="font-display text-lg">Pending reconciliation</b>
              {reconciliation.length > 0 && (
                <span className="text-sm font-bold text-terra">
                  {reconciliation.length} to review
                </span>
              )}
            </div>
            <div className="mb-4 text-[13px] text-faint">
              Statement lines ingested from partner records, awaiting a match to a client holding.
            </div>
            {reconciliationError && (
              <p className={`mb-3 ${errorText}`}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {reconciliationError}
              </p>
            )}
            {reconActionError && (
              <p className={`mb-3 ${errorText}`}>
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {reconActionError}
              </p>
            )}
            {!reconciliationError && reconciliation.length === 0 && (
              <p className="text-sm text-dim">No pending reconciliation items.</p>
            )}
            {reconciliation.map((item) => {
              const guess = guessParsedHolding(item.parsed);
              const busy = reconBusyId === item.id;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 border-b border-border py-3.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold">
                      {guess ? guess.name : `Statement line · ${item.source}`}
                    </div>
                    <div className="text-[12.5px] text-faint">
                      {timeAgo(item.createdAt)}
                      {guess?.returnLabel ? ` · ${guess.returnLabel}` : ''}
                    </div>
                  </div>
                  {guess && (
                    <span className="min-w-[78px] text-right font-mono text-sm font-bold">
                      {fmtMinor(guess.valueMinor, guess.currency)}
                    </span>
                  )}
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className={TERRA_GHOST_BTN}
                      disabled={busy}
                      onClick={() => handleReconReject(item.id)}
                    >
                      Reject
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => handleMatch(item.id)}>
                      {busy ? 'Matching…' : 'Match'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        </TabsContent>

        {/* Compliance */}
        <TabsContent value="compliance" className="mt-0">
          <div className="g-agent" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
            <Card className="h-fit border-none bg-primary p-6 text-[#eafaf5]">
              <div className="mb-4 flex items-center gap-2.5">
                <ShieldCheck className="h-[18px] w-[18px] text-[#8fe3c0]" />
                <b className="font-display text-base">Agreement &amp; residency</b>
              </div>
              <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#eafaf5]/80">
                Illustrative · not yet wired to a live endpoint
              </div>
              {AGREEMENT_ROWS.map((r) => (
                <div key={r.l} className="flex justify-between py-1.5 text-sm">
                  <span className="opacity-[0.78]">{r.l}</span>
                  <span className={`font-bold ${r.c}`}>{r.v}</span>
                </div>
              ))}
            </Card>
            <Card className="p-6">
              <b className="font-display text-[17px]">Live audit trail</b>
              <div className="mt-2">
                <IllustrativeNote />
              </div>
              <div className="mt-1">
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
