'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Switch } from '@/app/_components/ui/switch';
import type { ConsoleCurrency, ConsoleProduct } from '@/lib/console-api';
import { Boxes, FileSpreadsheet, Pencil, Plus } from 'lucide-react';
import { ROW_DIVIDER, fmtMinor, uppr } from './lib';
import { ConsolePager, RowsSkeleton } from './loading';
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
  total,
  offset,
  pageSize,
  status,
  query,
  productBusyId,
  productActionError,
  onToggleLive,
  onList,
  onBulk,
  onEdit,
  onStatus,
  onQuery,
  onPage,
}: {
  products: ConsoleProduct[];
  productsError: string | null;
  loading: boolean;
  total: number;
  offset: number;
  pageSize: number;
  status: string;
  query: string;
  productBusyId: string | null;
  productActionError: string | null;
  onToggleLive: (id: string) => void;
  onList: () => void;
  onBulk: () => void;
  onEdit: (product: ConsoleProduct) => void;
  onStatus: (status: string) => void;
  onQuery: (query: string) => void;
  onPage: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + products.length, total);

  return (
    <Card className="overflow-hidden" data-tour="institution-products">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6">
        <div>
          <b className="font-display text-lg">Your products on CCN</b>
          <div className="mt-0.5 text-[13px] text-faint">
            {productsError || loading
              ? 'Listed products the agent can match to suitable clients.'
              : `Showing ${from}–${to} of ${total}. Pausing one takes it out of matching immediately.`}
          </div>
        </div>
        {/* No sandbox badge here any more. It existed to caveat the invented
            client/AUM/inflow figures; what is left — the product's name, type
            and whether it is live — is real configuration the operator owns. */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Button type="button" variant="outline" className="min-h-12" onClick={onBulk}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            Bulk import
          </Button>
          <Button type="button" className="min-h-12" onClick={onList}>
            <Plus className="h-4 w-4" aria-hidden />
            Add one
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
        <label className="min-w-[180px] flex-1 text-[13px]">
          <span className="sr-only">Search products by name, abbreviation, or type</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search products"
            className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          />
        </label>
        <label className="min-w-[150px] flex-1 text-[13px] sm:min-w-0 sm:flex-none">
          <span className="sr-only">Filter products by listing status</span>
          <select
            value={status}
            onChange={(event) => onStatus(event.target.value)}
            className="block min-h-11 w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
          >
            <option value="">All statuses</option>
            <option value="live">Live</option>
            <option value="paused">Paused</option>
          </select>
        </label>
      </div>

      {productsError ? <ErrorNote message={productsError} className="px-4 pb-4 sm:px-6" /> : null}
      {productActionError ? (
        <ErrorNote message={productActionError} className="px-4 pb-4 sm:px-6" />
      ) : null}

      {loading && !productsError ? <RowsSkeleton rows={3} label="Loading your products" /> : null}

      {!loading && !productsError && products.length === 0 ? (
        <div className="px-6 pb-6">
          <EmptyState
            icon={Boxes}
            title={status || query ? 'No products match' : 'No products listed yet'}
            body={
              status || query
                ? 'Change or clear the search and status filters to see a different part of your catalogue.'
                : 'List your funds and notes here and the agent can match them to suitable clients. You can pause any of them later without delisting it.'
            }
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" size="sm" onClick={onList}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add one
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onBulk}>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  Bulk import
                </Button>
              </div>
            }
          />
        </div>
      ) : null}

      {!loading && !productsError && products.length > 0 ? (
        <div className="relative overflow-x-hidden">
          <div>
            {/* Clients / AUM / Inflow columns removed: CCN computes none of
                them, so the figures that used to fill them were invented. What
                is here instead is what the investor is shown. */}
            <div
              className={`hidden grid-cols-[2.4fr_1fr_0.9fr_1.4fr] px-6 pb-2 md:grid ${ROW_DIVIDER} ${uppr}`}
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
                  className={`grid grid-cols-2 items-center gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[2.4fr_1fr_0.9fr_1.4fr] md:gap-0 md:px-6 md:py-3.5 ${ROW_DIVIDER}`}
                >
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <div className="text-[15px] font-bold md:truncate md:text-sm">{p.name}</div>
                    <div className="mt-0.5 text-[13px] text-faint md:text-xs">
                      {[typeLabel, p.metric ? `${p.metric} ${p.metricLabel ?? ''}`.trim() : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  {/* An unset minimum reads "No minimum", not "US$0" — zero is
                      a price, and the two are not the same claim. */}
                  <div className="min-w-0 md:text-right">
                    <div className={`${uppr} mb-1 md:hidden`}>Minimum</div>
                    <div className="font-mono text-[13px]">
                      {p.minInvestmentMinor === '0'
                        ? 'No minimum'
                        : fmtMinor(p.minInvestmentMinor, p.currency as ConsoleCurrency)}
                    </div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div className={`${uppr} mb-1 md:hidden`}>Risk</div>
                    <div className="text-[13px] capitalize text-dim">{p.risk ?? 'Not rated'}</div>
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-3 border-0 border-t border-solid border-border pt-3 md:col-span-1 md:justify-end md:border-t-0 md:pt-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-11 px-2 md:h-9"
                      onClick={() => onEdit(p)}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      <span className="md:sr-only">Edit details</span>
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

      {!loading && !productsError ? (
        <ConsolePager
          label="Products"
          total={total}
          offset={offset}
          pageSize={pageSize}
          visible={products.length}
          onPage={onPage}
        />
      ) : null}
    </Card>
  );
}
