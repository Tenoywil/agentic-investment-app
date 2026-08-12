'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Switch } from '@/app/_components/ui/switch';
import type { ConsoleProduct } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { Boxes } from 'lucide-react';
import { ROW_DIVIDER, fmtAumUSD, isSandbox, uppr } from './lib';
import { ErrorNote } from './notice';
import { SandboxBadge } from './sandbox-badge';

/**
 * The partner's listed products.
 *
 * The live/paused switch is a real write to POST /api/console/products/:id/live
 * — it used to be permanently `disabled` with a tooltip apologising that no
 * write endpoint existed. The header's "List a product" button is gone: it had
 * no handler and no endpoint behind it, and a control that does nothing is
 * worse than no control.
 */
export function ProductsTab({
  partner,
  products,
  productsError,
  productBusyId,
  productActionError,
  onToggleLive,
}: {
  partner: MePartner | null;
  products: ConsoleProduct[];
  productsError: string | null;
  productBusyId: string | null;
  productActionError: string | null;
  onToggleLive: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden" data-tour="institution-products">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3.5 pt-5">
        <div>
          <b className="font-display text-lg">Your products on CCN</b>
          <div className="mt-0.5 text-[13px] text-faint">
            Listed products the agent can match to suitable clients. Pausing one takes it out of
            matching immediately.
          </div>
        </div>
        {isSandbox(partner) && products.length > 0 ? <SandboxBadge /> : null}
      </div>

      {productsError ? <ErrorNote message={productsError} className="px-6 pb-3.5" /> : null}
      {productActionError ? (
        <ErrorNote message={productActionError} className="px-6 pb-3.5" />
      ) : null}

      {!productsError && products.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState
            icon={Boxes}
            title="No products listed yet"
            body="Once your funds and notes are listed on CCN, they appear here with the clients and AUM they have attracted, and you can pause any of them."
          />
        </div>
      ) : null}

      {!productsError && products.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div
              className={`grid grid-cols-[2.2fr_1fr_1fr_0.9fr_1fr] px-6 pb-2 ${ROW_DIVIDER} ${uppr}`}
            >
              <span>Product</span>
              <span className="text-right">Clients</span>
              <span className="text-right">AUM via CCN</span>
              <span className="text-right">Inflow</span>
              <span className="text-right">Status</span>
            </div>
            {products.map((p) => {
              const live = p.status === 'live';
              return (
                <div
                  key={p.id}
                  className={`grid grid-cols-[2.2fr_1fr_1fr_0.9fr_1fr] items-center px-6 py-3.5 ${ROW_DIVIDER}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{p.name}</div>
                    {p.type ? <div className="text-xs text-faint">{p.type}</div> : null}
                  </div>
                  <div className="text-right text-sm text-dim">{p.clients}</div>
                  <div className="text-right font-mono text-[13.5px] font-bold">
                    {fmtAumUSD(p.aumMinor)}
                  </div>
                  <div className="text-right text-[13.5px] font-bold text-success">{p.trend}</div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-[13px] font-bold text-dim">
                      {live ? 'Live' : 'Paused'}
                    </span>
                    <Switch
                      checked={live}
                      disabled={productBusyId === p.id}
                      aria-label={`${p.name} — listed live on CCN`}
                      onCheckedChange={() => onToggleLive(p.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
