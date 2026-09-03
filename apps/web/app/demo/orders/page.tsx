'use client';

import {
  AppScreen,
  type DemoOpportunityOrder,
  PageHead,
  readDemoAccountState,
} from '@/app/_components/AppScreen';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import { useEffect, useState } from 'react';

/**
 * Orders, in the signed-out preview.
 *
 * The rail has always offered this destination — `navGroupsFor('/demo')` strips
 * the Gateway group and Onboarding, but never Orders — and the route did not
 * exist, so a visitor evaluating the product clicked a primary nav item and got
 * a 404. The preview is the first thing anyone sees; a dead link in it is the
 * worst placed one in the app.
 *
 * Fixtures, like every other screen under `/demo`. They exist to show the shape
 * of the real screen: what an order looks like at each stage of its life, and
 * that the investor is told in plain words who holds it and what happens next.
 * The live version at `app/(customer)/orders` reads `GET /api/orders`.
 */

type Status = 'created' | 'accepted' | 'settled' | 'rejected';

const STATE: Record<Status, { label: string; tone: string }> = {
  created: { label: 'Routed', tone: 'bg-muted text-dim' },
  accepted: {
    label: 'Accepted',
    tone: 'bg-[#e7edf8] text-[#1a4aa0] dark:bg-white/10 dark:text-foreground',
  },
  settled: { label: 'Settled', tone: 'bg-mint text-success-ink' },
  rejected: {
    label: 'Declined',
    tone: 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra',
  },
};

const ORDERS: {
  id: string;
  name: string;
  status: Status;
  says: string;
  authorised: string;
  amount: string;
  byAgent?: boolean;
}[] = [
  {
    id: '1',
    name: 'NCB USD Money Market Fund',
    status: 'created',
    says: 'Sent to NCB Capital Markets to accept.',
    authorised: 'Authorised 12 Aug 2026',
    amount: 'US$400',
    byAgent: true,
  },
  {
    id: '2',
    name: "Gov't of Jamaica USD Global Bond 2032",
    status: 'accepted',
    says: 'NCB Capital Markets is executing it. Settlement expected 14 Aug 2026.',
    authorised: 'Authorised 10 Aug 2026',
    amount: 'US$2,500',
  },
  {
    id: '3',
    name: 'Sagicor Real Estate X Fund',
    status: 'settled',
    says: 'Settled on 4 Aug 2026 by Sagicor Investments. It appears in your portfolio once they next report the position.',
    authorised: 'Authorised 1 Aug 2026',
    amount: 'US$5,000',
  },
  {
    id: '4',
    name: 'Sygnus Private Credit Note III',
    status: 'rejected',
    says: 'Minimum subscription not met for this tranche.',
    authorised: 'Authorised 28 Jul 2026',
    amount: 'US$10,000',
  },
];

export default function DemoOrdersPage() {
  const [routedOrders, setRoutedOrders] = useState<DemoOpportunityOrder[]>([]);

  useEffect(() => {
    setRoutedOrders(readDemoAccountState().opportunityOrders);
  }, []);

  const orders = [
    ...routedOrders.map((order) => ({
      id: `routed-${order.id}`,
      name: order.name,
      status: 'created' as const,
      says: `Sent to ${order.partner} to accept.`,
      authorised: 'Authorised today',
      amount: order.amount,
      byAgent: true,
    })),
    ...ORDERS,
  ];
  const open = orders.filter((o) => o.status === 'created' || o.status === 'accepted');

  return (
    <AppScreen active="orders" basePath="/demo">
      <PageHead
        eyebrow="Executed and settled by the institution that holds them"
        title="Your orders"
        right={
          // Only when something is actually in progress, as live: a pill
          // reading "0 in progress" is a header that announces nothing.
          open.length > 0 ? (
            <div className="rounded-xl border border-solid border-border bg-card px-4 py-2.5 text-[13.5px] text-dim">
              <b className="font-display text-lg text-foreground">{open.length}</b> in progress
            </div>
          ) : undefined
        }
      />

      <Card className="overflow-hidden" data-tour="customer-order-flow">
        <ul className="m-0 list-none p-0">
          {orders.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-0 border-b border-solid border-border px-[22px] py-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[15px]">{o.name}</b>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px]',
                      STATE[o.status].tone,
                    )}
                  >
                    {STATE[o.status].label}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px] text-dim">{o.says}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">
                  {o.authorised}
                  {o.byAgent ? ' · proposed by your agent' : ''}
                </div>
              </div>
              <b className="flex-none font-mono text-[15px]">{o.amount}</b>
            </li>
          ))}
        </ul>
      </Card>

      <p className="mt-4 text-[13px] text-faint">
        Nothing here is executed by CCN — an order belongs to the licensed institution that holds it
        from the moment it is routed.
      </p>
    </AppScreen>
  );
}
