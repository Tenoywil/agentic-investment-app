'use client';

import { ClientDetailDialog } from '@/app/_components/console/client-detail';
import { ClientsTab } from '@/app/_components/console/clients-tab';
import { ComplianceTab } from '@/app/_components/console/compliance-tab';
import { ConsoleHeader, ConsoleMobileHeader } from '@/app/_components/console/console-header';
import { ConsoleMobileTabs, ConsoleSidebar } from '@/app/_components/console/console-sidebar';
import {
  type ConsoleResourceLoader,
  type TabKey,
  consoleTab,
  errorMessage,
  refreshCurrentLoaders,
} from '@/app/_components/console/lib';
import { BulkProductDialog, ListProductDialog } from '@/app/_components/console/list-product';
import { OrdersTab } from '@/app/_components/console/orders-tab';
import { OverviewTab } from '@/app/_components/console/overview-tab';
import { ProductsTab } from '@/app/_components/console/products-tab';
import { Button } from '@/app/_components/ui/button';
import { Tabs, TabsContent } from '@/app/_components/ui/tabs';
import { useMe, useSession } from '@/app/_lib/session';
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
  type ConsoleSummary,
  type ConsoleWithdrawal,
  type PartnerEquityPoint,
  type SettlementInput,
  acceptOrder,
  decideWithdrawal,
  getAudit,
  getClients,
  getFunnel,
  getKpis,
  getOrders,
  getPartnerEquityHistory,
  getProducts,
  getReconciliation,
  getWithdrawals,
  matchReconciliation,
  pullReconciliation,
  rejectOrder,
  rejectReconciliation,
  requestClientKyc,
  reviewClient,
  saveProduct,
  saveProductsBulk,
  settleOrder,
  toggleProductLive,
  updatePartner,
} from '@/lib/console-api';
import { LogOut } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const CONSOLE_PAGE_SIZE = 10;
const OVERVIEW_ORDER_LIMIT = 6;
type ConsoleLoaderKey =
  | 'orders'
  | 'products'
  | 'clients'
  | 'reconciliation'
  | 'withdrawals'
  | 'audit'
  | 'reference';

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
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  // The firm's own name comes from the session, so saving it has to refresh
  // the session — otherwise the sidebar and every header go on showing the old
  // one until a reload.
  const { refresh } = useSession();
  const partner = me?.partner ?? null;
  const [tab, setTab] = useState<TabKey>('overview');
  const [signingOut, setSigningOut] = useState(false);

  /**
   * Each console section has a durable browser route. This keeps refresh,
   * Back/Forward and copied links on the section the operator chose while
   * preserving any unrelated query parameters owned by the surrounding app.
   */
  useEffect(() => {
    const syncFromUrl = () => {
      setTab(consoleTab(new URLSearchParams(window.location.search).get('section')));
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const navigateToTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      window.scrollTo({ top: 0, behavior: 'auto' });
      const params = new URLSearchParams(window.location.search);
      if (next === 'overview') params.delete('section');
      else params.set('section', next);
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    },
    [pathname, router],
  );

  const [orders, setOrders] = useState<ConsoleOrder[]>([]);
  const [overviewOrders, setOverviewOrders] = useState<ConsoleOrder[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [overviewOrdersError, setOverviewOrdersError] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderOffset, setOrderOffset] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);

  const [products, setProducts] = useState<ConsoleProduct[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productStatus, setProductStatus] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [productOffset, setProductOffset] = useState(0);
  const [productTotal, setProductTotal] = useState(0);
  const productOffsetCurrent = useRef(productOffset);
  productOffsetCurrent.current = productOffset;

  const [clients, setClients] = useState<ConsoleClient[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientStatus, setClientStatus] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientOffset, setClientOffset] = useState(0);
  const [clientTotal, setClientTotal] = useState(0);

  const [reconciliation, setReconciliation] = useState<ConsoleReconciliationItem[]>([]);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(true);
  const [reconciliationOffset, setReconciliationOffset] = useState(0);
  const [reconciliationTotal, setReconciliationTotal] = useState(0);

  const [withdrawals, setWithdrawals] = useState<ConsoleWithdrawal[]>([]);
  const [withdrawalsError, setWithdrawalsError] = useState<string | null>(null);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(true);
  const [withdrawalOffset, setWithdrawalOffset] = useState(0);
  const [withdrawalTotal, setWithdrawalTotal] = useState(0);

  const [audit, setAudit] = useState<ConsoleAuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [decisionsOnly, setDecisionsOnly] = useState(false);

  const [kpis, setKpis] = useState<ConsoleKpi[]>([]);
  const [kpisError, setKpisError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConsoleSummary | null>(null);
  const [equity, setEquity] = useState<PartnerEquityPoint[]>([]);
  const [equityError, setEquityError] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<ConsoleFunnelStage[]>([]);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(true);

  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);
  const [productBusyId, setProductBusyId] = useState<string | null>(null);
  const [productActionError, setProductActionError] = useState<string | null>(null);
  const [reconBusyId, setReconBusyId] = useState<string | null>(null);
  const [reconActionError, setReconActionError] = useState<string | null>(null);
  const [withdrawalBusyId, setWithdrawalBusyId] = useState<string | null>(null);
  const [withdrawalActionError, setWithdrawalActionError] = useState<string | null>(null);
  const [clientBusyId, setClientBusyId] = useState<string | null>(null);
  const [clientActionError, setClientActionError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState<string | null>(null);
  // Filters, page clicks and realtime resyncs can overlap. Only the newest
  // request for a surface may replace its rows.
  const orderLoadSequence = useRef(0);
  const productLoadSequence = useRef(0);
  const clientLoadSequence = useRef(0);
  const reconciliationLoadSequence = useRef(0);
  const withdrawalLoadSequence = useRef(0);
  const auditLoadSequence = useRef(0);
  const referenceLoadSequence = useRef(0);

  const loadOrders = useCallback(
    async (showLoading = true) => {
      const request = ++orderLoadSequence.current;
      if (showLoading) setOrdersLoading(true);
      try {
        const result = await getOrders({
          status: orderStatus || undefined,
          q: orderQuery || undefined,
          limit: CONSOLE_PAGE_SIZE,
          offset: orderOffset,
        });
        if (request !== orderLoadSequence.current) return;
        setOrderTotal(result.total);
        setOrdersError(null);
        if (orderOffset > 0 && result.orders.length === 0 && result.total > 0) {
          setOrderOffset(Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE);
        } else {
          setOrders(result.orders);
        }
      } catch (err) {
        if (request !== orderLoadSequence.current) return;
        setOrdersError(errorMessage(err, 'Could not load order flow.'));
      } finally {
        if (request === orderLoadSequence.current) setOrdersLoading(false);
      }
    },
    [orderOffset, orderQuery, orderStatus],
  );

  const loadProducts = useCallback(
    async (showLoading = true) => {
      const request = ++productLoadSequence.current;
      if (showLoading) setProductsLoading(true);
      try {
        const result = await getProducts({
          status: productStatus || undefined,
          q: productQuery || undefined,
          limit: CONSOLE_PAGE_SIZE,
          offset: productOffset,
        });
        if (request !== productLoadSequence.current) return;
        setProductTotal(result.total);
        setProductsError(null);
        if (productOffset > 0 && result.products.length === 0 && result.total > 0) {
          setProductOffset(Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE);
        } else {
          setProducts(result.products);
        }
      } catch (err) {
        if (request !== productLoadSequence.current) return;
        setProductsError(errorMessage(err, 'Could not load products.'));
      } finally {
        if (request === productLoadSequence.current) setProductsLoading(false);
      }
    },
    [productOffset, productQuery, productStatus],
  );

  const loadClients = useCallback(
    async (showLoading = true) => {
      const request = ++clientLoadSequence.current;
      if (showLoading) setClientsLoading(true);
      try {
        const result = await getClients({
          status: clientStatus || undefined,
          q: clientQuery || undefined,
          limit: CONSOLE_PAGE_SIZE,
          offset: clientOffset,
        });
        if (request !== clientLoadSequence.current) return;
        setClientTotal(result.total);
        setClientsError(null);
        if (clientOffset > 0 && result.clients.length === 0 && result.total > 0) {
          setClientOffset(Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE);
        } else {
          setClients(result.clients);
        }
      } catch (err) {
        if (request !== clientLoadSequence.current) return;
        setClientsError(errorMessage(err, 'Could not load your clients.'));
      } finally {
        if (request === clientLoadSequence.current) setClientsLoading(false);
      }
    },
    [clientOffset, clientQuery, clientStatus],
  );

  const loadReconciliation = useCallback(
    async (showLoading = true) => {
      const request = ++reconciliationLoadSequence.current;
      if (showLoading) setReconciliationLoading(true);
      try {
        const result = await getReconciliation({
          limit: CONSOLE_PAGE_SIZE,
          offset: reconciliationOffset,
        });
        if (request !== reconciliationLoadSequence.current) return;
        setReconciliationTotal(result.total);
        setReconciliationError(null);
        if (reconciliationOffset > 0 && result.items.length === 0 && result.total > 0) {
          setReconciliationOffset(
            Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE,
          );
        } else {
          setReconciliation(result.items);
        }
      } catch (err) {
        if (request !== reconciliationLoadSequence.current) return;
        setReconciliationError(errorMessage(err, 'Could not load reconciliation items.'));
      } finally {
        if (request === reconciliationLoadSequence.current) setReconciliationLoading(false);
      }
    },
    [reconciliationOffset],
  );

  const loadWithdrawals = useCallback(
    async (showLoading = true) => {
      const request = ++withdrawalLoadSequence.current;
      if (showLoading) setWithdrawalsLoading(true);
      try {
        const result = await getWithdrawals({
          limit: CONSOLE_PAGE_SIZE,
          offset: withdrawalOffset,
        });
        if (request !== withdrawalLoadSequence.current) return;
        setWithdrawalTotal(result.total);
        setWithdrawalsError(null);
        if (withdrawalOffset > 0 && result.withdrawals.length === 0 && result.total > 0) {
          setWithdrawalOffset(
            Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE,
          );
        } else {
          setWithdrawals(result.withdrawals);
        }
      } catch (err) {
        if (request !== withdrawalLoadSequence.current) return;
        setWithdrawalsError(errorMessage(err, 'Could not load withdrawal requests.'));
      } finally {
        if (request === withdrawalLoadSequence.current) setWithdrawalsLoading(false);
      }
    },
    [withdrawalOffset],
  );

  const loadAudit = useCallback(
    async (showLoading = true) => {
      const request = ++auditLoadSequence.current;
      if (showLoading) setAuditLoading(true);
      try {
        const result = await getAudit({
          decisions: decisionsOnly,
          limit: CONSOLE_PAGE_SIZE,
          offset: auditOffset,
        });
        if (request !== auditLoadSequence.current) return;
        setAuditTotal(result.total);
        setAuditError(null);
        if (auditOffset > 0 && result.entries.length === 0 && result.total > 0) {
          setAuditOffset(Math.floor((result.total - 1) / CONSOLE_PAGE_SIZE) * CONSOLE_PAGE_SIZE);
        } else {
          setAudit(result.entries);
        }
      } catch (err) {
        if (request !== auditLoadSequence.current) return;
        setAuditError(errorMessage(err, 'Could not load the audit trail.'));
      } finally {
        if (request === auditLoadSequence.current) setAuditLoading(false);
      }
    },
    [auditOffset, decisionsOnly],
  );

  const loadReference = useCallback(async (showLoading = true) => {
    const request = ++referenceLoadSequence.current;
    if (showLoading) setReferenceLoading(true);
    const [kpisResult, funnelResult, equityResult, overviewOrdersResult] = await Promise.allSettled(
      [
        getKpis(),
        getFunnel(),
        getPartnerEquityHistory(),
        getOrders({ limit: OVERVIEW_ORDER_LIMIT, offset: 0 }),
      ],
    );
    if (request !== referenceLoadSequence.current) return;
    if (kpisResult.status === 'fulfilled') {
      setKpis(kpisResult.value.kpis);
      setSummary(kpisResult.value.summary);
      setKpisError(null);
    } else setKpisError(errorMessage(kpisResult.reason, 'Could not load KPIs.'));
    if (funnelResult.status === 'fulfilled') {
      setFunnel(funnelResult.value.stages);
      setFunnelError(null);
    } else
      setFunnelError(errorMessage(funnelResult.reason, 'Could not load the onboarding funnel.'));
    if (equityResult.status === 'fulfilled') {
      setEquity(equityResult.value.points);
      setEquityError(null);
    } else setEquityError(errorMessage(equityResult.reason, 'Could not load your growth history.'));
    if (overviewOrdersResult.status === 'fulfilled') {
      setOverviewOrders(overviewOrdersResult.value.orders);
      setOverviewOrdersError(null);
    } else
      setOverviewOrdersError(
        errorMessage(overviewOrdersResult.reason, 'Could not load the order preview.'),
      );
    if (request === referenceLoadSequence.current) setReferenceLoading(false);
  }, []);

  // Async mutations may finish after the operator changes a filter or page.
  // This ref is replaced every render, so their follow-up refresh resolves the
  // latest loader instead of the closure captured when the mutation started.
  const currentLoaders = useRef<Record<ConsoleLoaderKey, ConsoleResourceLoader>>({
    orders: loadOrders,
    products: loadProducts,
    clients: loadClients,
    reconciliation: loadReconciliation,
    withdrawals: loadWithdrawals,
    audit: loadAudit,
    reference: loadReference,
  });
  currentLoaders.current = {
    orders: loadOrders,
    products: loadProducts,
    clients: loadClients,
    reconciliation: loadReconciliation,
    withdrawals: loadWithdrawals,
    audit: loadAudit,
    reference: loadReference,
  };
  const refreshLatest = useCallback(
    (keys: readonly ConsoleLoaderKey[], showLoading = false) =>
      refreshCurrentLoaders(currentLoaders, keys, showLoading),
    [],
  );

  useEffect(() => void loadOrders(), [loadOrders]);
  useEffect(() => void loadProducts(), [loadProducts]);
  useEffect(() => void loadClients(), [loadClients]);
  useEffect(() => void loadReconciliation(), [loadReconciliation]);
  useEffect(() => void loadWithdrawals(), [loadWithdrawals]);
  useEffect(() => void loadAudit(), [loadAudit]);
  useEffect(() => void loadReference(), [loadReference]);

  const refreshConsole = useCallback(
    (showLoading = false) =>
      refreshLatest(
        ['orders', 'products', 'clients', 'reconciliation', 'withdrawals', 'audit', 'reference'],
        showLoading,
      ),
    [refreshLatest],
  );

  useRealtime(['order', 'connection', 'reconciliation', 'listing', 'withdrawal'], () =>
    refreshConsole(false),
  );

  async function handlePullStatements() {
    setPulling(true);
    setPullNote(null);
    try {
      const { clients: checkedClients, queued } = await pullReconciliation();
      setPullNote(
        queued === 0
          ? `Checked ${checkedClients} client account${checkedClients === 1 ? '' : 's'}. Nothing new to reconcile.`
          : `Checked ${checkedClients} client account${checkedClients === 1 ? '' : 's'}. ${queued} line${queued === 1 ? '' : 's'} queued below.`,
      );
      await refreshLatest(['reconciliation', 'audit', 'reference']);
    } catch (err) {
      setPullNote(errorMessage(err, 'Could not pull statements.'));
    } finally {
      setPulling(false);
    }
  }

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

  /**
   * Accept / settle / reject all return the updated row from the server.
   *
   * The second argument differs per transition — a settlement date, the
   * executed figures, a reason — so it is passed through untyped here and
   * narrowed at each call site below.
   */
  function orderTransition<A>(
    fn: (id: string, arg?: A) => Promise<{ order: ConsoleOrder }>,
    fallback: string,
  ) {
    return async (id: string, arg?: A): Promise<boolean> => {
      setOrderBusyId(id);
      setOrderActionError(null);
      try {
        const { order } = await fn(id, arg);
        setOrders((os) => os.map((o) => (o.id === id ? order : o)));
        void refreshLatest(['orders', 'audit', 'reference']);
        return true;
      } catch (err) {
        setOrderActionError(errorMessage(err, fallback));
        return false;
      } finally {
        setOrderBusyId(null);
      }
    };
  }

  // Accepting carries the settlement date the firm commits to; settling
  // carries what it actually executed. Both are optional at every layer.
  const handleAccept = orderTransition<string>(acceptOrder, 'Could not accept the order.');
  const handleSettle = orderTransition<SettlementInput>(settleOrder, 'Could not settle the order.');
  /**
   * The reason reaches the investor: `reject_order` writes `rejected_reason`,
   * `/orders` renders it, and without one they are told only that their
   * institution "did not take this order on". It was accepted by the client
   * function and the API all along and dropped right here.
   */
  const handleReject = orderTransition<string>(
    (id, reason) => rejectOrder(id, reason),
    'Could not reject the order.',
  );

  /**
   * The firm corrects its own record.
   *
   * Not optimistic: the name is what investors see beside every product this
   * firm lists, and showing it as changed before the server has accepted the
   * change would be showing a claim nobody has recorded.
   */
  async function handleSaveProfile(input: {
    name: string;
    kind?: string;
    residency?: string;
    fundingInstructions?: string;
    withdrawalFeeFlatMinor?: string;
    withdrawalFeeBps?: number;
    gctBps?: number;
  }) {
    setProfileSaving(true);
    setProfileError(null);
    try {
      await updatePartner(input);
      await refresh();
      void refreshLatest(['audit']);
    } catch (err) {
      setProfileError(errorMessage(err, 'Could not save your firm details.'));
    } finally {
      setProfileSaving(false);
    }
  }

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
  const [bulkListingOpen, setBulkListingOpen] = useState(false);
  /** The listing being amended. Undefined while `listingOpen` means "create". */
  const [editingProduct, setEditingProduct] = useState<ConsoleProduct | undefined>(undefined);
  /** The client whose drill-down is open. */
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const openClient = clients.find((c) => c.account_id === openClientId) ?? null;

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
      void refreshLatest(['products', 'audit', 'reference']);
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
      void refreshLatest(['clients', 'audit', 'reference']);
    } catch (err) {
      setClientActionError(errorMessage(err, 'Could not record that decision.'));
    } finally {
      setClientBusyId(null);
    }
  }

  /**
   * Asking a client to finish their shared intake. Not optimistic either: the row's "Asked
   * 2h ago" state comes from the server's own timestamp, and a refused ask
   * (already complete, or asked within the last day) reads back its reason.
   */
  async function handleRequestKyc(id: string) {
    setClientBusyId(id);
    setClientActionError(null);
    try {
      const { requestedAt } = await requestClientKyc(id);
      setClients((cs) =>
        cs.map((c) => (c.account_id === id ? { ...c, kyc_requested_at: requestedAt } : c)),
      );
      void refreshLatest(['clients', 'audit']);
    } catch (err) {
      setClientActionError(errorMessage(err, 'Could not send that request.'));
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
      void refreshLatest(['reconciliation', 'audit', 'reference']);
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not match this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  /**
   * Decide a withdrawal. Not optimistic: paying moves CCN's record of the
   * client's cash, and the server may refuse — an order can settle between the
   * request and the decision, leaving the recorded cash short. The row updates
   * when the server has actually recorded the decision.
   */
  async function handleDecideWithdrawal(
    id: string,
    input: { paid: true; reference?: string } | { paid: false; reason: string },
  ) {
    setWithdrawalBusyId(id);
    setWithdrawalActionError(null);
    try {
      await decideWithdrawal(id, input);
      const now = new Date().toISOString();
      setWithdrawals((ws) =>
        ws.map((w) =>
          w.id === id
            ? {
                ...w,
                status: input.paid ? ('paid' as const) : ('declined' as const),
                reference: input.paid ? (input.reference ?? null) : w.reference,
                reason: input.paid ? w.reason : input.reason,
                decidedAt: now,
              }
            : w,
        ),
      );
      void refreshLatest(['withdrawals', 'audit', 'reference']);
    } catch (err) {
      setWithdrawalActionError(errorMessage(err, 'Could not record that decision.'));
    } finally {
      setWithdrawalBusyId(null);
    }
  }

  async function handleReconReject(id: string, reason?: string) {
    setReconBusyId(id);
    setReconActionError(null);
    try {
      await rejectReconciliation(id, reason);
      setReconciliation((items) => items.filter((i) => i.id !== id));
      void refreshLatest(['reconciliation', 'audit', 'reference']);
    } catch (err) {
      setReconActionError(errorMessage(err, 'Could not reject this item.'));
    } finally {
      setReconBusyId(null);
    }
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => navigateToTab(v as TabKey)}
      orientation="vertical"
      className="app-shell bg-background font-sans text-foreground"
    >
      <ConsoleMobileHeader
        partnerName={partner?.name ?? 'Partner console'}
        context={me?.user.name ? `Signed in · ${me.user.name}` : 'Partner console'}
        action={
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 flex-none gap-2 px-3 text-[#d3e0da] hover:bg-white/10 hover:text-white"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        }
      />

      <ConsoleSidebar
        partner={partner}
        operator={me?.user ?? null}
        pendingOrders={summary?.createdOrders ?? 0}
        pendingReconciliation={summary?.pendingReconciliation ?? 0}
        signingOut={signingOut}
        onSignOut={handleSignOut}
      />

      <main className="min-w-0 flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:px-8 lg:pb-[60px] lg:pt-[26px]">
        <ConsoleHeader tab={tab} />

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            partner={partner}
            kpis={kpis}
            kpisError={kpisError}
            equity={equity}
            equityError={equityError}
            orders={overviewOrders}
            ordersError={overviewOrdersError}
            loading={referenceLoading}
            orderBusyId={orderBusyId}
            orderActionError={orderActionError}
            pendingOrders={summary?.createdOrders ?? 0}
            readyToSettleOrders={summary?.acceptedOrders ?? 0}
            hasAnyOrders={(summary?.totalOrders ?? 0) > 0}
            pendingReviews={summary?.pendingClients ?? 0}
            pendingReconciliation={summary?.pendingReconciliation ?? 0}
            pendingWithdrawals={summary?.pendingWithdrawals ?? 0}
            hasProducts={(summary?.products ?? 0) > 0}
            hasActiveClient={(summary?.activeClients ?? 0) > 0}
            onGoTab={navigateToTab}
            onListProduct={() => {
              setEditingProduct(undefined);
              setListingOpen(true);
            }}
            onAccept={handleAccept}
            onSettle={handleSettle}
            onReject={handleReject}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-0">
          <OrdersTab
            orders={orders}
            ordersError={ordersError}
            loading={ordersLoading}
            total={orderTotal}
            offset={orderOffset}
            pageSize={CONSOLE_PAGE_SIZE}
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
            onSave={saveProduct}
            onClose={() => {
              setListingOpen(false);
              setEditingProduct(undefined);
            }}
            onSaved={(product) => {
              setProducts((ps) =>
                ps.some((p) => p.id === product.id)
                  ? ps.map((p) => (p.id === product.id ? product : p))
                  : [product, ...ps],
              );
              if (productOffsetCurrent.current === 0) {
                void refreshLatest(['products', 'audit', 'reference']);
              } else {
                setProductOffset(0);
                void refreshLatest(['audit', 'reference']);
              }
            }}
          />
        ) : null}

        {bulkListingOpen ? (
          <BulkProductDialog
            onSave={saveProductsBulk}
            onClose={() => setBulkListingOpen(false)}
            onSaved={() => {
              if (productOffsetCurrent.current === 0) {
                void refreshLatest(['products', 'audit', 'reference']);
              } else {
                setProductOffset(0);
                void refreshLatest(['audit', 'reference']);
              }
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
            onBulk={() => setBulkListingOpen(true)}
            products={products}
            productsError={productsError}
            loading={productsLoading}
            total={productTotal}
            offset={productOffset}
            pageSize={CONSOLE_PAGE_SIZE}
            status={productStatus}
            query={productQuery}
            productBusyId={productBusyId}
            productActionError={productActionError}
            onToggleLive={handleToggleProductLive}
            onStatus={(value) => {
              setProductStatus(value);
              setProductOffset(0);
            }}
            onQuery={(value) => {
              setProductQuery(value);
              setProductOffset(0);
            }}
            onPage={setProductOffset}
          />
        </TabsContent>

        <TabsContent value="clients" className="mt-0">
          <ClientsTab
            clients={clients}
            clientsError={clientsError}
            clientsLoading={clientsLoading}
            clientTotal={clientTotal}
            pendingClientTotal={summary?.pendingClients ?? 0}
            clientOffset={clientOffset}
            clientPageSize={CONSOLE_PAGE_SIZE}
            clientStatus={clientStatus}
            clientQuery={clientQuery}
            clientBusyId={clientBusyId}
            clientActionError={clientActionError}
            onReviewClient={handleReviewClient}
            onRequestKyc={handleRequestKyc}
            onOpenClient={(c) => setOpenClientId(c.account_id)}
            partner={partner}
            funnel={funnel}
            funnelError={funnelError}
            pipelineLoading={referenceLoading}
            reconciliation={reconciliation}
            reconciliationError={reconciliationError}
            reconciliationLoading={reconciliationLoading}
            reconciliationTotal={reconciliationTotal}
            reconciliationOffset={reconciliationOffset}
            reconciliationPageSize={CONSOLE_PAGE_SIZE}
            reconBusyId={reconBusyId}
            reconActionError={reconActionError}
            onMatch={handleMatch}
            onRejectItem={handleReconReject}
            onPull={handlePullStatements}
            onClientStatus={(value) => {
              setClientStatus(value);
              setClientOffset(0);
            }}
            onClientQuery={(value) => {
              setClientQuery(value);
              setClientOffset(0);
            }}
            onClientPage={setClientOffset}
            onReconciliationPage={setReconciliationOffset}
            pulling={pulling}
            pullNote={pullNote}
            withdrawals={withdrawals}
            withdrawalsError={withdrawalsError}
            withdrawalsLoading={withdrawalsLoading}
            withdrawalTotal={withdrawalTotal}
            pendingWithdrawalTotal={summary?.pendingWithdrawals ?? 0}
            withdrawalOffset={withdrawalOffset}
            withdrawalPageSize={CONSOLE_PAGE_SIZE}
            withdrawalBusyId={withdrawalBusyId}
            withdrawalActionError={withdrawalActionError}
            onWithdrawalPage={setWithdrawalOffset}
            onDecideWithdrawal={handleDecideWithdrawal}
          />
        </TabsContent>

        <TabsContent value="compliance" className="mt-0">
          <ComplianceTab
            partner={partner}
            audit={audit}
            auditError={auditError}
            auditLoading={auditLoading}
            auditTotal={auditTotal}
            auditOffset={auditOffset}
            auditPageSize={CONSOLE_PAGE_SIZE}
            decisionsOnly={decisionsOnly}
            onDecisionsOnly={(value) => {
              setDecisionsOnly(value);
              setAuditOffset(0);
            }}
            onAuditPage={setAuditOffset}
            onSaveProfile={handleSaveProfile}
            profileSaving={profileSaving}
            profileError={profileError}
          />
        </TabsContent>
      </main>

      <ConsoleMobileTabs
        badges={{
          orders: summary?.createdOrders ?? 0,
          clients: summary?.pendingClients ?? 0,
          compliance: summary?.pendingReconciliation ?? 0,
        }}
      />
    </Tabs>
  );
}
