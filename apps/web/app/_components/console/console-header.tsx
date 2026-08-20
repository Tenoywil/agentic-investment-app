'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import type { ReactNode } from 'react';
import { TABS, type TabKey } from './lib';

/**
 * Page header. The h1 names the tab, not the firm: the firm's name is already
 * the first thing on screen — the sidebar carries it on a desktop, the sticky
 * top bar on a phone — and repeating it here as a 30px title (plus a
 * kind · code chip) said nothing the operator didn't have while hiding the one
 * thing this header can add, which is where inside the console they are.
 * Partner code, business and regulator are rows on the compliance tab's own
 * card, which is the place an operator would check them.
 */
export function ConsoleHeader({ tab }: { tab: TabKey }) {
  const title = TABS.find((t) => t.key === tab)?.label ?? 'Overview';
  return (
    <div className="mb-[22px] flex flex-wrap items-center justify-between gap-4">
      <h1 className="m-0 font-display text-3xl font-bold tracking-tight">{title}</h1>
      <ThemeToggle />
    </div>
  );
}

/** Shared phone identity bar. Navigation lives at the bottom; the right slot is for exit. */
export function ConsoleMobileHeader({
  partnerName,
  context,
  action,
}: {
  partnerName: string;
  context: string;
  action: ReactNode;
}) {
  return (
    <header className="console-topbar">
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[15px] font-bold leading-tight text-white">
          {partnerName}
        </div>
        <div className="truncate font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#d3e0da]/70">
          {context}
        </div>
      </div>
      {action}
    </header>
  );
}
