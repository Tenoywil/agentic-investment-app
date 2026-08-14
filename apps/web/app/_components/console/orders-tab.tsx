'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleOrder } from '@/lib/console-api';
import { ArrowRightLeft } from 'lucide-react';
import { datedFilename, downloadCsv, toCsv } from './export-csv';
import { ROW_DIVIDER, fmtMinor, timeAgo, uppr } from './lib';
import { RowsSkeleton } from './loading';
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
const STATUSES = ['created', 'accepted', 'settled', 'rejected', 'expired'] as const;

export function OrdersTab({
  orders,
  ordersError,
  loading,
  total,
  offset,
  pageSize,
  status,
  query,
  onStatus,
  onQuery,
  onPage,
  orderBusyId,
  orderActionError,
  onAccept,
  onSettle,
  onReject,
}: {
  orders: ConsoleOrder[];
  ordersError: string | null;
  loading: boolean;
  /** Matching the filter, not on this page — the pager needs both. */
  total: number;
  offset: number;
  pageSize: number;
  status: string;
  query: string;
  onStatus: (v: string) => void;
  onQuery: (v: string) => void;
  onPage: (offset: number) => void;
  orderBusyId: string | null;
  orderActionError: string | null;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  /**
   * Counted over this page only, and labelled as such below. They used to be
   * counted over "every order ever", which was the same number because the
   * route returned everything — the honest version of that line has to say
   * what it counted.
   */
  const pending = orders.filter((o) => o.status === 'created').length;
  const accepted = orders.filter((o) => o.status === 'accepted').length;
  const settled = orders.filter((o) => o.status === 'settled').length;

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + orders.length, total);

  function exportCsv() {
    downloadCsv(
      datedFilename('ccn-orders'),
      toCsv(orders, [
        { header: 'Order id', value: (o) => o.id },
        { header: 'Product', value: (o) => o.instrumentName ?? '' },
        { header: 'Client ref', value: (o) => o.clientRef },
        { header: 'Amount (minor units)', value: (o) => o.amountMinor },
        { header: 'Currency', value: (o) => o.currency },
        { header: 'Status', value: (o) => o.status },
        { header: 'Reason if rejected', value: (o) => o.rejectedReason ?? '' },
        // The execution, as the firm reported it. Empty means it reported
        // nothing, which a reconciliation against their own books needs to be
        // able to tell apart from a reported zero.
        { header: 'Unit price (minor units)', value: (o) => o.unitPriceMinor ?? '' },
        { header: 'Units', value: (o) => o.units ?? '' },
        { header: 'Fee (minor units)', value: (o) => o.feeMinor ?? '' },
        { header: 'Firm reference', value: (o) => o.externalRef ?? '' },
        { header: 'Created', value: (o) => o.createdAt },
        { header: 'Accepted', value: (o) => o.acceptedAt ?? '' },
        { header: 'Settlement expected', value: (o) => o.settlementEta ?? '' },
        { header: 'Settled', value: (o) => o.settledAt ?? '' },
      ]),
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-6 pb-3.5 pt-5">
        <div>
          <b className="font-display text-lg">Order flow</b>
          {ordersError || loading ? null : (
            <div className="mt-0.5 text-[13px] text-faint">
              Showing {from}–{to} of {total} · {pending} to accept · {accepted} to settle ·{' '}
              {settled} settled on this page
            </div>
          )}
        </div>
        <div className="max-w-[360px] text-right text-[12.5px] leading-snug text-faint">
          Accept moves an order to your desk for execution. Settle confirms it back to the client's
          unified portfolio.
        </div>
      </div>

      {/* The controls sit above the errors so a failed page can still be
          re-filtered rather than leaving the operator stuck on it. */}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3.5">
        <label className="min-w-[180px] flex-1 text-[13px]">
          <span className="sr-only">Search orders by product or client reference</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search product or client"
            className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          />
        </label>
        <label className="text-[13px]">
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(e) => onStatus(e.target.value)}
            className="rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          >
            <option value="">All statuses</option>
            {STATUSES.map((sName) => (
              <option key={sName} value={sName}>
                {sName}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={orders.length === 0}
        >
          Export CSV
        </Button>
      </div>

      {ordersError ? <ErrorNote message={ordersError} className="px-6 pb-3.5" /> : null}
      {orderActionError ? <ErrorNote message={orderActionError} className="px-6 pb-3.5" /> : null}

      {loading && !ordersError ? <RowsSkeleton rows={4} label="Loading your order flow" /> : null}

      {!loading && !ordersError && orders.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState
            icon={ArrowRightLeft}
            title="No orders yet"
            body="Every order a CCN client approves in your products lands here for you to accept, settle or reject."
          />
        </div>
      ) : null}

      {!loading && !ordersError && orders.length > 0 ? (
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

      {!loading && !ordersError && total > orders.length ? (
        <div className="flex items-center justify-between gap-3 px-6 pb-5 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - pageSize))}
          >
            Previous
          </Button>
          <span className="text-[12.5px] text-faint">
            {from}–{to} of {total}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={to >= total}
            onClick={() => onPage(offset + pageSize)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
