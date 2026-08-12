'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleKpi, ConsoleOrder } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ArrowRightLeft, LayoutGrid } from 'lucide-react';
import { ROW_DIVIDER, SUCCESS_TEXT, fmtMinor, isSandbox, timeAgo, uppr } from './lib';
import { ErrorNote } from './notice';
import { OrderAction } from './order-action';
import { SandboxBadge } from './sandbox-badge';

/** Static explainer copy — CCN's own product argument, not a claim about any
 *  partner's numbers. Chrome, and it stays. */
const WHY = [
  'Qualified, KYC-cleared demand into products you already run',
  'Diaspora reach without building cross-border onboarding',
  'Your name and regulator on every deal card, no channel conflict',
  'You keep execution, custody and settlement under your license',
];

export function OverviewTab({
  partner,
  kpis,
  kpisError,
  orders,
  ordersError,
  orderBusyId,
  orderActionError,
  onAccept,
  onSettle,
  onReject,
}: {
  partner: MePartner | null;
  kpis: ConsoleKpi[];
  kpisError: string | null;
  orders: ConsoleOrder[];
  ordersError: string | null;
  orderBusyId: string | null;
  orderActionError: string | null;
  onAccept: (id: string) => void;
  onSettle: (id: string) => void;
  onReject: (id: string) => void;
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

      {hasMetrics ? (
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

          {!ordersError && orders.length === 0 ? (
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

        <div className="flex flex-col gap-[18px]">
          {/* text-white throughout: see compliance-tab — in the dark theme
              --primary is a mid teal that nothing dimmer than white clears
              4.5:1 against. */}
          <Card className="border-none bg-primary p-[22px] text-white">
            <div className={`mb-3.5 font-mono ${uppr} text-white`}>Why this flow matters</div>
            <ul className="m-0 list-none p-0">
              {WHY.map((w) => (
                <li key={w} className="mb-3 flex gap-2.5 text-[14.5px] leading-normal">
                  <span aria-hidden className="flex-none font-bold">
                    +
                  </span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-[22px]">
            <b className="font-display text-[17px]">The line CCN never crosses</b>
            <p className="mt-2 text-sm leading-relaxed text-dim">
              CCN holds no client money, executes nothing and never becomes custodian. The regulated
              duties stay with you; CCN routes signed instructions and keeps the audit trail.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
