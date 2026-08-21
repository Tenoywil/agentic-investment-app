'use client';

import { Button } from '@/app/_components/ui/button';
import { Skeleton, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { cn } from '@/app/_lib/utils';

/**
 * What a console panel shows while it is still loading.
 *
 * The console fires seven requests on mount and had no loading state at all, so
 * every panel rendered its *empty* state in the meantime: an operator opening
 * the console was told "No orders yet", "No referrals yet" and "No clients
 * waiting" — three specific, confident claims about their business — before a
 * single response had arrived. On a cold API that is a slow half-second; on
 * Render's free tier it is thirty seconds of a desk being told it has no work.
 *
 * An empty state asserts a fact. Until the data is back, there is no fact.
 */
export function RowsSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <SkeletonRegion label={label}>
      <div className="px-6 pb-6">
        {Array.from({ length: rows }, (_, i) => i).map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-0 border-b border-solid border-border py-3.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <Skeleton className="mb-2 h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-8 w-20 flex-none" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** The same idea for a grid of tiles rather than a list of rows. */
export function TilesSkeleton({ tiles = 4, label }: { tiles?: number; label: string }) {
  return (
    <SkeletonRegion label={label}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        {Array.from({ length: tiles }, (_, i) => i).map((i) => (
          <div key={i} className="rounded-lg border border-solid border-border bg-card p-[18px]">
            <Skeleton className="mb-2.5 h-3 w-1/2" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * One pager for every growing console list. It keeps page controls in the same
 * place and order on phone and desktop, names the current range for assistive
 * technology, and preserves full-size touch targets on narrow screens.
 */
export function ConsolePager({
  label,
  total,
  offset,
  pageSize,
  visible,
  onPage,
  className,
}: {
  label: string;
  total: number;
  offset: number;
  pageSize: number;
  visible: number;
  onPage: (offset: number) => void;
  className?: string;
}) {
  if (total <= pageSize) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + visible, total);
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <nav
      aria-label={`${label} pagination`}
      className={cn(
        'flex flex-col gap-3 border-x-0 border-b-0 border-t border-solid border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6',
        className,
      )}
    >
      <span className="text-center text-[13px] text-faint sm:text-left" aria-live="polite">
        {from}–{to} of {total} · Page {page} of {pages}
      </span>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 min-w-24 sm:h-9"
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 min-w-24 sm:h-9"
          disabled={to >= total}
          onClick={() => onPage(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
