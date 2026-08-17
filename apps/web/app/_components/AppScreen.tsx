'use client';

import type { ReactNode } from 'react';
import { AppSidebar, type Key } from './AppSidebar';
import { MobileNav } from './MobileNav';
import { VoiceAsk } from './VoiceAsk';

// The shell's destinations live with the navigation that offers them.

/** The investor app shell: warm sidebar + scrolling main + the Ask CCN button.
 *  `basePath="/demo"` renders the fixture-only preview shell — no auth, no
 *  API calls, and the sidebar hides Gateway/Onboarding (neither has a demo
 *  version). Omit it for the real, signed-in, live-data app.
 *
 *  The corner control is voice — see VoiceAsk. It hides on the agent screen
 *  itself, where the composer's own microphone is the right affordance. */
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
      {/* On a phone it is a circular icon button. As a labelled pill it is wide
          enough to sit across two lines of body copy while scrolling, which on a
          390px screen reads as a control dropped on top of the page rather than
          floating above it. The label stays in the accessible name — hidden
          visually, not removed — so it is still "Ask CCN" to a screen reader and
          to voice control. Hidden on /agent itself, where the composer's own
          microphone is the right affordance. */}
      {active === 'agent' ? null : <VoiceAsk basePath={basePath} />}
    </div>
  );
}

/** Standard page header: display title + a muted one-line explainer under it +
 *  optional right-hand slot.
 *
 *  The explainer used to sit ABOVE the h1 as an eyebrow, so the first thing on
 *  every screen was a line of small print pushing the page's own name (and
 *  everything after it) down. The title leads now; the line that says what the
 *  page does sits directly under it, close enough to read as its subtitle. */
export function PageHead({
  eyebrow,
  title,
  right,
}: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-[18px] flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
        <div className="mt-0.5 text-[13.5px] text-dim">{eyebrow}</div>
      </div>
      {right}
    </div>
  );
}
