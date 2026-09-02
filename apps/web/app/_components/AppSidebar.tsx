'use client';

import { AccountMenu } from '@/app/_components/AccountMenu';
import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { useMaybeMe } from '@/app/_lib/session';
import { cn } from '@/app/_lib/utils';
import { type Approval, getApprovals } from '@/lib/portfolio-api';
import {
  ArrowRightLeft,
  Building2,
  Compass,
  HandHeart,
  LayoutGrid,
  LineChart,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Every destination the investor shell can be on.
 *
 * Exported because AppScreen used to keep a second hand-written copy of this
 * union, and the two quietly stopped agreeing the moment a route was added —
 * the same failure `navGroupsFor` documents for the nav list itself. One
 * definition, imported.
 */
export type Key =
  | 'home'
  | 'portfolio'
  | 'opportunities'
  | 'orders'
  | 'agent'
  | 'planning'
  | 'onboarding'
  | 'gatewayMandate'
  | 'gatewayOpportunities'
  | 'gatewayIntroductions'
  | 'gatewayReview'
  | 'institutions';

/**
 * Nav items carry no counts. Each one used to ship a hardcoded badge (4, 8, 2)
 * that matched nothing in the database — on a brand-new account the sidebar
 * would announce eight opportunities and two pending actions before the user
 * owned anything at all. The one count that is real (approvals awaiting you) is
 * fetched below and shown once, in the agent card.
 */
export interface NavGroup {
  label: string;
  items: { key: Key; label: string; href: string; Icon: LucideIcon; tour?: string }[];
}

/**
 * Two groups, not four. The rail used to open with four uppercase group
 * headings over eleven links — "OVERVIEW" labelling two items, "INVEST"
 * labelling three — which read as a sitemap, not a place to go. The daily
 * screens are one unlabelled list in the order a person uses them; the
 * private-markets gateway keeps its heading because it is genuinely a
 * different room.
 */
const GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      { key: 'home', label: 'Home', href: '/home', Icon: LayoutGrid },
      {
        key: 'portfolio',
        label: 'Portfolio',
        href: '/portfolio',
        Icon: LineChart,
        tour: 'customer-portfolio',
      },
      {
        key: 'opportunities',
        label: 'Invest',
        href: '/opportunities',
        Icon: TrendingUp,
        tour: 'customer-opportunities',
      },
      // `customer-agent` is not here: the tour highlights the agent panel
      // itself (the hero's right column on /home, the chat card on /agent), not
      // the link to it.
      // Where an authorised order goes. GET /api/orders had no reader at all,
      // so a person watched the exec dialog close and never learned whether
      // their institution accepted, settled or declined it.
      {
        key: 'orders',
        label: 'My orders',
        href: '/orders',
        Icon: ArrowRightLeft,
        tour: 'customer-orders',
      },
      { key: 'agent', label: 'Your agent', href: '/agent', Icon: Sparkles },
      { key: 'planning', label: 'Planning', href: '/planning', Icon: ShieldCheck },
      /**
       * Onboarding leaves the rail once it is finished — a permanent link to a
       * completed one-time flow is the strongest "this is a demo" tell the rail
       * had. `navGroupsFor` drops it when the session says it is complete.
       */
      { key: 'onboarding', label: 'Finish onboarding', href: '/onboarding', Icon: UserPlus },
    ],
  },
  {
    label: 'Private markets',
    items: [
      { key: 'gatewayMandate', label: 'Mandate', href: '/gateway/mandate', Icon: Target },
      {
        key: 'gatewayOpportunities',
        label: 'Private deals',
        href: '/gateway/opportunities',
        Icon: Compass,
      },
      {
        key: 'gatewayIntroductions',
        label: 'Introductions',
        href: '/gateway/introductions',
        Icon: HandHeart,
      },
      // Visible to everyone, useful to analysts and compliance. The screen
      // itself says who it is for rather than the rail hiding it: `useMe()`
      // resolves after the nav renders, and a link that appears a beat late is
      // a worse tell than one that explains itself on arrival.
      {
        key: 'gatewayReview',
        label: 'Review queue',
        href: '/gateway/review',
        Icon: ShieldCheck,
      },
    ],
  },
];

// The actionable state has a stable title and body height while the count loads.
const CARD_TITLE = 'mb-1 min-h-[24px] font-display text-base font-semibold';
const CARD_BODY = 'mb-3 min-h-[38px] text-[13.5px] leading-snug opacity-80';

/**
 * The agent's presence in the rail: loud only when something actually waits.
 *
 * This used to be a full navy card on every screen — "Checking with your
 * agent…", a two-line body, a peach button — narrating the agent's idle state
 * to somebody trying to read their portfolio. An assistant with nothing to say
 * should be absent; the tall card with the button now appears only when approvals
 * are genuinely waiting on the person, which is the one moment it earns the space.
 */
export function AgentCard() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovals()
      .then(({ approvals: rows }) => {
        if (!cancelled) setApprovals(rows);
      })
      .catch(() => {
        // Quietly: the rail is not the place to report a fetch failure, and the
        // compact row below already links to the agent screen, which is.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = approvals?.filter((a) => a.status === 'pending').length ?? 0;

  // The navigation already has a permanent Agent destination. A second idle
  // prompt adds no information and competes with the screen a person opened.
  // The card earns its place only when there is a real decision to make.
  if (pending === 0) return null;

  return (
    <div className="app-sidebar__agentcard mb-3 rounded-[18px] bg-primary p-[17px] text-[#eafaf5] dark:bg-[#124e48]">
      <div className="mb-1.5 flex items-center gap-[7px] text-[13.5px] opacity-85">
        <span className="h-[7px] w-[7px] rounded-full bg-peach" />
        Your agent
      </div>
      <div className={CARD_TITLE}>{pending} waiting on you</div>
      <div className={CARD_BODY}>
        {pending === 1 ? 'One action is' : `${pending} actions are`} ready for your approval.
      </div>
      <Link
        href="/agent"
        className="block rounded-[11px] bg-peach py-[11px] text-center text-[15px] font-bold text-[#3a2415] no-underline"
      >
        Review with agent
      </Link>
    </div>
  );
}

/**
 * The destinations for a shell, given its base path.
 *
 * The demo shell (basePath="/demo") links only to fixture-backed screens. The
 * partner workspace has its own isolated fixture route, while Gateway remains
 * live-only and Onboarding remains the real signup flow.
 *
 * Exported because the rail and the mobile drawer are two presentations of one
 * navigation, and a second hand-written copy of this list is how the two would
 * quietly stop agreeing about what the product contains.
 */
export function navGroupsFor(basePath: string, showOnboarding = false): NavGroup[] {
  if (basePath) {
    // The preview uses the same primary information architecture as the live
    // customer app. Its deterministic state belongs behind these routes, not
    // in numbered navigation that teaches a different product structure.
    const demoItems: NavGroup['items'] = [
      { key: 'home', label: 'Home', href: '/home', Icon: LayoutGrid },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', Icon: LineChart },
      { key: 'opportunities', label: 'Invest', href: '/opportunities', Icon: TrendingUp },
      { key: 'orders', label: 'My orders', href: '/orders', Icon: ArrowRightLeft },
      { key: 'agent', label: 'Your agent', href: '/agent', Icon: Sparkles },
      { key: 'planning', label: 'Planning', href: '/planning', Icon: ShieldCheck },
    ];
    return [
      { label: '', items: demoItems },
      {
        label: 'Partner workspace',
        items: [
          {
            key: 'institutions',
            label: 'Partner console',
            href: '/institutions',
            Icon: Building2,
          },
        ],
      },
    ];
  }
  if (showOnboarding) return GROUPS;
  // A finished (or still-loading) one-time flow gets no permanent link. Only a
  // session known to be mid-onboarding shows the way back into it.
  return GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== 'onboarding') }));
}

/** One group's links. Shared by the rail and the drawer. */
export function NavLinks({
  groups,
  active,
  basePath,
  withTourTargets,
}: {
  groups: NavGroup[];
  active: Key | 'institutions';
  basePath: string;
  withTourTargets: boolean;
}) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.label || 'main'}>
          {/* The main list carries no heading — labelling "Home, Portfolio,
              Invest" as OVERVIEW/INVEST read as a sitemap, not navigation. */}
          {g.label ? (
            <div className="mt-2 border-0 border-t border-solid border-border px-2.5 pb-2 pt-3.5 text-xs font-bold uppercase tracking-[1.6px] text-faint">
              {g.label}
            </div>
          ) : null}
          {g.items.map(({ key, label, href, Icon, tour }) => {
            const on = key === active;
            return (
              <Link
                key={key}
                href={`${basePath}${href}`}
                aria-current={on ? 'page' : undefined}
                data-tour={withTourTargets ? tour : undefined}
                className={cn(
                  'mb-0.5 flex items-center gap-3 rounded-[11px] px-3 py-[11px] text-[15px] no-underline',
                  on ? 'bg-mint font-bold text-primary dark:text-teal2' : 'font-semibold text-dim',
                )}
              >
                <Icon className="h-[21px] w-[21px]" aria-hidden />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function AppSidebar({
  active,
  basePath = '',
}: { active: Key | 'institutions'; basePath?: string }) {
  // Tolerates the demo shell, which mounts this rail with no session provider.
  const me = useMaybeMe();
  const groups = navGroupsFor(basePath, me !== null && !me.onboarding.complete);

  return (
    <nav
      className="app-sidebar sticky top-0 flex h-screen w-[264px] flex-none flex-col border-r border-border bg-card px-[18px] pb-5 pt-[26px]"
      aria-label="Primary"
      data-tour="customer-nav"
    >
      <Link
        href={`${basePath}/home`}
        className="flex items-center gap-3 px-2 pb-[22px] text-foreground no-underline"
      >
        <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-primary font-display text-xl font-bold text-white">
          C
        </span>
        <span className="font-display text-[17px] font-bold leading-[1.05] tracking-tight">
          Caribbean
          <br />
          Capital
        </span>
      </Link>

      {/* The nav scrolls, the footer below it does not.
          The whole rail used to be one column taller than the screen, so at a
          laptop height the agent card, the theme toggle and the account control
          sat below the fold — the way out of the product was reachable only by
          scrolling the page, and on a screen short enough it never appeared at
          all. Confining the overflow to the links keeps everything that is not a
          link on screen at every viewport height. */}
      {/* overscroll-contain: without it a wheel or trackpad scroll that ends
          inside the rail chains into the page behind it, so the whole screen
          lurches the moment the short nav list runs out — felt as jitter. */}
      <div className="app-sidebar__scroll -mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        <NavLinks groups={groups} active={active} basePath={basePath} withTourTargets={!basePath} />
      </div>

      {basePath ? null : <AgentCard />}

      {/* The live customer surface has no console link: the institution
          console is a different product for a different account, and
          /api/console answers a customer with 403. The preview does include a
          fixture-backed partner workspace so the two-sided journey remains
          reachable without crossing into live data.

          The preview shell keeps a bare theme toggle instead of the account
          menu: it has no session to name, nothing to sign out of, and calling
          /api/me from it would break the rule that the preview makes no API
          calls at all. */}
      {basePath ? (
        <div className="app-sidebar__footer flex items-center justify-end border-0 border-t border-solid border-border pt-2">
          <ThemeToggle />
        </div>
      ) : (
        <div className="app-sidebar__footer border-0 border-t border-solid border-border pt-2">
          <AccountMenu />
        </div>
      )}
    </nav>
  );
}
