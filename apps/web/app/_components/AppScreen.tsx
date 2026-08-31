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

export const DEMO_PROFILE_STORAGE_KEY = 'ccn-demo-investor-profile';

export type DemoProfile = {
  name: string;
  residence: string;
  age: string;
  objective: string;
  horizon: string;
  risk: string;
  liquidity: string;
  financialSituation: string;
  jamaicanCitizen: boolean;
  usCitizen: boolean;
};

export const DEFAULT_DEMO_PROFILE: DemoProfile = {
  name: 'Sample investor',
  residence: 'United States',
  age: '35–44',
  objective: 'Income and long-term growth',
  horizon: '5–10 years',
  risk: 'Balanced',
  liquidity: 'Monthly access',
  financialSituation: 'Stable income; six-month cash reserve',
  jamaicanCitizen: true,
  usCitizen: true,
};

let inMemoryDemoProfile: DemoProfile | null = null;

/** Browser persistence is an enhancement for the public walkthrough. Sandboxed
 * previews and privacy settings may deny storage, so every caller gets a usable
 * in-memory profile instead of a route crash. */
export function readDemoProfile(fallback: DemoProfile = DEFAULT_DEMO_PROFILE): DemoProfile {
  try {
    const stored = window.sessionStorage.getItem(DEMO_PROFILE_STORAGE_KEY);
    if (!stored) return { ...(inMemoryDemoProfile ?? fallback) };
    const candidate = JSON.parse(stored) as Partial<DemoProfile>;
    const profile = {
      ...fallback,
      ...Object.fromEntries(
        Object.entries(candidate).filter(([key, value]) => {
          const expected = fallback[key as keyof DemoProfile];
          return typeof value === typeof expected;
        }),
      ),
    };
    inMemoryDemoProfile = profile;
    return { ...profile };
  } catch {
    return { ...(inMemoryDemoProfile ?? fallback) };
  }
}

export function writeDemoProfile(profile: DemoProfile): void {
  inMemoryDemoProfile = { ...profile };
  try {
    window.sessionStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage is optional; the current screen keeps its in-memory state.
  }
}

type DemoMatchInput = {
  id: string;
  match: number;
  risk: string;
  type: string;
  term: string;
};

/** Deterministic demo scoring shared by the match cards and scripted advisor. */
export function rankDemoMatches<T extends DemoMatchInput>(
  opportunities: T[],
  profile: DemoProfile,
): (T & { match: number })[] {
  return opportunities
    .map((opportunity) => {
      let adjustment = 0;
      if (profile.liquidity === 'Weekly access') {
        adjustment += opportunity.id === 'ncbmm' ? 27 : opportunity.term.includes('yr') ? -8 : 0;
      }
      if (profile.risk === 'Conservative') {
        adjustment += opportunity.risk === 'Low' ? 4 : opportunity.risk === 'High' ? -30 : -10;
      } else if (profile.risk === 'Growth') {
        adjustment +=
          opportunity.type === 'Equity' ? 8 : opportunity.type === 'Real Estate' ? 5 : -5;
      }
      if (profile.objective === 'Capital preservation') {
        adjustment += opportunity.risk === 'Low' ? 8 : opportunity.risk === 'High' ? -25 : -10;
      } else if (profile.objective === 'Growth') {
        adjustment += opportunity.type === 'Equity' || opportunity.type === 'Real Estate' ? 8 : -4;
      } else if (profile.objective === 'Retirement income') {
        adjustment += opportunity.type === 'Bond' || opportunity.type === 'Fund' ? 5 : -3;
      }
      const termYears = Number.parseInt(opportunity.term.match(/(\d+)\s*yr/)?.[1] ?? '0', 10);
      if (profile.horizon === 'Under 3 years' && termYears >= 3) adjustment -= 25;
      if (profile.horizon === '3–5 years' && termYears > 5) adjustment -= 10;
      return { ...opportunity, match: Math.max(1, Math.min(99, opportunity.match + adjustment)) };
    })
    .sort((a, b) => b.match - a.match);
}

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
