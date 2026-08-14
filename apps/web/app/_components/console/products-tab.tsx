'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Switch } from '@/app/_components/ui/switch';
import type { ConsoleCurrency, ConsoleProduct } from '@/lib/console-api';
import { Boxes, Pencil, Plus } from 'lucide-react';
import { ROW_DIVIDER, fmtMinor, uppr } from './lib';
import { RowsSkeleton } from './loading';
import { ErrorNote } from './notice';

/**
 * The partner's listed products — rows of `instruments`, the table the
 * marketplace reads.
 *
 * They used to be rows of `product_listings`, which nothing joined to the
 * marketplace: a firm listed a fund, saw it here, and no investor was ever
 * shown it. So this table now prints what an investor sees on the deal card —
 * the minimum, the headline figure, the risk band — because those are the
 * fields that make a listing correct rather than merely present.
 *
 * The live/paused switch is a real write to POST /api/console/products/:id/live
 * and now takes the product out of the marketplace, not out of a table only
 * this screen reads.
 */
const TYPE_LABELS: Record<string, string> = {
  bond: 'Bond',
  fund: 'Fund',
  equity: 'Equity',
  real_estate: 'Real estate',
  private: 'Private',
};

export function ProductsTab({
  products,
  productsError,
  loading,
  productBusyId,
  productActionError,
  onToggleLive,
  onList,
  onEdit,
}: {
  products: ConsoleProduct[];
  productsError: string | null;
  loading: boolean;
  productBusyId: string | null;
  productActionError: string | null;
  onToggleLive: (id: string) => void;
  onList: () => void;
  onEdit: (product: ConsoleProduct) => void;
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
        <Button type="button" size="sm" onClick={onList}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          List a product
        </Button>
      </div>

      {productsError ? <ErrorNote message={productsError} className="px-6 pb-3.5" /> : null}
      {productActionError ? (
        <ErrorNote message={productActionError} className="px-6 pb-3.5" />
      ) : null}

      {loading && !productsError ? <RowsSkeleton rows={3} label="Loading your products" /> : null}

      {!loading && !productsError && products.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState
            icon={Boxes}
            title="No products listed yet"
            body="List your funds and notes here and the agent can match them to suitable clients. You can pause any of them later without delisting it."
            action={
              <Button type="button" size="sm" onClick={onList}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                List a product
              </Button>
            }
          />
        </div>
      ) : null}

      {!loading && !productsError && products.length > 0 ? (
        <div className="relative overflow-x-auto">
          {/* `relative`, so this scroller is the containing block for the
              absolutely positioned `sr-only` labels inside the row buttons.
              Without it those spans resolve against the page, escape this
              element's clipping, and stretch the document's scroll area past
              the viewport — a phone scrolled 140px sideways onto nothing. */}
          <div className="min-w-[680px]">
            {/* Clients / AUM / Inflow columns removed: CCN computes none of
                them, so the figures that used to fill them were invented. What
                is here instead is what the investor is shown. */}
            <div
              className={`grid grid-cols-[2.4fr_1fr_0.9fr_1.4fr] px-6 pb-2 ${ROW_DIVIDER} ${uppr}`}
            >
              <span>Product</span>
              <span className="text-right">Minimum</span>
              <span className="text-right">Risk</span>
              <span className="text-right">Status</span>
            </div>
            {products.map((p) => {
              const live = p.status === 'live';
              const typeLabel = p.type ? (TYPE_LABELS[p.type] ?? p.type) : null;
              return (
                <div
                  key={p.id}
                  className={`grid grid-cols-[2.4fr_1fr_0.9fr_1.4fr] items-center px-6 py-3.5 ${ROW_DIVIDER}`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{p.name}</div>
                    <div className="text-xs text-faint">
                      {[typeLabel, p.metric ? `${p.metric} ${p.metricLabel ?? ''}`.trim() : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {/* An unset minimum reads "No minimum", not "US$0" — zero is
                      a price, and the two are not the same claim. */}
                  <div className="text-right font-mono text-[13px]">
                    {p.minInvestmentMinor === '0'
                      ? '—'
                      : fmtMinor(p.minInvestmentMinor, p.currency as ConsoleCurrency)}
                  </div>
                  <div className="text-right text-[13px] capitalize text-dim">
                    {p.risk ?? 'Not rated'}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onEdit(p)}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
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
