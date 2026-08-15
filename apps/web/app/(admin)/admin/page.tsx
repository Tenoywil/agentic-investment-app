'use client';

import {
  auditActionLabel,
  auditEntityLabel,
  auditReason,
  fmtMinor,
} from '@/app/_components/console/lib';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { useMe } from '@/app/_lib/session';
import {
  type AdminAuditEntry,
  type AdminInvestor,
  type AdminOrder,
  type AdminOverview,
  type AdminPartner,
  type AdminProduct,
  getAdminAudit,
  getAdminInvestors,
  getAdminOrders,
  getAdminOverview,
  getAdminPartners,
  getAdminProducts,
  loadAdminReferenceData,
  refreshAdminFxRates,
  toggleAdminProduct,
} from '@/lib/admin-api';
import { authClient } from '@/lib/auth-client';
import {
  Building2,
  CircleAlert,
  History,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { PartnerForm } from './partner-form';
import { PersonPanel } from './person';

/**
 * The administration console: the whole network in one place.
 *
 * Every other surface is scoped to a tenant, which is right and is also why
 * nobody could run the business — answering "who is stuck in onboarding" or
 * "what is this partner offering" meant a SQL client pointed at production.
 *
 * Read-only, and not by convention: the migration behind it grants `admin`
 * SELECT and nothing more, so the database refuses a write from here. Every
 * action that changes state stays on its existing path, where it is audited.
 *
 * Nothing on this screen is invented. Where the schema holds no answer, the
 * screen says so rather than showing a number — the standing rule everywhere in
 * this product, and it matters most here, because a figure on an administrative
 * console is read as the authoritative one.
 */

// "People", not "Investors": this list has always shown everyone on the network
// — operators and administrators included, with a Roles column saying which is
// which — and naming it for one of the three made the count beside it on
// Overview look wrong.
const TABS = ['Overview', 'People', 'Partners', 'Products', 'Orders', 'Activity'] as const;
type Tab = (typeof TABS)[number];

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';

/** "1 partner", "8 partners" — three of these sub-labels read "1 partners". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card className="p-[18px]">
      <div className={LABEL}>{label}</div>
      <div className="mt-1.5 font-display text-3xl font-bold tracking-[-.5px]">{value}</div>
      {sub ? <div className="mt-1 text-[13px] text-faint">{sub}</div> : null}
    </Card>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {message}
    </p>
  );
}

/**
 * The one table on this surface, and what it does on a phone.
 *
 * It used to be a fixed 640px-wide table inside a sideways scroller, which on a
 * 390px screen put the last column — the `Manage` button, the only control here
 * — off the right edge. The single thing this screen exists to do was reachable
 * only by discovering that the card scrolls horizontally.
 *
 * So the secondary columns are dropped below 680px rather than pushed off the
 * edge, and each row's first cell carries the same facts as a compact line
 * underneath the name. Nothing is lost and nothing scrolls sideways: a column
 * marked `wide` is desktop-only, and the phone summary lives in the cell that
 * survives, so the two presentations cannot disagree about what a row says.
 */
type Column = string | { label: string; wide: true };

function Table({ head, children }: { head: Column[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-solid border-border">
      <table className="w-full min-w-[640px] border-collapse text-[14px] max-[680px]:min-w-0">
        <thead>
          <tr className="border-0 border-b border-solid border-border bg-muted/40">
            {head.map((h) => {
              const label = typeof h === 'string' ? h : h.label;
              const wide = typeof h !== 'string';
              return (
                <th
                  key={label}
                  className={`px-3.5 py-2.5 text-left ${LABEL} ${wide ? 'max-[680px]:hidden' : ''}`}
                  scope="col"
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const CELL = 'border-0 border-b border-solid border-border px-3.5 py-2.5 align-top';
/** A cell whose column is dropped on a phone; its content moves into `PhoneOnly`. */
const CELL_WIDE = `${CELL} max-[680px]:hidden`;

/** The secondary facts, folded under the row's name below 680px. */
function PhoneOnly({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 hidden flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-dim max-[680px]:flex">
      {children}
    </div>
  );
}

/** Onboarding as one word, from the four flags the schema actually keeps. */
function onboardingState(i: AdminInvestor): { label: string; tone: 'ok' | 'part' | 'none' } {
  const done = [
    i.identityVerified,
    i.complianceConfirmed,
    i.riskCompleted,
    i.fundsConfirmed,
  ].filter(Boolean).length;
  if (done === 4) return { label: 'Complete', tone: 'ok' };
  if (done === 0) return { label: 'Not started', tone: 'none' };
  return { label: `${done} of 4`, tone: 'part' };
}

export default function AdminPage() {
  const me = useMe();
  const [tab, setTab] = React.useState<Tab>('Overview');

  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [investors, setInvestors] = React.useState<AdminInvestor[] | null>(null);
  const [partners, setPartners] = React.useState<AdminPartner[] | null>(null);
  const [products, setProducts] = React.useState<AdminProduct[] | null>(null);
  const [orders, setOrders] = React.useState<AdminOrder[] | null>(null);
  const [audit, setAudit] = React.useState<AdminAuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** The person whose detail panel is open, if any. */
  const [selected, setSelected] = React.useState<string | null>(null);
  /**
   * Finding a person. A list capped at 200 with no way to narrow it is not a
   * way to find someone — it is a way to scroll past them. The query re-runs
   * the server search, matched on the two things an administrator is actually
   * handed: a name or an email.
   */
  const [personQuery, setPersonQuery] = React.useState('');
  /** The listing being paused or restored, and why it failed if it did. */
  const [productBusy, setProductBusy] = React.useState<string | null>(null);
  const [productError, setProductError] = React.useState<string | null>(null);

  async function toggleProduct(id: string) {
    setProductBusy(id);
    setProductError(null);
    try {
      const { status } = await toggleAdminProduct(id);
      setProducts((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, status } : p)));
    } catch (err) {
      setProductError(err instanceof Error ? err.message : 'Could not change the listing.');
    } finally {
      setProductBusy(null);
    }
  }
  /**
   * The partner form: `null` closed, `'new'` onboarding, or the partner being
   * corrected. One piece of state rather than two booleans, because "onboarding"
   * and "editing SAG" are the same dialog and cannot both be open.
   */
  const [partnerForm, setPartnerForm] = React.useState<AdminPartner | 'new' | null>(null);
  /** True once unmounted, so a slow response cannot set state afterwards. */
  const gone = React.useRef(false);
  React.useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);

  /**
   * Everything at once: six small reads, and an administrator moves between the
   * tabs constantly. Loading per tab would put a spinner on every click.
   *
   * Callable rather than an effect keyed on a counter, so a role change can ask
   * for fresh data directly — the roles column behind the detail panel is stale
   * the moment a grant lands otherwise.
   */
  /** When what is on screen was read, so "is this current?" has an answer. */
  const [loadedAt, setLoadedAt] = React.useState<Date | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(() => {
    setRefreshing(true);
    return Promise.all([
      getAdminOverview(),
      getAdminInvestors(personQuery),
      getAdminPartners(),
      getAdminProducts(),
      getAdminOrders(),
      getAdminAudit(),
    ])
      .then(([o, i, pa, pr, or, au]) => {
        if (gone.current) return;
        setOverview(o);
        setInvestors(i.investors);
        setPartners(pa.partners);
        setProducts(pr.products);
        setOrders(or.orders);
        setAudit(au.entries);
        setLoadedAt(new Date());
        setError(null);
      })
      .catch((err: unknown) => {
        if (!gone.current) {
          setError(err instanceof Error ? err.message : 'Could not load the network.');
        }
      })
      .finally(() => {
        if (!gone.current) setRefreshing(false);
      });
  }, [personQuery]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * Read again when this tab comes back to the front.
   *
   * The screen fetched once on mount and never again, so an administrator who
   * onboarded a partner in one tab and came back to this one was reading numbers
   * from before they did it. The dashboard was not wrong — it was describing a
   * moment that had passed, while looking exactly like a live one.
   *
   * No polling: a timer would burn a free-tier API for nobody. What an
   * administrator actually notices is the answer being current when they turn
   * back to it.
   */
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const loading = !error && overview === null;

  /**
   * Loading the catalog, on a deployment that has none.
   *
   * Kept on this screen rather than left to a script, because a database with
   * no partners has no institution side at all — an operator cannot be bound to
   * anything — and the only alternative was somebody running the seed against
   * production from a laptop.
   */
  const [seeding, setSeeding] = React.useState(false);
  const [seedError, setSeedError] = React.useState<string | null>(null);
  const needsReferenceData = !loading && !error && partners !== null && partners.length === 0;

  function loadReferenceData() {
    setSeeding(true);
    setSeedError(null);
    loadAdminReferenceData()
      .then(() => load())
      .catch((err: unknown) => {
        setSeedError(err instanceof Error ? err.message : 'Could not load the catalog.');
      })
      .finally(() => setSeeding(false));
  }

  /**
   * Pull today's rates from the central banks that publish them.
   *
   * Every conversion in the product used to run on three constants compiled into
   * @ccn/money, because `convert()` takes an optional table and no caller passed
   * one. Rates now come from `fx_rates`, which means somebody has to fill it —
   * a scheduled job does, and this is the button for when it matters now. A bank
   * that cannot be reached leaves its stored rate alone and the portfolio screen
   * reports it as stale, so pressing this can never make a number worse.
   */
  const [refreshingFx, setRefreshingFx] = React.useState(false);
  const [fxNote, setFxNote] = React.useState<string | null>(null);
  const [fxError, setFxError] = React.useState<string | null>(null);

  function refreshFx() {
    setRefreshingFx(true);
    setFxNote(null);
    setFxError(null);
    refreshAdminFxRates()
      .then((r) => {
        const updated = r.updated.length > 0 ? `Updated ${r.updated.join(', ')}.` : 'None updated.';
        const failed =
          r.failed.length > 0
            ? ` ${r.failed.map((f) => `${f.source} unreachable`).join('; ')} — the stored rate stands.`
            : '';
        setFxNote(`${updated}${failed}`);
      })
      .catch((err: unknown) => {
        setFxError(err instanceof Error ? err.message : 'Could not reach the rate publishers.');
      })
      .finally(() => setRefreshingFx(false));
  }

  const referenceAction = (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" size="sm" onClick={loadReferenceData} disabled={seeding}>
        {seeding ? 'Loading…' : 'Load the catalog'}
      </Button>
      {seedError ? <Failed message={seedError} /> : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="border-0 border-b border-solid border-border bg-card">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-6 py-3.5 max-[680px]:px-4 max-[680px]:py-2.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[11px] bg-primary font-display text-[17px] font-bold text-white">
            C
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[15px] font-bold tracking-tight">
              {/* The full name on a desktop; on a phone it wrapped to two
                  lines above a badge that already says whose product this is. */}
              <span className="max-[680px]:hidden">Caribbean Capital Network · </span>Administration
            </div>
            <div className="truncate text-[13px] text-dim">{me?.user.email ?? ''}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void authClient.signOut().then(() => {
                window.location.href = '/';
              });
            }}
            className="rounded-[10px] border border-solid border-border px-3 py-2 text-[14px] font-semibold text-foreground"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 pb-16 pt-6 max-[680px]:px-4 max-[680px]:pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight max-[680px]:text-2xl">
            The network
          </h1>
          {/* When this was read, and a way to read it again. Every figure here is
              a count taken at a moment; without saying which moment, a dashboard
              left open in a background tab quietly becomes a historical document
              that still looks live. */}
          <div className="flex items-center gap-3">
            {loadedAt ? (
              <span className="text-[12.5px] text-faint">
                Read at{' '}
                {loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={refreshFx}
              disabled={refreshingFx}
              title="Pull today's USD rates from the central banks that publish them"
            >
              {refreshingFx ? 'Pulling rates…' : 'Refresh FX rates'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden
              />
              {refreshing ? 'Reading…' : 'Refresh'}
            </Button>
          </div>
        </div>
        {/* The strapline explains the surface to someone seeing it for the first
            time, and on a phone it cost four lines above the content it was
            explaining. It stays for a screen reader at every size. */}
        <p className="mt-1 text-[14.5px] text-dim max-[680px]:sr-only">
          Every investor, partner, product and order, read across all tenants. This surface makes no
          changes — actions stay on their own audited paths.
        </p>

        {fxNote ? <output className="mt-2 block text-[13px] text-dim">{fxNote}</output> : null}
        {fxError ? <Failed message={fxError} /> : null}

        {/* One scrolling row on a phone rather than two wrapped lines: six tabs
            wrapped took another 90px off the top of a 390px screen. */}
        <div
          className="mt-5 flex flex-wrap gap-1.5 border-0 border-b border-solid border-border pb-2 max-[680px]:mt-3 max-[680px]:flex-nowrap max-[680px]:overflow-x-auto"
          role="tablist"
          aria-label="Administration sections"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-none rounded-[10px] px-3.5 py-2 text-[14px] font-semibold ${
                tab === t ? 'bg-primary text-white' : 'text-dim hover:bg-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="pt-5">
          {error ? <Failed message={error} /> : null}

          {/* The one thing that blocks everything else, said on whichever tab
              you happen to be on rather than only the one that is empty. */}
          {needsReferenceData && tab !== 'Partners' ? (
            <Card className="mb-[18px] flex flex-wrap items-center justify-between gap-4 p-[18px]">
              <div className="min-w-0">
                <div className="font-display text-[15.5px] font-bold">
                  This network has no catalog yet
                </div>
                <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-dim">
                  No partners, so no operator can be bound and nothing can be listed. Loading the
                  catalog adds the regional institutions, their instruments, the planning products
                  and the FX rates — real reference data, and no demo accounts.
                </p>
              </div>
              {referenceAction}
            </Card>
          ) : null}

          {loading ? (
            <SkeletonRegion label="Loading the network">
              <div className="g4 mb-[18px]">
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
              </div>
              <SkeletonCard lines={6} />
            </SkeletonRegion>
          ) : null}

          {!loading && !error && tab === 'Overview' && overview ? (
            <>
              <div className="g4">
                {/* People, not role rows. This said "Investors" over the count
                    of `customer` roles while the tab beside it listed everyone
                    on the network — the same word twice on one screen, nine
                    apart. Roles are granted on a person's first authenticated
                    request, so anyone who signed up and has not come back holds
                    none, and the two counts legitimately differ. */}
                <Stat
                  label="People"
                  value={overview.people.total}
                  sub={`${plural(overview.people.customers, 'investor')} · ${plural(overview.people.operators, 'operator')}`}
                />
                <Stat
                  label="Partner operators"
                  value={overview.people.operators}
                  sub={`${plural(overview.partners.total, 'partner')} on the network`}
                />
                <Stat
                  label="Products on the marketplace"
                  value={overview.products.live}
                  sub={
                    overview.products.paused > 0
                      ? `${overview.products.paused} paused · ${overview.products.total} listed in all`
                      : `${overview.products.total} listed in all`
                  }
                />
                <Stat
                  label="Orders"
                  value={overview.orders.total}
                  sub={`${overview.orders.settled} settled`}
                />
              </div>

              <div className="g2 mt-[18px]">
                <Card className="p-[22px]">
                  <div className={LABEL}>Onboarding</div>
                  <dl className="mt-3 space-y-2 text-[14.5px]">
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Started</dt>
                      <dd className="font-semibold">{overview.onboarding.started}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">No tier yet</dt>
                      <dd className="font-semibold">{overview.onboarding.tierNone}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Tier 1</dt>
                      <dd className="font-semibold">{overview.onboarding.tier1}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Tier 2</dt>
                      <dd className="font-semibold">{overview.onboarding.tier2}</dd>
                    </div>
                  </dl>
                </Card>

                <Card className="p-[22px]">
                  <div className={LABEL}>Order flow</div>
                  <dl className="mt-3 space-y-2 text-[14.5px]">
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Awaiting a partner</dt>
                      <dd className="font-semibold">{overview.orders.created}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Accepted</dt>
                      <dd className="font-semibold">{overview.orders.accepted}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Settled</dt>
                      <dd className="font-semibold">{overview.orders.settled}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-dim">Rejected</dt>
                      <dd className="font-semibold">{overview.orders.rejected}</dd>
                    </div>
                    <div className="flex justify-between gap-4 border-0 border-t border-solid border-border pt-2">
                      <dt className="text-dim">Approvals waiting on investors</dt>
                      <dd className="font-semibold">{overview.approvals.pending}</dd>
                    </div>
                  </dl>
                </Card>
              </div>

              {/* Said plainly rather than shown as a zero. CCN has no billing or
                  subscription table, so there is no honest figure to put here,
                  and a placeholder on an administrative console is read as the
                  authoritative number. */}
              <Card className="mt-[18px] p-[22px]">
                <div className={LABEL}>Subscriptions and billing</div>
                <p className="mt-2 text-[14.5px] leading-relaxed text-dim">
                  Not part of this system. CCN holds no subscription, plan or billing records —
                  revenue is settled between the investor and the licensed partner. There is nothing
                  to report here until that changes.
                </p>
              </Card>
            </>
          ) : null}

          {!loading && !error && tab === 'People' && investors ? (
            <>
              <form
                className="mb-3.5 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  setPersonQuery(String(data.get('q') ?? '').trim());
                }}
              >
                <label className="min-w-[220px] flex-1">
                  <span className="sr-only">Search people by name or email</span>
                  <input
                    name="q"
                    defaultValue={personQuery}
                    placeholder="Search by name or email"
                    className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                  />
                </label>
                <Button type="submit" size="sm" variant="outline">
                  Search
                </Button>
                {personQuery ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPersonQuery('')}
                  >
                    Clear
                  </Button>
                ) : null}
              </form>
              {selected ? (
                <PersonPanel
                  id={selected}
                  partners={partners ?? []}
                  onClose={() => setSelected(null)}
                  onChanged={load}
                />
              ) : null}
              {investors.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Nobody has signed in yet"
                  body="Everyone who signs in appears here, with how far through onboarding they are and what they hold."
                />
              ) : (
                <Table
                  head={[
                    'Person',
                    { label: 'Roles', wide: true },
                    { label: 'KYC tier', wide: true },
                    { label: 'Onboarding', wide: true },
                    { label: 'Holds', wide: true },
                    { label: 'Residency', wide: true },
                    '',
                  ]}
                >
                  {investors.map((i) => {
                    const state = onboardingState(i);
                    return (
                      <tr key={i.id}>
                        <td className={CELL}>
                          <div className="font-semibold">{i.name || '—'}</div>
                          <div className="break-all text-[13px] text-dim">{i.email}</div>
                          <PhoneOnly>
                            {i.roles.length ? (
                              i.roles.map((r) => (
                                <Badge key={r} variant="secondary">
                                  {r.replace('_', ' ')}
                                  {r === 'partner_operator' && i.partnerCode
                                    ? ` · ${i.partnerCode}`
                                    : ''}
                                </Badge>
                              ))
                            ) : (
                              <span>no roles yet</span>
                            )}
                            <Badge variant={state.tone === 'ok' ? 'default' : 'secondary'}>
                              {state.label}
                            </Badge>
                            {i.kycTier ? <span>{i.kycTier}</span> : null}
                            {i.residency ? <span>{i.residency}</span> : null}
                          </PhoneOnly>
                        </td>
                        <td className={CELL_WIDE}>
                          {i.roles.length ? (
                            <span className="flex flex-wrap gap-1">
                              {i.roles.map((r) => (
                                <Badge key={r} variant="secondary">
                                  {/* An operator role names its firm — "partner
                                      operator · SAG" — because the binding is
                                      the fact, not the role alone. */}
                                  {r.replace('_', ' ')}
                                  {r === 'partner_operator' && i.partnerCode
                                    ? ` · ${i.partnerCode}`
                                    : ''}
                                </Badge>
                              ))}
                            </span>
                          ) : (
                            <span className="text-dim">none yet</span>
                          )}
                        </td>
                        <td className={CELL_WIDE}>{i.kycTier ?? '—'}</td>
                        <td className={CELL_WIDE}>
                          <Badge variant={state.tone === 'ok' ? 'default' : 'secondary'}>
                            {state.label}
                          </Badge>
                        </td>
                        <td className={CELL_WIDE}>
                          {/* What they hold — the list showed only paperwork,
                              and "is this person actually invested?" had no
                              answer short of opening each row. */}
                          {i.holdingsCount === 0 ? (
                            <span className="text-dim">nothing</span>
                          ) : (
                            <span>
                              {i.holdingsCount} · {fmtMinor(i.usdValueMinor, 'USD')}
                            </span>
                          )}
                        </td>
                        <td className={CELL_WIDE}>{i.residency ?? '—'}</td>
                        <td className={CELL}>
                          <button
                            type="button"
                            onClick={() => setSelected(i.id)}
                            className="font-semibold text-teal2 underline-offset-4 hover:underline"
                          >
                            Manage
                            <span className="sr-only"> {i.email}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </>
          ) : null}

          {/* Every tab below can legitimately be empty on a database that has
              only just been stood up, and an empty <table> renders as a bare
              header row — which reads as a request that failed rather than a
              network with nothing in it yet. */}
          {partnerForm ? (
            <PartnerForm
              partner={partnerForm === 'new' ? null : partnerForm}
              onClose={() => setPartnerForm(null)}
              onSaved={load}
            />
          ) : null}

          {!loading && !error && tab === 'Partners' && partners && partners.length > 0 ? (
            <div className="mb-3.5 flex items-center justify-between gap-3">
              <p className="text-[13.5px] text-dim">
                {partners.length} on the network. Only a live partner receives real orders.
              </p>
              <Button type="button" size="sm" onClick={() => setPartnerForm('new')}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                Onboard a partner
              </Button>
            </div>
          ) : null}

          {!loading && !error && tab === 'Partners' && partners?.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No partners on the network yet"
              body="Partners are the licensed institutions CCN routes orders to. Until at least one exists no operator can be bound, no product can be listed, and the opportunities and planning screens have nothing to show. Load the catalog for the eight regional institutions and everything they list, or onboard one yourself."
              action={
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {referenceAction}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPartnerForm('new')}
                  >
                    Onboard one instead
                  </Button>
                </div>
              }
            />
          ) : null}

          {!loading && !error && tab === 'Partners' && partners && partners.length > 0 ? (
            <Table
              head={[
                'Partner',
                { label: 'Line of business', wide: true },
                { label: 'Regulator', wide: true },
                'Agreement',
                { label: 'Products', wide: true },
                { label: 'Orders', wide: true },
              ]}
            >
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className={CELL}>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[13px] text-dim">{p.code}</div>
                    <PhoneOnly>
                      {p.kind ? <span>{p.kind}</span> : null}
                      {p.regulator ? <span>{p.regulator}</span> : null}
                      <span>
                        {p.products} products · {p.orders} orders
                      </span>
                    </PhoneOnly>
                  </td>
                  <td className={CELL_WIDE}>{p.kind ?? '—'}</td>
                  <td className={CELL_WIDE}>{p.regulator ?? '—'}</td>
                  <td className={CELL}>
                    <Badge variant={p.agreementStatus === 'live' ? 'default' : 'secondary'}>
                      {p.agreementStatus ?? 'unknown'}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setPartnerForm(p)}
                      className="mt-1.5 block font-semibold text-teal2 underline-offset-4 hover:underline"
                    >
                      Edit
                      <span className="sr-only"> {p.name}</span>
                    </button>
                  </td>
                  <td className={CELL_WIDE}>{p.products}</td>
                  <td className={CELL_WIDE}>{p.orders}</td>
                </tr>
              ))}
            </Table>
          ) : null}

          {!loading && !error && tab === 'Products' && products?.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nothing listed yet"
              body="Products are listed by partners from their own console. None have been added to the network."
            />
          ) : null}

          {!loading && !error && tab === 'Products' && products && products.length > 0 ? (
            <>
              <p className="mb-3.5 text-[13.5px] text-dim">
                What the marketplace offers, live from the table investors see. Pausing a listing
                takes it off the marketplace and out of both order paths — the same switch the
                listing firm has, for when a regulator flags a product or a firm asks CCN to pull
                one. It is reversible and audited.
              </p>
              {productError ? <Failed message={productError} /> : null}
              <Table
                head={[
                  'Product',
                  { label: 'Partner', wide: true },
                  { label: 'Headline', wide: true },
                  { label: 'Minimum', wide: true },
                  'Status',
                ]}
              >
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className={CELL}>
                      <span className="font-semibold">{p.name}</span>
                      <div className="text-[12.5px] text-dim">
                        {[p.type, p.risk ? `${p.risk} risk` : null].filter(Boolean).join(' · ')}
                      </div>
                      <PhoneOnly>
                        {p.partnerName ? <span>{p.partnerName}</span> : null}
                        {p.metric ? <span>{p.metric}</span> : null}
                      </PhoneOnly>
                    </td>
                    <td className={CELL_WIDE}>
                      {p.partnerName ?? '—'}
                      {p.partnerCode ? (
                        <div className="text-[12.5px] text-dim">{p.partnerCode}</div>
                      ) : null}
                    </td>
                    <td className={CELL_WIDE}>
                      {/* No figure claimed is shown as nothing, not a blank
                          that reads like a load failure. */}
                      {p.metric ? (
                        <>
                          <span className="font-mono">{p.metric}</span>
                          {p.metricLabel ? (
                            <div className="text-[12.5px] text-dim">{p.metricLabel}</div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={CELL_WIDE}>
                      {p.minInvestmentMinor === '0'
                        ? 'No minimum'
                        : `${p.currency} ${(Number(p.minInvestmentMinor) / 100).toLocaleString()}`}
                    </td>
                    <td className={CELL}>
                      <Badge variant={p.status === 'live' ? 'default' : 'secondary'}>
                        {p.status ?? 'unknown'}
                      </Badge>
                      {p.blocked ? <Badge variant="secondary">screened</Badge> : null}
                      <button
                        type="button"
                        disabled={productBusy === p.id}
                        onClick={() => void toggleProduct(p.id)}
                        className="mt-1.5 block font-semibold text-teal2 underline-offset-4 hover:underline disabled:opacity-60"
                      >
                        {productBusy === p.id
                          ? 'Working…'
                          : p.status === 'live'
                            ? 'Take off marketplace'
                            : 'Restore to marketplace'}
                        <span className="sr-only"> {p.name}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}

          {!loading && !error && tab === 'Orders' && orders?.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No orders yet"
              body="Every order on the network appears here the moment it is placed, whichever partner it was routed to."
            />
          ) : null}

          {!loading && !error && tab === 'Orders' && orders && orders.length > 0 ? (
            <Table
              head={[
                { label: 'Placed', wide: true },
                'Investor',
                { label: 'Product', wide: true },
                { label: 'Partner', wide: true },
                'Amount',
                'Status',
              ]}
            >
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className={CELL_WIDE}>{new Date(o.createdAt).toLocaleString()}</td>
                  <td className={CELL}>
                    <span className="break-all">{o.investorEmail ?? '—'}</span>
                    <PhoneOnly>
                      <span>{new Date(o.createdAt).toLocaleString()}</span>
                      {o.instrumentName ? <span>{o.instrumentName}</span> : null}
                      {o.partnerName ? <span>{o.partnerName}</span> : null}
                    </PhoneOnly>
                  </td>
                  <td className={CELL_WIDE}>{o.instrumentName ?? '—'}</td>
                  <td className={CELL_WIDE}>{o.partnerName ?? '—'}</td>
                  <td className={CELL}>
                    {o.currency} {(Number(o.amountMinor) / 100).toLocaleString()}
                  </td>
                  <td className={CELL}>
                    <Badge variant={o.status === 'settled' ? 'default' : 'secondary'}>
                      {o.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          ) : null}

          {!loading && !error && tab === 'Activity' && audit?.length === 0 ? (
            <EmptyState
              icon={History}
              title="Nothing has happened yet"
              body="Sign-ins, role changes, orders and approvals are appended here as they occur. The table is append-only — updates and deletes on it are rejected outright."
            />
          ) : null}

          {!loading && !error && tab === 'Activity' && audit && audit.length > 0 ? (
            <>
              <p className="mb-3 text-[13.5px] text-dim">
                Appended by the database and never rewritten — updates and deletes on this table are
                rejected outright.
              </p>
              <Table
                head={[
                  { label: '#', wide: true },
                  'When',
                  'Action',
                  { label: 'Entity', wide: true },
                  { label: 'Actor', wide: true },
                ]}
              >
                {audit.map((a) => {
                  /**
                   * The writer's own identifiers, put into words. This printed
                   * `instrument.listed` and the bare table name at the person
                   * running the network — the same fix the partner console got,
                   * from the same vocabulary, so the two surfaces cannot
                   * disagree about what an action is called.
                   */
                  const why = auditReason(a.detail);
                  const by =
                    a.detail &&
                    typeof a.detail === 'object' &&
                    'by' in (a.detail as Record<string, unknown>) &&
                    typeof (a.detail as Record<string, unknown>).by === 'string'
                      ? ((a.detail as Record<string, unknown>).by as string)
                      : null;
                  return (
                    <tr key={a.id}>
                      <td className={CELL_WIDE}>{a.seq}</td>
                      <td className={CELL}>{new Date(a.createdAt).toLocaleString()}</td>
                      <td className={CELL}>
                        <span className="font-semibold">{auditActionLabel(a.action)}</span>
                        {a.subjectEmail || by ? (
                          <div className="text-[12.5px] text-dim">
                            {[
                              a.subjectEmail ? `re ${a.subjectEmail}` : null,
                              by ? `by ${by}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        ) : null}
                        {why ? <div className="text-[12.5px] italic text-faint">{why}</div> : null}
                        <PhoneOnly>
                          <span>#{a.seq}</span>
                          {a.entityType ? <span>{auditEntityLabel(a.entityType)}</span> : null}
                          {a.actorType ? <span>{a.actorType}</span> : null}
                        </PhoneOnly>
                      </td>
                      <td className={CELL_WIDE}>{auditEntityLabel(a.entityType) ?? '—'}</td>
                      <td className={CELL_WIDE}>{a.actorType ?? '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
