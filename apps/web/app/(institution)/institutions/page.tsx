'use client';

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
import { authClient } from '@/lib/auth-client';
import {
  type ConsoleAuditEntry,
  type ConsoleFunnelStage,
  type ConsoleKpi,
  type ConsoleOrder,
  type ConsoleProduct,
  type ConsoleReconciliationItem,
  acceptOrder,
  getAudit,
  getFunnel,
  getKpis,
  getOrders,
  getProducts,
  getReconciliation,
  matchReconciliation,
  rejectOrder,
  rejectReconciliation,
  settleOrder,
  toggleProductLive,
} from '@/lib/console-api';
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Each panel reports its own failure. One route being down must not blank
      // the other four — an operator with a broken funnel query can still work
      // their order queue.
      const [ordersR, productsR, kpisR, funnelR, reconR, auditR] = await Promise.allSettled([
        getOrders(),
        getProducts(),
        getKpis(),
        getFunnel(),
        getReconciliation(),
        getAudit(50),
      ]);
      if (cancelled) return;

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

      if (auditR.status === 'fulfilled') setAudit(auditR.value.entries);
      else setAuditError(errorMessage(auditR.reason, 'Could not load the audit trail.'));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  function orderTransition(fn: (id: string) => Promise<{ order: ConsoleOrder }>, fallback: string) {
    return async (id: string) => {
      setOrderBusyId(id);
      setOrderActionError(null);
      try {
        const { order } = await fn(id);
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
  const handleReject = orderTransition((id) => rejectOrder(id), 'Could not reject the order.');

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

  async function handleReconReject(id: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await rejectReconciliation(id);
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
      <ConsoleSidebar
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
            orderBusyId={orderBusyId}
            orderActionError={orderActionError}
            onAccept={handleAccept}
            onSettle={handleSettle}
            onReject={handleReject}
          />
        </TabsContent>

        {listingOpen ? (
          <ListProductDialog
            onClose={() => setListingOpen(false)}
            onListed={(product) => {
              setProducts((ps) => [product, ...ps]);
              void getAudit(50)
                .then((r) => setAudit(r.entries))
                .catch(() => {});
            }}
          />
        ) : null}

        <TabsContent value="products" className="mt-0">
          <ProductsTab
            onList={() => setListingOpen(true)}
            products={products}
            productsError={productsError}
            productBusyId={productBusyId}
            productActionError={productActionError}
            onToggleLive={handleToggleProductLive}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-0">
          <ClientsTab
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
          <ComplianceTab partner={partner} audit={audit} auditError={auditError} />
        </TabsContent>
      </main>
    </Tabs>
  );
}
