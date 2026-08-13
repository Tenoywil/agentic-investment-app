'use client';

import { AccountMenu } from '@/app/_components/AccountMenu';
import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { cn } from '@/app/_lib/utils';
import { type Approval, getApprovals } from '@/lib/portfolio-api';
import {
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

const GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { key: 'home', label: 'Home', href: '/home', Icon: LayoutGrid },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', Icon: LineChart },
    ],
  },
  {
    label: 'Invest',
    items: [
      {
        key: 'opportunities',
        label: 'Opportunities',
        href: '/opportunities',
        Icon: TrendingUp,
        tour: 'customer-opportunities',
      },
      // `customer-agent` is not here: the tour highlights the agent panel
      // itself (the hero's right column on /home, the chat card on /agent), not
      // the link to it.
      { key: 'agent', label: 'Agent', href: '/agent', Icon: Sparkles },
    ],
  },
  {
    label: 'Plan',
    items: [
      { key: 'planning', label: 'Planning', href: '/planning', Icon: ShieldCheck },
      { key: 'onboarding', label: 'Onboarding', href: '/onboarding', Icon: UserPlus },
    ],
  },
  {
    label: 'Gateway',
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
    ],
  },
];

const CARD_TITLE = 'mb-1 font-display text-base font-semibold';
const CARD_BODY = 'mb-3 text-[13.5px] leading-snug opacity-80';

/**
 * The agent card, live surface: how many approvals are actually waiting on you.
 * It used to read "6 opportunities matched / 2 actions ready for your approval
 * this week" on every screen for every user, including one who had just signed
 * up. Zero is a real answer here and is written as one.
 */
export function AgentCard() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getApprovals()
      .then(({ approvals: rows }) => {
        if (!cancelled) setApprovals(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = approvals?.filter((a) => a.status === 'pending').length ?? null;

  return (
    <div className="app-sidebar__agentcard mb-3 rounded-[18px] bg-primary p-[17px] text-[#eafaf5] dark:bg-[#124e48]">
      <div className="mb-1.5 flex items-center gap-[7px] text-[13.5px] opacity-85">
        <span className="h-[7px] w-[7px] rounded-full bg-peach" />
        Your agent · live
      </div>
      {pending === null ? (
        <>
          <div className={CARD_TITLE}>{failed ? 'Your agent' : 'Checking with your agent…'}</div>
          <div className={CARD_BODY}>
            {failed
              ? 'Open the agent to see what needs a decision.'
              : 'Looking for anything waiting on your decision.'}
          </div>
        </>
      ) : (
        <>
          <div className={CARD_TITLE}>
            {pending === 0 ? 'Nothing waiting on you' : `${pending} waiting on you`}
          </div>
          <div className={CARD_BODY}>
            {pending === 0
              ? 'Anything needing your approval will appear here.'
              : `${pending === 1 ? 'One action is' : `${pending} actions are`} ready for your approval.`}
          </div>
        </>
      )}
      <Link
        href="/agent"
        className="block rounded-[11px] bg-peach py-[11px] text-center text-[15px] font-bold text-[#3a2415] no-underline"
      >
        {pending !== null && pending > 0 ? 'Review with agent' : 'Open your agent'}
      </Link>
    </div>
  );
}

/** The same card in the fixture-only preview shell, which has no session and
 *  must not call the API. It states what it is instead of inventing counts. */
export function DemoAgentCard({ basePath }: { basePath: string }) {
  return (
    <div className="app-sidebar__agentcard mb-3 rounded-[18px] bg-primary p-[17px] text-[#eafaf5] dark:bg-[#124e48]">
      <div className="mb-1.5 flex items-center gap-[7px] text-[13.5px] opacity-85">
        <span className="h-[7px] w-[7px] rounded-full bg-peach" />
        Your agent · demo
      </div>
      <div className={CARD_TITLE}>A preview of the investor app</div>
      <div className={CARD_BODY}>Sample data. Sign in to see your own position.</div>
      <Link
        href={`${basePath}/agent`}
        className="block rounded-[11px] bg-peach py-[11px] text-center text-[15px] font-bold text-[#3a2415] no-underline"
      >
        See the agent
      </Link>
    </div>
  );
}

/**
 * The destinations for a shell, given its base path.
 *
 * The demo shell (basePath="/demo") never links to auth-required, live-API
 * screens — Gateway is live-only (no fixture version ever existed), and
 * Onboarding *is* the real signup flow, not something to preview.
 *
 * Exported because the rail and the mobile drawer are two presentations of one
 * navigation, and a second hand-written copy of this list is how the two would
 * quietly stop agreeing about what the product contains.
 */
export function navGroupsFor(basePath: string): NavGroup[] {
  if (!basePath) return GROUPS;
  return GROUPS.filter((g) => g.label !== 'Gateway').map((g) =>
    g.label === 'Plan' ? { ...g, items: g.items.filter((i) => i.key !== 'onboarding') } : g,
  );
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
        <div key={g.label}>
          <div className="px-2.5 pb-2 pt-3.5 text-xs font-bold uppercase tracking-[1.6px] text-faint">
            {g.label}
          </div>
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
  const groups = navGroupsFor(basePath);

  return (
    <nav
      className="app-sidebar sticky top-0 flex h-screen w-[264px] flex-none flex-col border-r border-border bg-card px-[18px] pb-5 pt-[26px]"
      aria-label="Primary"
      data-tour={basePath ? undefined : 'customer-nav'}
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
      <div className="app-sidebar__scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <NavLinks groups={groups} active={active} basePath={basePath} withTourTargets={!basePath} />
      </div>

      {basePath ? <DemoAgentCard basePath={basePath} /> : <AgentCard />}

      {/* No console link on the customer surface: the institution console is a
          different product for a different account, and /api/console answers a
          customer with 403 — a visible route into it is a dead end at best. The
          demo shell keeps its link because that preview has both shells and no
          sign-in at all.

          The demo shell also keeps a bare theme toggle instead of the account
          menu: it has no session to name, nothing to sign out of, and calling
          /api/me from it would break the rule that the preview makes no API
          calls at all. */}
      {basePath ? (
        <div className="app-sidebar__footer flex items-center justify-between">
          <Link
            href={`${basePath}/institutions`}
            className="flex items-center gap-2.5 rounded-[11px] px-3 py-[11px] text-[15px] font-semibold text-dim no-underline"
          >
            For institutions
          </Link>
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
