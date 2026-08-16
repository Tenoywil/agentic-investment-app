'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleKpi, ConsoleOrder } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRight, ArrowRightLeft, Check, CheckCheck, LayoutGrid } from 'lucide-react';
import {
  ORDER_AGING_DAYS,
  ROW_DIVIDER,
  SUCCESS_TEXT,
  daysSince,
  fmtMinor,
  isSandbox,
  timeAgo,
  uppr,
} from './lib';
import { RowsSkeleton, TilesSkeleton } from './loading';
import { ErrorNote } from './notice';
import { OrderAction } from './order-action';
import { SandboxBadge } from './sandbox-badge';

export function OverviewTab({
  partner,
  kpis,
  kpisError,
  orders,
  ordersError,
  loading,
  orderBusyId,
  orderActionError,
  pendingReviews,
  pendingReconciliation,
  pendingWithdrawals,
  hasProducts,
  hasActiveClient,
  onGoTab,
  onAccept,
  onSettle,
  onReject,
}: {
  partner: MePartner | null;
  kpis: ConsoleKpi[];
  kpisError: string | null;
  orders: ConsoleOrder[];
  ordersError: string | null;
  loading: boolean;
  orderBusyId: string | null;
  orderActionError: string | null;
  /** Clients awaiting this desk's review. */
  pendingReviews: number;
  /** Statement lines waiting to be matched. */
  pendingReconciliation: number;
  /** Clients asking for money back, undecided. */
  pendingWithdrawals: number;
  /** Whether the firm has listed anything — a setup milestone, not a metric. */
  hasProducts: boolean;
  /** Whether any client has been accepted. */
  hasActiveClient: boolean;
  /** Jump to another tab — the overview points at work, the tabs hold it. */
  onGoTab: (tab: 'orders' | 'clients' | 'compliance' | 'products') => void;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const pending = orders.filter((o) => o.status === 'created').length;
  const hasOrders = !ordersError && orders.length > 0;
  const hasMetrics = kpis.length > 0 || hasOrders;

  /**
   * The setup checklist: the four verifiable milestones between "signed in"
   * and "a working desk", each computed from the firm's real state — never a
   * box the firm ticks itself. It disappears once all four are true, because
   * an onboarding aid that lingers is chrome.
   */
  const checklist: {
    done: boolean;
    title: string;
    why: string;
    go: Parameters<typeof onGoTab>[0];
  }[] = [
    {
      done: partner?.fundingInstructions != null,
      title: 'Publish your funding instructions',
      why: 'Clients see them the moment they press "Add money" — money reaches you sooner, and your desk stops fielding "where do I wire?" calls.',
      go: 'compliance',
    },
    {
      done: hasProducts,
      title: 'List your first product',
      why: 'Until something is listed, investors browsing the marketplace cannot see your firm at all.',
      go: 'products',
    },
    {
      done: hasActiveClient,
      title: 'Accept your first client',
      why: 'Their KYC package — declarations and documents — is on their row, ready to review.',
      go: 'clients',
    },
    {
      done: orders.length > 0,
      title: 'Take your first order',
      why: 'Once clients hold cash with you, approved orders land on this desk to accept and settle.',
      go: 'orders',
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const setupComplete = doneCount === checklist.length;

  return (
    <>
      {kpisError ? <ErrorNote message={kpisError} className="mb-3" /> : null}
      {ordersError ? <ErrorNote message={ordersError} className="mb-3" /> : null}

      {/* Shown while setting up, gone once live: the path from "signed in" to
          "orders flowing", with each step's payoff stated — the console should
          sell the firm on finishing, not merely permit it. */}
      {!loading && !setupComplete ? (
        <Card className="mb-4 p-[22px]" data-tour="institution-checklist">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="font-display text-lg">Get your desk live</b>
            <span className="font-mono text-[13px] font-bold text-dim">
              {doneCount} of {checklist.length} done
            </span>
          </div>
          <p className="mb-3 mt-1 text-[13px] leading-snug text-faint">
            Four steps between here and a working book. Each unlocks the next.
          </p>
          <ol className="m-0 flex list-none flex-col p-0">
            {checklist.map((item, i) => (
              <li
                key={item.title}
                className={`flex items-start gap-3 py-3 ${ROW_DIVIDER} last:border-b-0`}
              >
                <span
                  className={
                    item.done
                      ? 'mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-mint'
                      : 'mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full border border-solid border-border font-mono text-[12px] font-bold text-dim'
                  }
                >
                  {item.done ? (
                    <Check className={`h-3.5 w-3.5 ${SUCCESS_TEXT}`} aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={
                      item.done
                        ? 'text-[14.5px] font-bold text-faint line-through'
                        : 'text-[14.5px] font-bold'
                    }
                  >
                    {item.title}
                  </div>
                  {!item.done ? (
                    <div className="mt-0.5 text-[12.5px] leading-snug text-faint">{item.why}</div>
                  ) : null}
                </div>
                {!item.done ? (
                  <button
                    type="button"
                    onClick={() => onGoTab(item.go)}
                    className="mt-0.5 inline-flex flex-none items-center gap-1 text-[13px] font-bold text-teal2 underline-offset-4 hover:underline"
                  >
                    Do it
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {isSandbox(partner) && kpis.length > 0 ? (
        <div className="mb-3">
          <SandboxBadge />
        </div>
      ) : null}

      {loading && !hasMetrics ? (
        <TilesSkeleton tiles={4} label="Loading your metrics" />
      ) : hasMetrics ? (
        <div className="g4" data-tour="institution-kpis">
          {kpis.map((k, i) => (
            <Card key={k.id} className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">{k.label}</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${i % 2 === 0 ? 'text-teal2' : 'text-foreground'}`}
              >
                {k.value}
              </div>
              {k.sub ? <div className="mt-1 text-[13px] text-faint">{k.sub}</div> : null}
            </Card>
          ))}
          {/* The server KPI list already carries an "Orders settled" card, so
              only the pending count — which it does not cover — is added here.
              Repeating the settled number with a second subtitle read as two
              different metrics that happened to agree. */}
          {hasOrders ? (
            <Card className="p-5">
              <div className="mb-2 text-[13.5px] text-dim">Orders pending</div>
              <div
                className={`font-display text-[28px] font-bold tracking-tight ${pending ? 'text-terra' : 'text-foreground'}`}
              >
                {pending}
              </div>
              <div className="mt-1 text-[13px] text-faint">awaiting your accept</div>
            </Card>
          ) : null}
        </div>
      ) : (
        !loading &&
        !kpisError &&
        !ordersError && (
          <EmptyState
            icon={LayoutGrid}
            title="No partner metrics yet"
            body="Referred AUM, onboarding conversion and order counts appear here once your first CCN client funds an order in one of your products."
          />
        )
      )}

      <div className="g-agent mt-[18px]">
        <Card className="p-[22px]" data-tour="institution-orders">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <b className="font-display text-lg">Incoming order flow</b>
            {hasOrders ? <span className="text-sm font-bold text-teal2">Open queue</span> : null}
          </div>
          <p className="mb-4 text-sm leading-normal text-dim">
            Orders arrive here when a CCN client approves a deal in your products. You execute,
            custody and settle each one.
          </p>
          {ordersError ? <ErrorNote message={ordersError} className="mb-3" /> : null}
          {orderActionError ? <ErrorNote message={orderActionError} className="mb-3" /> : null}

          {loading && !ordersError ? (
            <RowsSkeleton rows={3} label="Loading the order queue" />
          ) : null}

          {!loading && !ordersError && orders.length === 0 ? (
            <EmptyState
              icon={ArrowRightLeft}
              title="No orders yet"
              body="The queue fills as CCN clients approve deals in your listed products."
            />
          ) : null}

          {hasOrders ? (
            <>
              <div className={`flex justify-between pb-2.5 ${ROW_DIVIDER} ${uppr}`}>
                <span>Product · Client</span>
                <span className="flex gap-10">
                  <span>Amount</span>
                  <span>Action</span>
                </span>
              </div>
              {/* Wrapping, not a rigid three-column row: a settled order's
                  detail line (units · price · reference · contract note) is
                  wider than a phone, and in a no-wrap flex row it squeezed the
                  product name down to a single truncated letter. The name keeps
                  a readable basis; the amount-and-action cluster drops to its
                  own right-aligned line when the width runs out. */}
              {orders.slice(0, 3).map((o) => (
                <div
                  key={o.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3.5 ${ROW_DIVIDER}`}
                >
                  <div className="min-w-0 flex-[1_1_150px]">
                    <div className="truncate text-[14.5px] font-bold">
                      {o.instrumentName ?? 'Order'}
                    </div>
                    <div className="text-[12.5px] text-faint">
                      {o.clientRef ? `${o.clientRef} · ` : ''}
                      {timeAgo(o.createdAt)}
                    </div>
                  </div>
                  <div className="ml-auto flex min-w-0 items-center justify-end gap-3">
                    <span className="text-right font-mono text-sm font-bold">
                      {fmtMinor(o.amountMinor, o.currency)}
                    </span>
                    <OrderAction
                      order={o}
                      busyId={orderBusyId}
                      compact
                      onAccept={onAccept}
                      onSettle={onSettle}
                      onReject={onReject}
                    />
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </Card>

        {/* What actually needs the desk today. This column used to hold CCN's
            product pitch and its "line we never cross" statement — copy for a
            prospect, furniture at a working desk. That prose now lives on the
            Compliance tab; the overview points at work. */}
        <Card className="h-fit p-[22px]" data-tour="institution-needs-you">
          <b className="font-display text-lg">Needs you now</b>
          {(() => {
            const pendingOrders = ordersError
              ? 0
              : orders.filter((o) => o.status === 'created').length;
            // The oldest undecided order, because "3 to accept" reads the same
            // whether they arrived an hour ago or a week ago — and the desk
            // should feel the difference.
            const oldestWait = ordersError
              ? 0
              : Math.max(
                  0,
                  ...orders
                    .filter((o) => o.status === 'created')
                    .map((o) => daysSince(o.createdAt)),
                );
            const rows: { n: number; what: string; go: 'orders' | 'clients'; cta: string }[] = [
              {
                n: pendingOrders,
                what: `${pendingOrders === 1 ? 'order to accept' : 'orders to accept'}${
                  oldestWait >= ORDER_AGING_DAYS ? ` — oldest waiting ${oldestWait} days` : ''
                }`,
                go: 'orders' as const,
                cta: 'Open the order flow',
              },
              {
                n: pendingReviews,
                what: pendingReviews === 1 ? 'client awaiting review' : 'clients awaiting review',
                go: 'clients' as const,
                cta: 'Review clients',
              },
              {
                n: pendingReconciliation,
                what:
                  pendingReconciliation === 1
                    ? 'statement line to reconcile'
                    : 'statement lines to reconcile',
                go: 'clients' as const,
                cta: 'Reconcile',
              },
              {
                n: pendingWithdrawals,
                what:
                  pendingWithdrawals === 1
                    ? 'withdrawal awaiting your decision'
                    : 'withdrawals awaiting your decision',
                go: 'clients' as const,
                cta: 'Decide',
              },
            ].filter((r) => r.n > 0);
            if (rows.length === 0) {
              return (
                <p className="mt-2 flex items-center gap-2 text-sm text-dim">
                  <CheckCheck className={`h-4 w-4 flex-none ${SUCCESS_TEXT}`} aria-hidden />
                  Nothing is waiting on your desk.
                </p>
              );
            }
            return (
              <ul className="m-0 mt-2 list-none p-0">
                {rows.map((r) => (
                  <li
                    key={r.what}
                    className={`flex items-center justify-between gap-3 py-3 ${ROW_DIVIDER} last:border-b-0`}
                  >
                    <span className="text-[14.5px]">
                      <b className="font-mono">{r.n}</b> {r.what}
                    </span>
                    <button
                      type="button"
                      onClick={() => onGoTab(r.go)}
                      className="text-[13.5px] font-bold text-teal2 underline-offset-4 hover:underline"
                    >
                      {r.cta}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Card>
      </div>
    </>
  );
}
