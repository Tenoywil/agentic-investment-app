'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { Badge } from '@/app/_components/ui/badge';
import type { MePartner } from '@/lib/me-api';
import { TAB_TITLES, type TabKey } from './lib';

/**
 * Page header. The firm's own name and code, never a placeholder — the chip
 * used to read "Live partner data / Partner view", which said nothing the
 * operator could check; `kind` and `code` are columns on their partner row.
 */
export function ConsoleHeader({ partner, tab }: { partner: MePartner | null; tab: TabKey }) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-1 text-[13.5px] text-dim">Partner console · {TAB_TITLES[tab]}</div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{partner?.name}</h1>
      </div>
      <div className="flex items-center gap-2.5">
        <ThemeToggle />
        {partner ? (
          <div className="flex items-center gap-2.5 rounded-full border border-solid border-border bg-card py-1.5 pl-4 pr-1.5">
            {partner.kind ? <span className="text-[13.5px] text-dim">{partner.kind}</span> : null}
            <Badge className="rounded-full px-3 py-1.5 text-[13px]">{partner.code}</Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
}
