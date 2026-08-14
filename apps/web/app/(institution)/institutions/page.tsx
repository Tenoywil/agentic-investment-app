'use client';

import { ClientDetailDialog } from '@/app/_components/console/client-detail';
import { ClientsTab } from '@/app/_components/console/clients-tab';
import { ComplianceTab } from '@/app/_components/console/compliance-tab';
import { ConsoleHeader } from '@/app/_components/console/console-header';
import { ConsoleSidebar } from '@/app/_components/console/console-sidebar';
import type { TabKey } from '@/app/_components/console/lib';
import { errorMessage } from '@/app/_components/console/lib';
import { ListProductDialog } from '@/app/_components/console/list-product';
import { OrdersTab } from '@/app/_components/console/orders-tab';
import { OverviewTab } from '@/app/_components/console/overview-tab';
import { ProductsTab } from '@/app/_components/console/products-tab';
import { Tabs, TabsContent } from '@/app/_components/ui/tabs';
import { useMe } from '@/app/_lib/session';
import { useRealtime } from '@/app/_lib/use-realtime';
import { authClient } from '@/lib/auth-client';
import {
  type ConsoleAuditEntry,
  type ConsoleClient,
  type ConsoleFunnelStage,
  type ConsoleKpi,
  type ConsoleOrder,
  type ConsoleProduct,
  type ConsoleReconciliationItem,
  acceptOrder,
  getAudit,
  getClients,
  getFunnel,
  getKpis,
  getOrders,
  getProducts,
  getReconciliation,
  matchReconciliation,
  rejectOrder,
  rejectReconciliation,
  reviewClient,
  settleOrder,
  toggleProductLive,
} from '@/lib/console-api';
import { Menu } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The partner console: a dark-navy shell (Warm-themed shadcn) with Radix Tabs
 * driving the sidebar sections — the APG tab keyboard model (arrow keys, roving
 * focus, aria-selected) comes for free.
 *
 * This file is the data layer only; each tab lives in
 * app/_components/console/. It holds no copy and no identity of its own: the
 * operator's firm comes from `useMe().partner`, and everything else from
 * /api/console/*.
 *
 * There is deliberately no access-denied branch here any more.
 * `(institution)/layout.tsx` wraps this route in <RequireSurface
 * surface="institution">, which redirects a customer before the page mounts —
 * so the old "did any request 403? then render an explainer" state machine was
 * unreachable code guarding a door the layout had already locked.
 */
export default function InstitutionsPage() {
  const me = useMe();
  const partner = me?.partner ?? null;
  const [tab, setTab] = useState<TabKey>('overview');
  const [signingOut, setSigningOut] = useState(false);

  const [orders, setOrders] = useState<ConsoleOrder[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [products, setProducts] = useState<ConsoleProduct[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<ConsoleKpi[]>([]);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const [clients, setClients] = useState<ConsoleClient[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<ConsoleFunnelStage[]>([]);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ConsoleReconciliationItem[]>([]);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [audit, setAudit] = useState<ConsoleAuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  const [productBusyId, setProductBusyId] = useState<string | null>(null);
  const [productActionError, setProductActionError] = useState<string | null>(null);
  const [reconBusyId, setReconBusyId] = useState<string | null>(null);
  const [reconActionError, setReconActionError] = useState<string | null>(null);
  const [clientBusyId, setClientBusyId] = useState<string | null>(null);
  const [clientActionError, setClientActionError] = useState<string | null>(null);

  /**
   * Seven reads, and until this flag existed there was no way to tell "still
   * loading" from "nothing there". Every panel rendered its empty state in the
   * meantime, so opening the console told an operator they had no orders, no
   * clients and no referrals — three confident claims about their business,
   * made before a single response had arrived.
   */
  const [loading, setLoading] = useState(true);

  /**
   * How the order queue is narrowed. Held here rather than in the tab because
   * `load` is what fetches, and a filter that did not reach the fetch would be
   * a control that filters only what is already on screen — which on a bounded
   * list is a different answer from the one it appears to give.
   */
  const [orderStatus, setOrderStatus] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderOffset, setOrderOffset] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  const [clientTotal, setClientTotal] = useState(0);
  const ORDER_PAGE = 50;

  const load = useCallback(async () => {
    // Each panel reports its own failure. One route being down must not blank
    // the other four — an operator with a broken funnel query can still work
    // their order queue.
    const [ordersR, productsR, kpisR, clientsR, funnelR, reconR, auditR] = await Promise.allSettled(
      [
        getOrders({
          status: orderStatus || undefined,
          q: orderQuery || undefined,
          limit: ORDER_PAGE,
          offset: orderOffset,
        }),
        getProducts(),
        getKpis(),
        getClients(),
        getFunnel(),
        getReconciliation(),
        getAudit(50),
      ],
    );

    if (ordersR.status === 'fulfilled') {
      setOrders(ordersR.value.orders);
      setOrderTotal(ordersR.value.total);
      setOrdersError(null);
    } else setOrdersError(errorMessage(ordersR.reason, 'Could not load order flow.'));

    if (productsR.status === 'fulfilled') {
      setProducts(productsR.value.products);
      setProductsError(null);
    } else setProductsError(errorMessage(productsR.reason, 'Could not load products.'));

    if (kpisR.status === 'fulfilled') {
      setKpis(kpisR.value.kpis);
      setKpisError(null);
    } else setKpisError(errorMessage(kpisR.reason, 'Could not load KPIs.'));

    if (clientsR.status === 'fulfilled') {
      setClients(clientsR.value.clients);
      setClientTotal(clientsR.value.total);
      setClientsError(null);
    } else setClientsError(errorMessage(clientsR.reason, 'Could not load your clients.'));

    if (funnelR.status === 'fulfilled') {
      setFunnel(funnelR.value.stages);
      setFunnelError(null);
    } else setFunnelError(errorMessage(funnelR.reason, 'Could not load the onboarding funnel.'));

    if (reconR.status === 'fulfilled') {
      setReconciliation(reconR.value.items);
      setReconciliationError(null);
    } else
      setReconciliationError(errorMessage(reconR.reason, 'Could not load reconciliation items.'));

    if (auditR.status === 'fulfilled') {
      setAudit(auditR.value.entries);
      setAuditError(null);
    } else setAuditError(errorMessage(auditR.reason, 'Could not load the audit trail.'));

    setLoading(false);
  }, [orderStatus, orderQuery, orderOffset]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The console is a queue someone sits in front of. Everything that fills it is
   * done by somebody else — an investor authorising an order, a person asking to
   * become a client, a statement arriving — and none of it reached an open
   * console until the page was reloaded. The rail's "to accept" badge was only
   * ever as fresh as the last page load, which is the one number an operator
   * treats as a to-do list.
   */
  useRealtime(['order', 'connection', 'reconciliation', 'listing'], load);

  /** The only way off this surface. An operator cannot switch to the investor
   *  app — the API refuses customer routes for them — so the control that
   *  claimed to do that has become the one that really can: leaving. */
  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      // A full navigation, not a client-side push: it drops every cached
      // session and console response with the document.
      window.location.assign('/');
    }
  }

  /** Accept / settle / reject all return the updated row from the server. */
  function orderTransition(
    fn: (id: string, reason?: string) => Promise<{ order: ConsoleOrder }>,
    fallback: string,
  ) {
    return async (id: string, reason?: string) => {
      setOrderBusyId(id);
      setOrderActionError(null);
      try {
        const { order } = await fn(id, reason);
        setOrders((os) => os.map((o) => (o.id === id ? order : o)));
        // The transition wrote an audit row; pull the trail back into sync so
        // the compliance tab is not quietly stale.
        void getAudit(50)
          .then((r) => setAudit(r.entries))
          .catch(() => {});
      } catch (err) {
        setOrderActionError(errorMessage(err, fallback));
      } finally {
        setOrderBusyId(null);
      }
    };
  }

  const handleAccept = orderTransition(acceptOrder, 'Could not accept the order.');
  const handleSettle = orderTransition(settleOrder, 'Could not settle the order.');
  /**
   * The reason reaches the investor: `reject_order` writes `rejected_reason`,
   * `/orders` renders it, and without one they are told only that their
   * institution "did not take this order on". It was accepted by the client
   * function and the API all along and dropped right here.
   */
  const handleReject = orderTransition(
    (id, reason) => rejectOrder(id, reason),
    'Could not reject the order.',
  );

  /**
   * Optimistic flip, then reconcile to whatever the server says the status now
   * is; on failure put the previous value back rather than leaving the switch
   * showing a change that never happened.
   */
  /**
   * Listing a product. The created row is put straight into the catalogue
   * rather than triggering a refetch — the server has just returned the
   * authoritative row, and a reload here would blank the tab for a beat on a
   * cold API.
   */
  const [listingOpen, setListingOpen] = useState(false);
  /** The listing being amended. Undefined while `listingOpen` means "create". */
  const [editingProduct, setEditingProduct] = useState<ConsoleProduct | undefined>(undefined);
  /** The client whose drill-down is open. */
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const openClient = clients.find((c) => c.account_id === openClientId) ?? null;

  /** The phone navigation sheet; on a desktop this element is the rail. */
  const navRef = useRef<HTMLDialogElement>(null);

  async function handleToggleProductLive(id: string) {
    const previous = products.find((p) => p.id === id)?.status;
    if (!previous) return;
    setProductBusyId(id);
    setProductActionError(null);
    const optimistic = previous === 'live' ? 'paused' : 'live';
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, status: optimistic } : p)));
    try {
      const { status } = await toggleProductLive(id);
      setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
      void getAudit(50)
        .then((r) => setAudit(r.entries))
        .catch(() => {});
    } catch (err) {
      setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, status: previous } : p)));
      setProductActionError(errorMessage(err, 'Could not change this listing.'));
    } finally {
      setProductBusyId(null);
    }
  }

  /**
   * Accepting or declining a client. Not optimistic: this is the decision that
   * opens a firm's book to a person, and showing it as done before the server
   * has said so is the one place in this console where a lie would matter. The
   * row moves when the transition returns, and stays put when it fails.
   */
  async function handleReviewClient(id: string, accept: boolean, reason?: string) {
    setClientBusyId(id);
    setClientActionError(null);
    try {
      const { status } = await reviewClient(id, accept, reason);
      setClients((cs) =>
        cs.map((c) =>
          c.account_id === id
            ? {
                ...c,
                status,
                reviewed_at: new Date().toISOString(),
                decline_reason: status === 'declined' ? (reason ?? null) : null,
              }
            : c,
        ),
      );
      void getAudit(50)
        .then((r) => setAudit(r.entries))
        .catch(() => {});
    } catch (err) {
      setClientActionError(errorMessage(err, 'Could not record that decision.'));
    } finally {
      setClientBusyId(null);
    }
  }

  async function handleMatch(id: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await matchReconciliation(id);
      setReconciliation((items) => items.filter((i) => i.id !== id));
      void getAudit(50)
        .then((r) => setAudit(r.entries))
        .catch(() => {});
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not match this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  async function handleReconReject(id: string, reason?: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await rejectReconciliation(id, reason);
      setReconciliation((items) => items.filter((i) => i.id !== id));
      void getAudit(50)
        .then((r) => setAudit(r.entries))
        .catch(() => {});
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not reject this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      orientation="vertical"
      className="app-shell bg-background font-sans text-foreground"
    >
      {/* The phone bar. Same shape as the investor side: a compact header whose
          only job is to open the navigation, so the console itself starts at
          the top of the screen instead of 500px down it. */}
      <header className="console-topbar">
        <button
          type="button"
          onClick={() => navRef.current?.showModal()}
          aria-haspopup="dialog"
          aria-label="Open navigation"
          className="grid h-11 w-11 flex-none place-items-center rounded-[12px] text-[#d3e0da] transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Menu className="h-6 w-6" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-bold leading-tight text-white">
            {partner?.name ?? 'Partner console'}
          </div>
          <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#d3e0da]/70">
            Partner console
          </div>
        </div>
      </header>

      <ConsoleSidebar
        dialogRef={navRef}
        partner={partner}
        pendingOrders={ordersError ? 0 : orders.filter((o) => o.status === 'created').length}
        pendingReconciliation={reconciliationError ? 0 : reconciliation.length}
        signingOut={signingOut}
        onSignOut={handleSignOut}
      />

      <main className="min-w-0 flex-1 px-8 pb-[60px] pt-[26px]">
        <ConsoleHeader partner={partner} tab={tab} />

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            partner={partner}
            kpis={kpis}
            kpisError={kpisError}
            orders={orders}
            ordersError={ordersError}
            loading={loading}
            orderBusyId={orderBusyId}
            orderActionError={orderActionError}
            onAccept={handleAccept}
            onSettle={handleSettle}
            onReject={handleReject}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-0">
          <OrdersTab
            orders={orders}
            ordersError={ordersError}
            loading={loading}
            total={orderTotal}
            offset={orderOffset}
            pageSize={ORDER_PAGE}
            status={orderStatus}
            query={orderQuery}
            onStatus={(v) => {
              setOrderStatus(v);
              setOrderOffset(0);
            }}
            onQuery={(v) => {
              setOrderQuery(v);
              setOrderOffset(0);
            }}
            onPage={setOrderOffset}
            orderBusyId={orderBusyId}
            orderActionError={orderActionError}
            onAccept={handleAccept}
            onSettle={handleSettle}
            onReject={handleReject}
          />
        </TabsContent>

        {/* Held by id, not by value: the row updates when a decision lands,
            and a dialog holding its own copy would go on offering "Revoke" to
            a client it had just revoked. */}
        {openClient ? (
          <ClientDetailDialog
            client={openClient}
            busy={clientBusyId === openClient.account_id}
            actionError={clientActionError}
            onReview={handleReviewClient}
            onClose={() => setOpenClientId(null)}
          />
        ) : null}

        {listingOpen ? (
          <ListProductDialog
            product={editingProduct}
            onClose={() => {
              setListingOpen(false);
              setEditingProduct(undefined);
            }}
            onSaved={(product) => {
              // An amend replaces its row in place; a new listing goes to the
              // top. Keyed on the id the server returned rather than on
              // whether the dialog thought it was editing.
              setProducts((ps) =>
                ps.some((p) => p.id === product.id)
                  ? ps.map((p) => (p.id === product.id ? product : p))
                  : [product, ...ps],
              );
              void getAudit(50)
                .then((r) => setAudit(r.entries))
                .catch(() => {});
            }}
          />
        ) : null}

        <TabsContent value="products" className="mt-0">
          <ProductsTab
            onList={() => {
              setEditingProduct(undefined);
              setListingOpen(true);
            }}
            onEdit={(product) => {
              setEditingProduct(product);
              setListingOpen(true);
            }}
            products={products}
            productsError={productsError}
            loading={loading}
            productBusyId={productBusyId}
            productActionError={productActionError}
            onToggleLive={handleToggleProductLive}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-0">
          <ClientsTab
            clients={clients}
            clientsError={clientsError}
            loading={loading}
            total={clientTotal}
            clientBusyId={clientBusyId}
            clientActionError={clientActionError}
            onReviewClient={handleReviewClient}
            onOpenClient={(c) => setOpenClientId(c.account_id)}
            partner={partner}
            funnel={funnel}
            funnelError={funnelError}
            reconciliation={reconciliation}
            reconciliationError={reconciliationError}
            reconBusyId={reconBusyId}
            reconActionError={reconActionError}
            onMatch={handleMatch}
            onRejectItem={handleReconReject}
          />
        </TabsContent>

        <TabsContent value="compliance" className="mt-0">
          <ComplianceTab
            partner={partner}
            audit={audit}
            auditError={auditError}
            loading={loading}
          />
        </TabsContent>
      </main>
    </Tabs>
  );
}
