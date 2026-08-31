'use client';

import {
  DEFAULT_DEMO_PROFILE,
  DemoJourney,
  type DemoProfile,
  readDemoProfile,
} from '@/app/_components/AppScreen';
import { ConsoleHeader, ConsoleMobileHeader } from '@/app/_components/console/console-header';
import { ConsoleMobileTabs, ConsoleSidebar } from '@/app/_components/console/console-sidebar';
import type { TabKey } from '@/app/_components/console/lib';
import { BulkProductDialog, ListProductDialog } from '@/app/_components/console/list-product';
import { ConsolePager } from '@/app/_components/console/loading';
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
import { useEffect, useMemo, useState } from 'react';

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
  name: 'NCB Capital Markets · Demo desk',
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
const DEMO_PAGE_SIZE = 2;
const MARCUS_PROFILE: DemoProfile = { ...DEFAULT_DEMO_PROFILE, name: 'Marcus Bailey' };

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
    clientRef: 'Marcus Bailey · ••4821',
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

const OTHER_REVIEW_ITEMS = [
  {
    ref: 'Client ••517',
    issue: 'PEP disclosure requires human review',
    evidence: 'Declaration and source-of-funds files attached',
    demoClient: false,
  },
  {
    ref: 'Client ••904',
    issue: 'Source-of-funds variance flagged',
    evidence: 'Income range differs from intended funding amount',
    demoClient: false,
  },
  {
    ref: 'Client ••228',
    issue: 'Identity evidence needs operator verification',
    evidence: 'Shared intake is complete; the firm still owns final verification',
    demoClient: false,
  },
];

const OTHER_SAMPLE_DECISIONS = [
  ['Client acceptance recorded', 'Demo Operator · client ••10482'],
  ['Source-of-funds review requested', 'AML agent · client ••10517'],
  ['Order settlement recorded', 'Demo Operator · DEMO-SETTLE-1042'],
] as const;

export default function DemoInstitutionsPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [orderOffset, setOrderOffset] = useState(0);
  const [productStatus, setProductStatus] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [listingOpen, setListingOpen] = useState(false);
  const [bulkListingOpen, setBulkListingOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ConsoleProduct>();
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [profile, setProfile] = useState<DemoProfile>(MARCUS_PROFILE);

  useEffect(() => {
    const restored = readDemoProfile(MARCUS_PROFILE);
    const restoredName = restored.name.trim() || 'Sample investor';
    setProfile(restored);
    setOrders((current) =>
      current.map((order) =>
        order.id === 'demo-order-1' ? { ...order, clientRef: `${restoredName} · ••4821` } : order,
      ),
    );
  }, []);

  const citizenship = [
    profile.jamaicanCitizen ? 'Jamaican' : '',
    profile.usCitizen ? 'US' : '',
  ].filter(Boolean);
  const profileName = profile.name.trim() || 'Sample investor';
  const reviewItems = [
    {
      ref: `${profileName} · ••4821`,
      issue: 'Client review pack received',
      evidence: `Expired Jamaican passport replaced with valid US passport · ${citizenship.length > 0 ? `${citizenship.join(' + ')} citizenship declared` : 'citizenship requires clarification'} · response target 3 business days`,
      demoClient: true,
    },
    ...OTHER_REVIEW_ITEMS,
  ];
  const sampleDecisions = [
    [`${profileName} review pack received`, 'Compliance agent · client ••4821'],
    ...OTHER_SAMPLE_DECISIONS,
  ] as const;

  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter(
      (order) =>
        (!status || order.status === status) &&
        (!needle ||
          order.instrumentName?.toLowerCase().includes(needle) ||
          order.clientRef?.toLowerCase().includes(needle)),
    );
  }, [orders, query, status]);

  const visibleOrders = filteredOrders.slice(orderOffset, orderOffset + DEMO_PAGE_SIZE);
  const filteredProducts = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    return products.filter(
      (product) =>
        (!productStatus || product.status === productStatus) &&
        (!needle ||
          product.name.toLowerCase().includes(needle) ||
          product.abbr.toLowerCase().includes(needle) ||
          product.type?.toLowerCase().includes(needle)),
    );
  }, [productQuery, productStatus, products]);
  const visibleProducts = filteredProducts.slice(productOffset, productOffset + DEMO_PAGE_SIZE);
  const visibleReviews = reviewItems.slice(reviewOffset, reviewOffset + DEMO_PAGE_SIZE);
  const visibleDecisions = sampleDecisions.slice(auditOffset, auditOffset + DEMO_PAGE_SIZE);

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
    setOrderOffset(0);
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
    setOrderOffset(0);
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
    setOrderOffset(0);
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

  async function saveDemoProductsBulk(
    inputs: ProductInput[],
  ): Promise<{ products: ConsoleProduct[] }> {
    const now = new Date().toISOString();
    return {
      products: inputs.map((input, index) => ({
        id: `demo-bulk-product-${products.length + index + 1}`,
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
        status: 'paused',
        blocked: false,
        createdAt: now,
        updatedAt: now,
      })),
    };
  }

  const openListing = (product?: ConsoleProduct) => {
    setEditingProduct(product);
    setListingOpen(true);
  };

  const pendingOrders = orders.filter((order) => order.status === 'created').length;
  const pendingReviews = reviewItems.filter((item) => !reviewed.includes(item.ref)).length;
  const navigateDemoTab = (next: TabKey) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => navigateDemoTab(value as TabKey)}
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
        <DemoJourney current="partner" />

        {tab === 'overview' ? (
          <Card className="mb-[18px] flex flex-wrap items-center gap-3 border-[#cde0d8] bg-mint p-4">
            <UserCheck className="h-5 w-5 flex-none text-teal2" aria-hidden />
            <div className="min-w-0 flex-1">
              <b className="font-display text-base">{profileName}’s review pack is ready</b>
              <p className="mb-0 mt-0.5 text-sm text-dim">
                Valid replacement ID received · final client-acceptance decision belongs to NCB.
              </p>
            </div>
            <Button type="button" onClick={() => navigateDemoTab('clients')}>
              Review client
            </Button>
          </Card>
        ) : null}

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
            pendingOrders={pendingOrders}
            readyToSettleOrders={orders.filter((order) => order.status === 'accepted').length}
            hasAnyOrders={orders.length > 0}
            pendingReviews={pendingReviews}
            pendingReconciliation={0}
            pendingWithdrawals={0}
            hasProducts={products.length > 0}
            hasActiveClient
            onGoTab={navigateDemoTab}
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
            total={filteredOrders.length}
            offset={orderOffset}
            pageSize={DEMO_PAGE_SIZE}
            status={status}
            query={query}
            onStatus={(value) => {
              setStatus(value);
              setOrderOffset(0);
            }}
            onQuery={(value) => {
              setQuery(value);
              setOrderOffset(0);
            }}
            onPage={setOrderOffset}
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
            onSaved={(product) => {
              setProducts((current) =>
                current.some((item) => item.id === product.id)
                  ? current.map((item) => (item.id === product.id ? product : item))
                  : [product, ...current],
              );
              setProductOffset(0);
            }}
          />
        ) : null}

        {bulkListingOpen ? (
          <BulkProductDialog
            onSave={saveDemoProductsBulk}
            onClose={() => setBulkListingOpen(false)}
            onSaved={(imported) => {
              setProducts((current) => [...imported, ...current]);
              setProductOffset(0);
            }}
          />
        ) : null}

        <TabsContent value="products" className="mt-0">
          <ProductsTab
            products={visibleProducts}
            productsError={null}
            loading={false}
            total={filteredProducts.length}
            offset={productOffset}
            pageSize={DEMO_PAGE_SIZE}
            status={productStatus}
            query={productQuery}
            productBusyId={null}
            productActionError={null}
            onList={() => openListing()}
            onEdit={openListing}
            onBulk={() => setBulkListingOpen(true)}
            onStatus={(value) => {
              setProductStatus(value);
              setProductOffset(0);
            }}
            onQuery={(value) => {
              setProductQuery(value);
              setProductOffset(0);
            }}
            onPage={setProductOffset}
            onToggleLive={(id) => {
              setProducts((current) =>
                current.map((product) =>
                  product.id === id
                    ? { ...product, status: product.status === 'live' ? 'paused' : 'live' }
                    : product,
                ),
              );
              setProductOffset(0);
            }}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-0">
          <div className="g-held">
            <Card className="p-5 sm:p-6" data-tour="demo-institution-clients">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <b className="font-display text-lg">Client review queue</b>
                  <p className="mb-0 mt-1 text-[13px] text-faint">
                    Sample consented KYC and AML evidence awaiting a human decision. The partner,
                    not CCN, owns acceptance; this client’s response target is within 3 business
                    days.
                  </p>
                </div>
                <Badge>{pendingReviews} pending</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {visibleReviews.map((item) => {
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
                          {done
                            ? 'Decision recorded'
                            : item.demoClient
                              ? 'Accept client'
                              : 'Record review'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <ConsolePager
                label="Demo client review queue"
                total={reviewItems.length}
                offset={reviewOffset}
                pageSize={DEMO_PAGE_SIZE}
                visible={visibleReviews.length}
                onPage={setReviewOffset}
                className="-mx-5 -mb-5 mt-4 sm:-mx-6 sm:-mb-6"
              />
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
            <Card
              className="h-fit border-none bg-primary p-5 text-[#eafaf5] sm:p-6"
              data-tour="demo-institution-aml"
            >
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
            <Card className="p-5 sm:p-6" data-tour="demo-institution-decisions">
              <b className="font-display text-[17px]">Sample decision trail</b>
              <div className="mt-3 space-y-1">
                {visibleDecisions.map(([action, actor]) => (
                  <div
                    key={action}
                    className="border-x-0 border-t-0 border-b border-solid border-border py-3"
                  >
                    <div className="text-sm font-bold">{action}</div>
                    <div className="mt-0.5 text-[12.5px] text-faint">{actor}</div>
                  </div>
                ))}
              </div>
              <ConsolePager
                label="Demo decision trail"
                total={sampleDecisions.length}
                offset={auditOffset}
                pageSize={DEMO_PAGE_SIZE}
                visible={visibleDecisions.length}
                onPage={setAuditOffset}
                className="-mx-5 -mb-5 mt-4 sm:-mx-6 sm:-mb-6"
              />
            </Card>
          </div>
        </TabsContent>
      </main>

      <ConsoleMobileTabs badges={{ orders: pendingOrders, clients: pendingReviews }} />
    </Tabs>
  );
}
