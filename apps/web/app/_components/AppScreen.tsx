'use client';

import { Button } from '@/app/_components/ui/button';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { MobileNav } from './MobileNav';

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

/** The investor app shell: warm sidebar + scrolling main + the Ask CCN button.
 *  `basePath="/demo"` renders the fixture-only preview shell — no auth, no
 *  API calls, and the sidebar hides Gateway/Onboarding (neither has a demo
 *  version). Omit it for the real, signed-in, live-data app.
 *
 *  The Ask CCN pill is a link to the agent, not a voice button: it carried a
 *  microphone and no handler at all, and there is no speech capture anywhere in
 *  the product to wire it to. It hides on the agent screen itself rather than
 *  floating over the page it would navigate to. */
export function AppScreen({
  active,
  basePath = '',
  children,
}: { active: Key; basePath?: string; children: ReactNode }) {
  return (
    <div className="app-shell bg-background font-sans text-foreground">
      {/* Two presentations of one navigation, each shown at exactly one size
          (globals.css). The rail is the desktop shell; below 900px it is hidden
          and MobileNav's bar and drawer take over, because a 264px column of ten
          destinations does not fold into a phone. */}
      <AppSidebar active={active} basePath={basePath} />
      <MobileNav active={active} basePath={basePath} />
      <main className="relative min-w-0 flex-1 px-8 pb-24 pt-[26px] max-[900px]:px-4 max-[900px]:pt-5 min-[561px]:max-[900px]:px-6">
        {children}
      </main>
      {active === 'agent' ? null : (
        // On a phone it is a circular icon button. As a labelled pill it is wide
        // enough to sit across two lines of body copy while scrolling, which on
        // a 390px screen reads as a control dropped on top of the page rather
        // than floating above it. The label stays in the accessible name — it is
        // hidden visually, not removed — so the control is still "Ask CCN" to a
        // screen reader and to voice control.
        <Button
          size="pill"
          asChild
          className="fixed bottom-[26px] right-[30px] shadow-[0_12px_30px_rgba(18,78,72,0.4)] max-[900px]:bottom-4 max-[900px]:right-4 max-[900px]:h-14 max-[900px]:w-14 max-[900px]:justify-center max-[900px]:rounded-full max-[900px]:p-0"
        >
          <Link href={`${basePath}/agent`}>
            <Sparkles className="h-[18px] w-[18px] max-[900px]:h-6 max-[900px]:w-6" aria-hidden />
            <span className="max-[900px]:sr-only">Ask CCN</span>
          </Link>
        </Button>
      )}
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
