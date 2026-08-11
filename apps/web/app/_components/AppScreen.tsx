'use client';

import { Button } from '@/app/_components/ui/button';
import { Mic } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';

type Key =
  | 'home'
  | 'portfolio'
  | 'opportunities'
  | 'agent'
  | 'planning'
  | 'onboarding'
  | 'gatewayMandate'
  | 'gatewayOpportunities'
  | 'gatewayIntroductions';

/** The investor app shell: warm sidebar + scrolling main + the Ask CCN button. */
export function AppScreen({ active, children }: { active: Key; children: ReactNode }) {
  return (
    <div className="app-shell bg-background font-sans text-foreground">
      <AppSidebar active={active} />
      <main className="relative min-w-0 flex-1 px-8 pb-24 pt-[26px]">{children}</main>
      <Button
        size="pill"
        className="fixed bottom-[26px] right-[30px] shadow-[0_12px_30px_rgba(18,78,72,0.4)]"
      >
        <Mic className="h-[18px] w-[18px]" />
        Ask CCN
      </Button>
    </div>
  );
}

/** Standard page header: muted eyebrow + display title + optional right-hand slot. */
export function PageHead({
  eyebrow,
  title,
  right,
}: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-1 text-[13.5px] text-dim">{eyebrow}</div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  );
}
