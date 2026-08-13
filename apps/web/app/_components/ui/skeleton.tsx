import { cn } from '@/app/_lib/utils';

/**
 * Placeholder shapes shown while a screen's data is in flight.
 *
 * These exist for two measured problems, not for decoration.
 *
 * Every customer screen rendered zero characters for the whole fetch and then
 * dropped its content in at once. On a throttled connection that is a blank
 * page followed by a jump: /planning measured a cumulative layout shift of
 * 1.024 and /agent 0.38, against a 0.1 "good" threshold. A single line reading
 * "Loading your goals…" occupies one line of space; the grid of cards that
 * replaces it occupies several hundred pixels, and everything below it moves.
 *
 * So the rule these follow is that a skeleton must claim roughly the space its
 * content will claim. A skeleton that is merely present, but the wrong size,
 * fixes the blank screen and leaves the shift exactly where it was.
 *
 * The pulse is a Tailwind utility, and globals.css already reduces every
 * animation to nothing under `prefers-reduced-motion`, so it needs no guard of
 * its own.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/**
 * A labelled loading region.
 *
 * The shapes are `aria-hidden` — grey boxes are meaningless read aloud — so
 * without this a screen reader user gets silence during the fetch and then a
 * screen that changed for no announced reason. `role="status"` is polite: it is
 * spoken at the next pause rather than interrupting, which is right for "this
 * is on its way" and wrong for an error.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  // <output> carries an implicit role="status", so this is the native element
  // for "a result is on its way" rather than a div wearing the role. It is
  // inline by default; `block` is a floor that any display class in `className`
  // (the grid classes callers pass) overrides.
  return (
    <output aria-busy="true" className={cn('block', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </output>
  );
}

/** A card-shaped placeholder. `lines` controls how much text it stands in for. */
export function SkeletonCard({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-solid border-border bg-card p-[22px]', className)}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative list, never reordered
          key={i}
          className={cn('mb-2 h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}
