'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
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
