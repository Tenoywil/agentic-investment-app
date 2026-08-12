'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Switch } from '@/app/_components/ui/switch';
import type { ConsoleProduct } from '@/lib/console-api';
import { Boxes } from 'lucide-react';
import { ROW_DIVIDER, uppr } from './lib';
import { ErrorNote } from './notice';

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
  products,
  productsError,
  productBusyId,
  productActionError,
  onToggleLive,
}: {
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
        {/* No sandbox badge here any more. It existed to caveat the invented
            client/AUM/inflow figures; what is left — the product's name, type
            and whether it is live — is real configuration the operator owns. */}
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
            body="Once your funds and notes are listed on CCN they appear here, and you can take any of them out of matching without delisting it."
          />
        </div>
      ) : null}

      {!productsError && products.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* Clients / AUM / Inflow columns removed: CCN computes none of
                them, so the figures that used to fill them were invented. */}
            <div className={`grid grid-cols-[3fr_1fr] px-6 pb-2 ${ROW_DIVIDER} ${uppr}`}>
              <span>Product</span>
              <span className="text-right">Status</span>
            </div>
            {products.map((p) => {
              const live = p.status === 'live';
              return (
                <div
                  key={p.id}
                  className={`grid grid-cols-[3fr_1fr] items-center px-6 py-3.5 ${ROW_DIVIDER}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{p.name}</div>
                    {p.type ? <div className="text-xs text-faint">{p.type}</div> : null}
                  </div>
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
