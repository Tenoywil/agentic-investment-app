'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleKpi, ConsoleOrder } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRightLeft, CheckCheck, LayoutGrid } from 'lucide-react';
import { ROW_DIVIDER, SUCCESS_TEXT, fmtMinor, isSandbox, timeAgo, uppr } from './lib';
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
  /** Jump to another tab — the overview points at work, the tabs hold it. */
  onGoTab: (tab: 'orders' | 'clients' | 'compliance') => void;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const pending = orders.filter((o) => o.status === 'created').length;
  const settled = orders.filter((o) => o.status === 'settled').length;
  const hasOrders = !ordersError && orders.length > 0;
  const hasMetrics = kpis.length > 0 || hasOrders;

  return (
    <>
      {kpisError ? <ErrorNote message={kpisError} className="mb-3" /> : null}
      {ordersError ? <ErrorNote message={ordersError} className="mb-3" /> : null}

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
          {hasOrders ? (
            <>
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
                <div className="mb-2 text-[13.5px] text-dim">Orders settled</div>
                <div
                  className={`font-display text-[28px] font-bold tracking-tight ${settled ? SUCCESS_TEXT : 'text-foreground'}`}
                >
                  {settled}
                </div>
                <div className="mt-1 text-[13px] text-faint">confirmed to clients</div>
              </Card>
            </>
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
              {orders.slice(0, 3).map((o) => (
                <div key={o.id} className={`flex items-center gap-3 py-3.5 ${ROW_DIVIDER}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold">
                      {o.instrumentName ?? 'Order'}
                    </div>
                    <div className="text-[12.5px] text-faint">
                      {o.clientRef ? `${o.clientRef} · ` : ''}
                      {timeAgo(o.createdAt)}
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
        <Card className="h-fit p-[22px]">
          <b className="font-display text-lg">Needs you now</b>
          {(() => {
            const pendingOrders = ordersError
              ? 0
              : orders.filter((o) => o.status === 'created').length;
            const rows: { n: number; what: string; go: 'orders' | 'clients'; cta: string }[] = [
              {
                n: pendingOrders,
                what: pendingOrders === 1 ? 'order to accept' : 'orders to accept',
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
