'use client';

import { Skeleton, SkeletonRegion } from '@/app/_components/ui/skeleton';

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
