'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleOrder } from '@/lib/console-api';
import { ArrowRightLeft } from 'lucide-react';
import { ROW_DIVIDER, fmtMinor, timeAgo, uppr } from './lib';
import { ErrorNote } from './notice';
import { OrderAction } from './order-action';

/**
 * The full order queue.
 *
 * The Order column shows the instrument's real name, from the LEFT JOIN added
 * to GET /api/console/orders. It previously printed `Instrument 8f3a2b1c` — a
 * sliced UUID — at the desk expected to execute the trade. An order with no
 * instrument keeps its client reference and amount rather than inventing a
 * name for it.
 */
export function OrdersTab({
  orders,
  ordersError,
  orderBusyId,
  orderActionError,
  onAccept,
  onSettle,
  onReject,
}: {
  orders: ConsoleOrder[];
  ordersError: string | null;
  orderBusyId: string | null;
  orderActionError: string | null;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = orders.filter((o) => o.status === 'created').length;
  const accepted = orders.filter((o) => o.status === 'accepted').length;
  const settled = orders.filter((o) => o.status === 'settled').length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-6 pb-3.5 pt-5">
        <div>
          <b className="font-display text-lg">Order flow</b>
          {ordersError ? null : (
            <div className="mt-0.5 text-[13px] text-faint">
              {pending} to accept · {accepted} to settle · {settled} settled
            </div>
          )}
        </div>
        <div className="max-w-[360px] text-right text-[12.5px] leading-snug text-faint">
          Accept moves an order to your desk for execution. Settle confirms it back to the client's
          unified portfolio.
        </div>
      </div>

      {ordersError ? <ErrorNote message={ordersError} className="px-6 pb-3.5" /> : null}
      {orderActionError ? <ErrorNote message={orderActionError} className="px-6 pb-3.5" /> : null}

      {!ordersError && orders.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState
            icon={ArrowRightLeft}
            title="No orders yet"
            body="Every order a CCN client approves in your products lands here for you to accept, settle or reject."
          />
        </div>
      ) : null}

      {!ordersError && orders.length > 0 ? (
        <div className="relative overflow-x-auto">
          {/* `relative`, so this scroller is the containing block for the
              absolutely positioned `sr-only` labels inside the row buttons.
              Without it those spans resolve against the page, escape this
              element's clipping, and stretch the document's scroll area past
              the viewport — a phone scrolled 140px sideways onto nothing. */}
          <div className="min-w-[560px]">
            <div
              className={`grid grid-cols-[2fr_1fr_0.9fr_1.3fr] px-6 pb-2 ${ROW_DIVIDER} ${uppr}`}
            >
              <span>Order</span>
              <span>Client</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Status</span>
            </div>
            {orders.map((o) => (
              <div
                key={o.id}
                className={`grid grid-cols-[2fr_1fr_0.9fr_1.3fr] items-center px-6 py-3.5 ${ROW_DIVIDER}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{o.instrumentName ?? 'Order'}</div>
                  <div className="text-xs text-faint">
                    {o.instrumentAbbr ? `${o.instrumentAbbr} · ` : ''}
                    {timeAgo(o.createdAt)}
                  </div>
                </div>
                <div className="truncate text-[13.5px] text-dim">{o.clientRef}</div>
                <div className="text-right font-mono text-sm font-bold">
                  {fmtMinor(o.amountMinor, o.currency)}
                </div>
                <div className="flex justify-end">
                  <OrderAction
                    order={o}
                    busyId={orderBusyId}
                    onAccept={onAccept}
                    onSettle={onSettle}
                    onReject={onReject}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
