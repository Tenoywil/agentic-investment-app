'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Skeleton, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { useRealtime } from '@/app/_lib/use-realtime';
import { cn } from '@/app/_lib/utils';
import { type MyOrder, getMyOrders } from '@/lib/opportunities-api';
import { ArrowRightLeft, CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * What happened to the orders you authorised.
 *
 * `GET /api/orders` has existed since the order routes were written and nothing
 * consumed it. A person could authorise an order, watch the dialog close, and
 * never learn whether their institution accepted it, settled it or turned it
 * down — the partner console had all four transitions and the investor had no
 * screen at all. Half a state machine is worse than none: it teaches people the
 * app forgets what they did.
 *
 * Nothing here is editable. An order belongs to the institution executing it
 * from the moment it is routed, and CCN does not offer a cancel it cannot
 * honour.
 */

const CURRENCY_PREFIX: Record<string, string> = { USD: 'US$', JMD: 'J$', TTD: 'TT$' };

function money(minor: string, currency: string): string {
  const n = Number(minor) / 100;
  return `${CURRENCY_PREFIX[currency] ?? ''}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The five order states in the words an investor would use, with what each one
 * means for them. `expired` is included because the state machine can reach it
 * and a status this screen could not name would render as a bare enum value.
 */
const STATE: Record<
  MyOrder['status'],
  { label: string; tone: string; says: (o: MyOrder) => string }
> = {
  created: {
    label: 'Routed',
    tone: 'bg-muted text-dim',
    says: (o) => `Sent to ${o.partnerName ?? 'your institution'} to accept.`,
  },
  accepted: {
    label: 'Accepted',
    tone: 'bg-[#e7edf8] text-[#1a4aa0] dark:bg-white/10 dark:text-foreground',
    says: (o) =>
      o.settlementEta
        ? `${o.partnerName ?? 'Your institution'} is executing it. Settlement expected ${when(o.settlementEta)}.`
        : `${o.partnerName ?? 'Your institution'} is executing it.`,
  },
  settled: {
    label: 'Settled',
    tone: 'bg-mint text-success-ink',
    says: (o) =>
      `Settled${o.settledAt ? ` on ${when(o.settledAt)}` : ''}. It is in your portfolio.`,
  },
  rejected: {
    label: 'Declined',
    tone: 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra',
    says: (o) => o.rejectedReason ?? 'Your institution did not take this order on.',
  },
  expired: {
    label: 'Expired',
    tone: 'bg-muted text-dim',
    says: () => 'This order was not acted on in time and no longer stands.',
  },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getMyOrders();
      setOrders(r.orders);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load your orders.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * This screen exists to be watched. Every transition on it — accepted,
   * settled, declined — is made by someone else, at their desk, minutes or days
   * later, and until the stream was connected the only way to learn about one
   * was to reload the page. Someone who authorised an order and stayed on this
   * screen would have watched "Routed" indefinitely while their institution had
   * already settled it.
   */
  useRealtime(['order'], load);

  const open = orders?.filter((o) => o.status === 'created' || o.status === 'accepted') ?? [];

  return (
    <AppScreen active="orders">
      <PageHead
        eyebrow="Executed and settled by the institution that holds them"
        title="Your orders"
        right={
          open.length > 0 ? (
            <div className="rounded-xl border border-solid border-border bg-card px-4 py-2.5 text-[13.5px] text-dim">
              <b className="font-display text-lg text-foreground">{open.length}</b> in progress
            </div>
          ) : undefined
        }
      />

      {error ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      ) : null}

      {!orders && !error ? (
        <SkeletonRegion label="Loading your orders">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-solid border-border bg-card p-[18px]"
              >
                <Skeleton className="mb-2 h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      ) : null}

      {orders && orders.length === 0 && !error ? (
        <EmptyState
          icon={ArrowRightLeft}
          title="No orders yet"
          body="Every order you authorise appears here, from the moment it is routed to your institution until it settles. Nothing is executed by CCN."
        />
      ) : null}

      {orders && orders.length > 0 ? (
        <Card className="overflow-hidden">
          <ul className="m-0 list-none p-0">
            {orders.map((o) => {
              const state = STATE[o.status];
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-0 border-b border-solid border-border px-[22px] py-4 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-[15px]">
                        {o.instrumentName ?? 'Instrument no longer listed'}
                      </b>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px]',
                          state.tone,
                        )}
                      >
                        {state.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-dim">{state.says(o)}</div>
                    <div className="mt-0.5 text-[12.5px] text-faint">
                      Authorised {when(o.createdAt)}
                      {o.createdBy === 'agent' ? ' · proposed by your agent' : ''}
                    </div>
                  </div>
                  <b className="flex-none font-mono text-[15px]">
                    {money(o.amountMinor, o.currency)}
                  </b>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </AppScreen>
  );
}
