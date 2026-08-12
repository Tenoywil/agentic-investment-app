import { cn } from '@/app/_lib/utils';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

/**
 * The one empty state, used by both surfaces.
 *
 * A brand-new account has no holdings, no goals, no orders and no audit
 * history, and that account gets created live in front of an audience. Every
 * zero-data surface renders this rather than a dash, a zero standing in for
 * unknown, or a spinner that never resolves — and because both dashboards use
 * the same component, they read as one product.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `border-dashed` supplies the style that preflight-off otherwise leaves
        // as `none`, so the width actually paints.
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-input bg-card/40 px-6 py-10 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-muted text-dim">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      ) : null}
      <p className="font-display text-[15.5px] font-bold text-foreground">{title}</p>
      {body ? (
        <p className="mt-1.5 max-w-[42ch] text-[14px] leading-relaxed text-dim">{body}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
