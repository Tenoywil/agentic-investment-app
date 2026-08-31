'use client';

import { cn } from '@/app/_lib/utils';
import Link from 'next/link';
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

export type DemoJourneyStep =
  | 'profile'
  | 'matches'
  | 'advisor'
  | 'compliance'
  | 'partner'
  | 'dashboard';

const DEMO_JOURNEY: { key: DemoJourneyStep; label: string; href: string }[] = [
  { key: 'profile', label: 'Profile', href: '/demo/planning' },
  { key: 'matches', label: 'Matches', href: '/demo/opportunities' },
  { key: 'advisor', label: 'Advisor', href: '/demo/agent' },
  { key: 'compliance', label: 'Compliance', href: '/demo/orders' },
  { key: 'partner', label: 'Partner review', href: '/demo/institutions' },
  { key: 'dashboard', label: 'Dashboard', href: '/demo/home' },
];

/** A route-level map for the scripted Marcus walkthrough. Each destination is
 * a real screen so evaluators can see the hand-offs instead of one long mock. */
export function DemoJourney({ current }: { current: DemoJourneyStep }) {
  const currentIndex = DEMO_JOURNEY.findIndex((step) => step.key === current);

  return (
    <nav
      aria-label="Demo lifecycle journey"
      className="mb-5 rounded-2xl border border-border bg-card p-3"
    >
      <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 xl:grid-cols-6">
        {DEMO_JOURNEY.map((step, index) => {
          const active = step.key === current;
          const complete = index < currentIndex;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm no-underline',
                  active
                    ? 'bg-primary font-bold text-white'
                    : complete
                      ? 'bg-mint font-semibold text-teal2'
                      : 'bg-muted/55 font-semibold text-dim hover:text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold',
                    active ? 'bg-white/20' : complete ? 'bg-primary text-white' : 'bg-border',
                  )}
                >
                  {complete ? '✓' : index + 1}
                </span>
                <span>{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
