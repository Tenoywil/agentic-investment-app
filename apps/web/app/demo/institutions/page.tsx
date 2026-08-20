'use client';

import { ConsoleHeader, ConsoleMobileHeader } from '@/app/_components/console/console-header';
import { ConsoleMobileTabs, ConsoleSidebar } from '@/app/_components/console/console-sidebar';
import type { TabKey } from '@/app/_components/console/lib';
import { ListProductDialog } from '@/app/_components/console/list-product';
import { OrdersTab } from '@/app/_components/console/orders-tab';
import { OverviewTab } from '@/app/_components/console/overview-tab';
import { ProductsTab } from '@/app/_components/console/products-tab';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Tabs, TabsContent } from '@/app/_components/ui/tabs';
import type {
  ConsoleKpi,
  ConsoleOrder,
  ConsoleProduct,
  PartnerEquityPoint,
  ProductInput,
  SettlementInput,
} from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowLeft, CheckCircle2, FileSearch, ShieldCheck, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

/**
 * Isolated partner-console rehearsal.
 *
 * This route shares presentational components with the authenticated console,
 * but every value and mutation below stays in React memory. It deliberately
 * imports the console contract as types only: there is no API client, session,
 * auth cookie or live data source available to this page.
 */

const PARTNER: MePartner = {
  id: 'demo-partner',
  code: 'DEMO-JM',
  name: 'Caribbean Capital Demo',
  kind: 'Broker-dealer',
  regulator: 'FSC_JAMAICA',
  agreementStatus: 'sandbox',
  residency: 'Jamaica',
  fundingInstructions: 'Sample wire instructions are configured for this rehearsal desk.',
  withdrawalFeeFlatMinor: '0',
  withdrawalFeeBps: 0,
  gctBps: 0,
};

const OPERATOR = { name: 'Demo Operator', email: 'operator@example.invalid' };

const INITIAL_ORDERS: ConsoleOrder[] = [
  {
    id: 'demo-order-1',
    userId: 'demo-client-1',
    partnerId: PARTNER.id,
    instrumentId: 'demo-product-1',
    instrumentName: 'Caribbean USD Income Fund',
    instrumentAbbr: 'CUIF',
    approvalId: 'demo-approval-1',
    status: 'created',
    amountMinor: '500000',
    currency: 'USD',
    idempotencyKey: 'demo-order-1',
    clientRef: 'Client ••4821',
    settlementEta: null,
    unitPriceMinor: null,
    units: null,
    feeMinor: null,
    externalRef: null,
    rejectedReason: null,
    createdBy: 'user',
    createdAt: '2026-08-20T11:40:00.000Z',
    updatedAt: '2026-08-20T11:40:00.000Z',
    acceptedAt: null,
    settledAt: null,
  },
  {
    id: 'demo-order-2',
    userId: 'demo-client-2',
    partnerId: PARTNER.id,
    instrumentId: 'demo-product-2',
    instrumentName: 'Regional Infrastructure Note 2032',
    instrumentAbbr: 'RIN32',
    approvalId: 'demo-approval-2',
    status: 'accepted',
    amountMinor: '1250000',
    currency: 'USD',
    idempotencyKey: 'demo-order-2',
    clientRef: 'Client ••7134',
    settlementEta: '2026-08-22T17:00:00.000Z',
    unitPriceMinor: null,
    units: null,
    feeMinor: null,
    externalRef: null,
    rejectedReason: null,
    createdBy: 'user',
    createdAt: '2026-08-20T09:15:00.000Z',
    updatedAt: '2026-08-20T09:30:00.000Z',
    acceptedAt: '2026-08-20T09:30:00.000Z',
    settledAt: null,
  },
  {
    id: 'demo-order-3',
    userId: 'demo-client-3',
    partnerId: PARTNER.id,
    instrumentId: 'demo-product-3',
    instrumentName: 'Jamaica Government Global Bond 2036',
    instrumentAbbr: 'JGB36',
    approvalId: 'demo-approval-3',
    status: 'settled',
    amountMinor: '850000',
    currency: 'USD',
    idempotencyKey: 'demo-order-3',
    clientRef: 'Client ••2290',
    settlementEta: '2026-08-20T16:00:00.000Z',
    unitPriceMinor: '10125',
    units: '83.9506',
    feeMinor: '2500',
    externalRef: 'DEMO-SETTLE-1042',
    rejectedReason: null,
    createdBy: 'user',
    createdAt: '2026-08-19T16:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    acceptedAt: '2026-08-19T16:15:00.000Z',
    settledAt: '2026-08-20T10:00:00.000Z',
  },
];

const INITIAL_PRODUCTS: ConsoleProduct[] = [
  {
    id: 'demo-product-1',
    name: 'Caribbean USD Income Fund',
    type: 'fund',
    abbr: 'CUIF',
    currency: 'USD',
    minInvestmentMinor: '100000',
    term: 'Open-ended',
    metric: '6.1%',
    metricLabel: 'sample trailing yield',
    risk: 'medium',
    description: 'Sample diversified regional fixed-income product.',
    region: 'Caribbean',
    status: 'live',
    blocked: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  },
  {
    id: 'demo-product-2',
    name: 'Regional Infrastructure Note 2032',
    type: 'bond',
    abbr: 'RIN32',
    currency: 'USD',
    minInvestmentMinor: '500000',
    term: 'Matures 2032',
    metric: '7.0%',
    metricLabel: 'sample coupon',
    risk: 'medium',
    description: 'Sample note for demonstrating product presentation and settlement.',
    region: 'Caribbean',
    status: 'live',
    blocked: false,
    createdAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  },
  {
    id: 'demo-product-3',
    name: 'Jamaica Government Global Bond 2036',
    type: 'bond',
    abbr: 'JGB36',
    currency: 'USD',
    minInvestmentMinor: '250000',
    term: 'Matures 2036',
    metric: 'Illustrative',
    metricLabel: 'demo terms only',
    risk: 'low',
    description: 'A sample listing; not an offer or live security record.',
    region: 'Jamaica',
    status: 'paused',
    blocked: false,
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  },
];

const KPIS: ConsoleKpi[] = [
  {
    id: 'demo-aum',
    label: 'Referred holdings (sample)',
    value: 'US$48.2M',
    sub: 'Demo fixture',
    sortOrder: 1,
  },
  {
    id: 'demo-clients',
    label: 'Funded clients (sample)',
    value: '1,284',
    sub: 'Demo fixture',
    sortOrder: 2,
  },
  {
    id: 'demo-settled',
    label: 'Orders settled (sample)',
    value: '486',
    sub: 'Demo fixture',
    sortOrder: 3,
  },
];

const EQUITY: PartnerEquityPoint[] = [
  { takenOn: '2026-08-14', heldMinor: '4210000000', clients: 1120 },
  { takenOn: '2026-08-16', heldMinor: '4450000000', clients: 1178 },
  { takenOn: '2026-08-18', heldMinor: '4670000000', clients: 1232 },
  { takenOn: '2026-08-20', heldMinor: '4820000000', clients: 1284 },
];

const REVIEW_ITEMS = [
  {
    ref: 'Client ••517',
    issue: 'PEP disclosure requires human review',
    evidence: 'Declaration and source-of-funds files attached',
  },
  {
    ref: 'Client ••904',
    issue: 'Source-of-funds variance flagged',
    evidence: 'Income range differs from intended funding amount',
  },
];

export default function DemoInstitutionsPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [listingOpen, setListingOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ConsoleProduct>();
  const [reviewed, setReviewed] = useState<string[]>([]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter(
      (order) =>
        (!status || order.status === status) &&
        (!needle ||
          order.instrumentName?.toLowerCase().includes(needle) ||
          order.clientRef?.toLowerCase().includes(needle)),
    );
  }, [orders, query, status]);

  async function acceptOrder(id: string, settlementEta?: string) {
    const now = new Date().toISOString();
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              status: 'accepted',
              settlementEta: settlementEta ?? null,
              acceptedAt: now,
              updatedAt: now,
            }
          : order,
      ),
    );
    return true;
  }

  async function settleOrder(id: string, detail?: SettlementInput) {
    const now = new Date().toISOString();
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? { ...order, ...detail, status: 'settled', settledAt: now, updatedAt: now }
          : order,
      ),
    );
    return true;
  }

  async function rejectOrder(id: string, reason?: string) {
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              status: 'rejected',
              rejectedReason: reason ?? null,
              updatedAt: new Date().toISOString(),
            }
          : order,
      ),
    );
    return true;
  }

  async function saveDemoProduct(input: ProductInput): Promise<{ product: ConsoleProduct }> {
    const existing = input.id ? products.find((product) => product.id === input.id) : undefined;
    const now = new Date().toISOString();
    return {
      product: {
        id: existing?.id ?? `demo-product-${products.length + 1}`,
        name: input.name,
        type: input.type,
        abbr: input.abbr ?? '',
        currency: input.currency ?? 'USD',
        minInvestmentMinor: input.minInvestmentMinor ?? '0',
        term: input.term ?? null,
        metric: input.metric ?? null,
        metricLabel: input.metricLabel ?? null,
        risk: input.risk,
        description: input.description ?? null,
        region: input.region ?? null,
        status: existing?.status ?? 'paused',
        blocked: existing?.blocked ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    };
  }

  const openListing = (product?: ConsoleProduct) => {
    setEditingProduct(product);
    setListingOpen(true);
  };

  const pendingOrders = orders.filter((order) => order.status === 'created').length;
  const pendingReviews = REVIEW_ITEMS.filter((item) => !reviewed.includes(item.ref)).length;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as TabKey)}
      orientation="vertical"
      className="app-shell bg-background font-sans text-foreground"
    >
      <ConsoleMobileHeader
        partnerName={PARTNER.name}
        context="Interactive sample data"
        action={
          <Button
            asChild
            variant="ghost"
            className="min-h-12 flex-none gap-2 px-3 text-[#d3e0da] hover:bg-white/10 hover:text-white"
          >
            <Link href="/demo/home">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Exit demo
            </Link>
          </Button>
        }
      />

      <ConsoleSidebar
        partner={PARTNER}
        operator={OPERATOR}
        pendingOrders={pendingOrders}
        pendingReconciliation={pendingReviews}
        signingOut={false}
        onSignOut={() => window.location.assign('/demo/home')}
        exitLabel="Exit partner demo"
      />

      <main
        className="min-w-0 flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:px-8 lg:pb-[60px] lg:pt-[26px]"
        data-tour="demo-institution-shell"
      >
        <ConsoleHeader tab={tab} />

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            partner={PARTNER}
            kpis={KPIS}
            kpisError={null}
            equity={EQUITY}
            equityError={null}
            orders={orders}
            ordersError={null}
            loading={false}
            orderBusyId={null}
            orderActionError={null}
            pendingReviews={pendingReviews}
            pendingReconciliation={0}
            pendingWithdrawals={0}
            hasProducts={products.length > 0}
            hasActiveClient
            onGoTab={setTab}
            onListProduct={() => openListing()}
            onAccept={acceptOrder}
            onSettle={settleOrder}
            onReject={rejectOrder}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-0">
          <OrdersTab
            orders={visibleOrders}
            ordersError={null}
            loading={false}
            total={visibleOrders.length}
            offset={0}
            pageSize={20}
            status={status}
            query={query}
            onStatus={setStatus}
            onQuery={setQuery}
            onPage={() => undefined}
            orderBusyId={null}
            orderActionError={null}
            onAccept={acceptOrder}
            onSettle={settleOrder}
            onReject={rejectOrder}
          />
        </TabsContent>

        {listingOpen ? (
          <ListProductDialog
            product={editingProduct}
            onSave={saveDemoProduct}
            onClose={() => {
              setListingOpen(false);
              setEditingProduct(undefined);
            }}
            onSaved={(product) =>
              setProducts((current) =>
                current.some((item) => item.id === product.id)
                  ? current.map((item) => (item.id === product.id ? product : item))
                  : [product, ...current],
              )
            }
          />
        ) : null}

        <TabsContent value="products" className="mt-0">
          <ProductsTab
            products={products}
            productsError={null}
            loading={false}
            productBusyId={null}
            productActionError={null}
            onList={() => openListing()}
            onEdit={openListing}
            onToggleLive={(id) =>
              setProducts((current) =>
                current.map((product) =>
                  product.id === id
                    ? { ...product, status: product.status === 'live' ? 'paused' : 'live' }
                    : product,
                ),
              )
            }
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-0">
          <div className="g-held">
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <b className="font-display text-lg">Client review queue</b>
                  <p className="mb-0 mt-1 text-[13px] text-faint">
                    Sample consented KYC and AML evidence awaiting a human decision.
                  </p>
                </div>
                <Badge>{pendingReviews} pending</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {REVIEW_ITEMS.map((item) => {
                  const done = reviewed.includes(item.ref);
                  return (
                    <div
                      key={item.ref}
                      className="rounded-2xl border border-solid border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs font-bold text-faint">{item.ref}</div>
                          <div className="mt-1 text-sm font-bold">{item.issue}</div>
                          <div className="mt-1 text-[13px] leading-snug text-dim">
                            {item.evidence}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={done ? 'outline' : 'default'}
                          disabled={done}
                          onClick={() => setReviewed((current) => [...current, item.ref])}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                          ) : (
                            <UserCheck className="h-4 w-4" aria-hidden />
                          )}
                          {done ? 'Reviewed' : 'Record review'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="h-fit border-border bg-[#f4f0e7] p-5 sm:p-6">
              <FileSearch className="h-5 w-5 text-teal2" aria-hidden />
              <b className="mt-3 block font-display text-[17px]">Evidence before automation</b>
              <p className="mb-0 mt-2 text-sm leading-relaxed text-dim">
                The agent organises declarations, consent, identity status and source-of-funds
                evidence. It can flag a policy condition; the licensed firm remains responsible for
                screening, escalation and the final AML decision.
              </p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="compliance" className="mt-0">
          <div className="g-agent g-agent--flip">
            <Card className="h-fit border-none bg-primary p-5 text-[#eafaf5] sm:p-6">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-5 w-5 text-[#8fe3c0]" aria-hidden />
                <b className="font-display text-base">AML agent coverage</b>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-relaxed">
                <p className="m-0">
                  Structures PEP declarations and source-of-funds evidence for review.
                </p>
                <p className="m-0">
                  Flags missing, inconsistent or policy-sensitive information without inventing a
                  screening result.
                </p>
                <p className="m-0">
                  Keeps operator decisions attributable in the audit record and ready for export.
                </p>
              </div>
            </Card>
            <Card className="p-5 sm:p-6">
              <b className="font-display text-[17px]">Sample decision trail</b>
              <div className="mt-3 space-y-1">
                {[
                  ['Client acceptance recorded', 'Demo Operator · client ••10482'],
                  ['Source-of-funds review requested', 'AML agent · client ••10517'],
                  ['Order settlement recorded', 'Demo Operator · DEMO-SETTLE-1042'],
                ].map(([action, actor]) => (
                  <div
                    key={action}
                    className="border-x-0 border-t-0 border-b border-solid border-border py-3"
                  >
                    <div className="text-sm font-bold">{action}</div>
                    <div className="mt-0.5 text-[12.5px] text-faint">{actor}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>
      </main>

      <ConsoleMobileTabs badges={{ orders: pendingOrders, clients: pendingReviews }} />
    </Tabs>
  );
}
