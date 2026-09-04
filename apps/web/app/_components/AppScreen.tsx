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

export const DEMO_PROFILE_STORAGE_KEY = 'ccn-demo-investor-profile';
export const DEMO_ACCOUNT_STORAGE_KEY = 'ccn-demo-account-state';
export const DEMO_JOURNEY_STORAGE_KEY = 'ccn.demo.journey';

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
  citizenships: string[];
  pepStatus: string;
  fatcaStatus: string;
  sourceOfFunds: string[];
  taxIdType: string;
  taxIdLastFour: string;
};

export const DEFAULT_DEMO_PROFILE: DemoProfile = {
  name: 'Investor',
  residence: 'United States',
  age: '35–44',
  objective: 'Income and long-term growth',
  horizon: '5–10 years',
  risk: 'Balanced',
  liquidity: 'Monthly access',
  financialSituation: 'Stable income; six-month cash reserve',
  jamaicanCitizen: true,
  usCitizen: true,
  citizenships: ['Jamaica', 'United States'],
  pepStatus: 'Not a PEP',
  fatcaStatus: 'U.S. person',
  sourceOfFunds: ['Salary'],
  taxIdType: 'SSN',
  taxIdLastFour: '4821',
};

export type DemoAccountState = {
  approvedActions: string[];
  fundedPartners: string[];
  ncbEvidenceFingerprint: string | null;
  ncbClientStatus: 'needs_evidence' | 'evidence_ready' | 'ready_for_review' | 'accepted';
  opportunityOrders: DemoOpportunityOrder[];
};

export type DemoOpportunityOrder = {
  id: string;
  name: string;
  partner: string;
  amount: string;
};

export function nextDemoOrderId(baseId: string, orders: DemoOpportunityOrder[]): string {
  let sequence = 1;
  while (orders.some((order) => order.id === `${baseId}-${sequence}`)) sequence += 1;
  return `${baseId}-${sequence}`;
}

export const DEFAULT_DEMO_ACCOUNT_STATE: DemoAccountState = {
  approvedActions: [],
  fundedPartners: [],
  ncbEvidenceFingerprint: null,
  ncbClientStatus: 'needs_evidence',
  opportunityOrders: [],
};

export type DemoIdentityEvidence = {
  clientReference: string;
  currentDocument: string;
  replacementDocument: string | null;
  replacementButtonLabel: string;
  replacementSummary: string;
  addressEvidence: string;
  taxIdentifiers: string;
};

export type DemoVillaContext = {
  minimumAmount: string;
  portfolioShare: string;
  singlePositionCap: string;
};

export function demoIdentityFingerprint(profile: DemoProfile): string {
  return JSON.stringify([
    profile.name.trim(),
    profile.residence,
    profile.jamaicanCitizen,
    profile.usCitizen,
    profile.citizenships,
    profile.pepStatus,
    profile.fatcaStatus,
    profile.sourceOfFunds,
    profile.taxIdType,
    profile.taxIdLastFour,
  ]);
}

/** Keeps the sample compliance pack aligned with the editable fact-find. */
export function demoIdentityEvidence(profile: DemoProfile): DemoIdentityEvidence {
  const citizenships = [
    ...profile.citizenships,
    ...(profile.jamaicanCitizen ? ['Jamaica'] : []),
    ...(profile.usCitizen ? ['United States'] : []),
  ].filter((country, index, values) => values.indexOf(country) === index);
  const countryLabel = (country: string | undefined) => {
    if (country === 'United States') return 'U.S.';
    if (country === 'United Kingdom') return 'UK';
    if (country === 'Jamaica') return 'Jamaican';
    if (country === 'Canada') return 'Canadian';
    return country ?? null;
  };
  const currentCountry = countryLabel(citizenships[0]);
  const replacementCountry = countryLabel(citizenships[1] ?? citizenships[0]);
  const lastFour = /^\d{4}$/.test(profile.taxIdLastFour) ? profile.taxIdLastFour : '';
  const maskedTaxId =
    profile.taxIdType && lastFour
      ? `${profile.taxIdType} ${profile.taxIdType === 'SSN' ? '•••-••-' : '•••-•••-'}${lastFour}`
      : 'Tax identifier requires clarification';

  return {
    clientReference: lastFour ? `••${lastFour}` : 'unverified',
    currentDocument: currentCountry
      ? `${currentCountry} passport P•••1842 · expired 12 Jun 2025`
      : 'Passport evidence missing · select citizenship in the profile',
    replacementDocument: replacementCountry
      ? `${replacementCountry} passport P•••4821 · expires 18 Sep 2031`
      : null,
    replacementButtonLabel: replacementCountry
      ? `Use valid ${replacementCountry} passport`
      : 'Select citizenship in profile',
    replacementSummary: replacementCountry
      ? `Expired ${currentCountry} passport replaced with valid ${replacementCountry} passport`
      : 'Citizenship requires clarification before identity evidence can be selected',
    addressEvidence: `${profile.residence === 'United States' ? 'New York' : profile.residence} utility statement · Jul 2026`,
    taxIdentifiers: `${maskedTaxId} · ${profile.fatcaStatus || 'FATCA status requires clarification'} · ${profile.pepStatus || 'PEP status requires clarification'} · ${profile.sourceOfFunds.length > 0 ? `source of funds: ${profile.sourceOfFunds.join(', ')}` : 'source of funds requires clarification'}`,
  };
}

/** Suitability reasons shared by the matches screen and advisor explanation. */
export function demoVillaScreenReasons(profile: DemoProfile, context: DemoVillaContext): string[] {
  const reasons = [
    `Size: the ${context.minimumAmount} minimum is ${context.portfolioShare} of this portfolio, above its ${context.singlePositionCap} single-position cap`,
  ];
  const liquidityTolerance =
    profile.liquidity === 'Can lock for 3 years'
      ? 'three-year lock tolerance'
      : `${profile.liquidity.toLowerCase()} liquidity need`;
  if (profile.risk !== 'Growth') {
    reasons.unshift(
      `Risk: the ${profile.risk.toLowerCase()} risk profile does not fit this speculative development note`,
    );
  }
  reasons.push(
    `Liquidity: five years with no secondary market exceeds the ${liquidityTolerance}${profile.horizon === '10+ years' ? '' : ` and conflicts with the ${profile.horizon.toLowerCase()} horizon`}`,
  );
  if (
    profile.objective === 'Income and long-term growth' ||
    profile.objective === 'Retirement income'
  ) {
    reasons.push(
      `Income: nothing is paid until exit, which conflicts with the ${profile.objective.toLowerCase()} objective`,
    );
  }
  return reasons;
}

let inMemoryDemoProfile: DemoProfile | null = null;
let inMemoryDemoAccountState: DemoAccountState | null = null;

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
          if (Array.isArray(expected)) {
            return Array.isArray(value) && value.every((item) => typeof item === 'string');
          }
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

/** Keeps connected preview outcomes stable as the user moves between screens. */
export function readDemoAccountState(): DemoAccountState {
  try {
    const stored = window.sessionStorage.getItem(DEMO_ACCOUNT_STORAGE_KEY);
    if (!stored) return { ...(inMemoryDemoAccountState ?? DEFAULT_DEMO_ACCOUNT_STATE) };
    const candidate = JSON.parse(stored) as Partial<DemoAccountState>;
    const state: DemoAccountState = {
      approvedActions: Array.isArray(candidate.approvedActions)
        ? candidate.approvedActions.filter((value): value is string => typeof value === 'string')
        : [],
      fundedPartners: Array.isArray(candidate.fundedPartners)
        ? candidate.fundedPartners.filter((value): value is string => typeof value === 'string')
        : [],
      ncbEvidenceFingerprint:
        typeof candidate.ncbEvidenceFingerprint === 'string'
          ? candidate.ncbEvidenceFingerprint
          : null,
      ncbClientStatus:
        candidate.ncbClientStatus === 'accepted' ||
        candidate.ncbClientStatus === 'ready_for_review' ||
        candidate.ncbClientStatus === 'evidence_ready'
          ? candidate.ncbClientStatus
          : 'needs_evidence',
      opportunityOrders: Array.isArray(candidate.opportunityOrders)
        ? candidate.opportunityOrders.filter(
            (value): value is DemoOpportunityOrder =>
              typeof value === 'object' &&
              value !== null &&
              typeof (value as Partial<DemoOpportunityOrder>).id === 'string' &&
              typeof (value as Partial<DemoOpportunityOrder>).name === 'string' &&
              typeof (value as Partial<DemoOpportunityOrder>).partner === 'string' &&
              typeof (value as Partial<DemoOpportunityOrder>).amount === 'string',
          )
        : [],
    };
    inMemoryDemoAccountState = state;
    return { ...state };
  } catch {
    return { ...(inMemoryDemoAccountState ?? DEFAULT_DEMO_ACCOUNT_STATE) };
  }
}

export function writeDemoAccountState(state: DemoAccountState): void {
  inMemoryDemoAccountState = { ...state };
  try {
    window.sessionStorage.setItem(DEMO_ACCOUNT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is optional; the current screen keeps its in-memory state.
  }
}

/** Starts a new preview visitor without carrying an earlier walkthrough's
 * personalisation, approvals, funding or orders into the next session. */
export function resetDemoInvestorState(): void {
  inMemoryDemoProfile = null;
  inMemoryDemoAccountState = null;
  try {
    window.sessionStorage.removeItem(DEMO_PROFILE_STORAGE_KEY);
    window.sessionStorage.removeItem(DEMO_ACCOUNT_STORAGE_KEY);
  } catch {
    // The next route still starts from the module defaults when storage is unavailable.
  }
}

type DemoMatchInput = {
  id: string;
  match: number;
  risk: string;
  type: string;
  term: string;
};

/** Deterministic preview scoring shared by the match cards and advisor. */
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
