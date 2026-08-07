'use client';

import { cn } from '@/app/_lib/utils';
import {
  Building2,
  LayoutGrid,
  LineChart,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

type Key = 'home' | 'portfolio' | 'opportunities' | 'agent' | 'planning' | 'onboarding';

const GROUPS: {
  label: string;
  items: { key: Key; label: string; href: string; Icon: LucideIcon; badge?: number }[];
}[] = [
  {
    label: 'Overview',
    items: [
      { key: 'home', label: 'Home', href: '/home', Icon: LayoutGrid },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', Icon: LineChart, badge: 4 },
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
        badge: 8,
      },
      { key: 'agent', label: 'Agent', href: '/agent', Icon: Sparkles, badge: 2 },
    ],
  },
  {
    label: 'Plan',
    items: [
      { key: 'planning', label: 'Planning', href: '/planning', Icon: ShieldCheck },
      { key: 'onboarding', label: 'Onboarding', href: '/onboarding', Icon: UserPlus },
    ],
  },
];

export function AppSidebar({ active }: { active: Key | 'institutions' }) {
  return (
    <nav
      className="app-sidebar sticky top-0 flex h-screen w-[264px] flex-none flex-col border-r border-border bg-card px-[18px] pb-5 pt-[26px]"
      aria-label="Primary"
    >
      <Link
        href="/home"
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

      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="px-2.5 pb-2 pt-3.5 text-xs font-bold uppercase tracking-[1.6px] text-faint">
            {g.label}
          </div>
          {g.items.map(({ key, label, href, Icon, badge }) => {
            const on = key === active;
            return (
              <Link
                key={key}
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'mb-0.5 flex items-center gap-3 rounded-[11px] px-3 py-[11px] text-[15px] no-underline',
                  on ? 'bg-mint font-bold text-primary' : 'font-semibold text-dim',
                )}
              >
                <Icon className="h-[21px] w-[21px]" aria-hidden />
                <span className="flex-1">{label}</span>
                {badge ? (
                  <span
                    className={cn(
                      'min-w-[22px] rounded-full px-1.5 py-px text-center text-[12.5px] font-bold',
                      on ? 'bg-primary text-white' : 'bg-border text-dim',
                    )}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="app-sidebar__grow flex-1" />

      <div className="app-sidebar__agentcard mb-3 rounded-[18px] bg-primary p-[17px] text-[#eafaf5]">
        <div className="mb-1.5 flex items-center gap-[7px] text-[13.5px] opacity-85">
          <span className="h-[7px] w-[7px] rounded-full bg-peach" />
          Your agent · live
        </div>
        <div className="mb-1 font-display text-base font-semibold">6 opportunities matched</div>
        <div className="mb-3 text-[13.5px] leading-snug opacity-80">
          2 actions ready for your approval this week.
        </div>
        <Link
          href="/agent"
          className="block rounded-[11px] bg-peach py-[11px] text-center text-[15px] font-bold text-[#3a2415] no-underline"
        >
          Review with agent
        </Link>
      </div>

      <Link
        href="/institutions"
        className="flex items-center gap-2.5 rounded-[11px] px-3 py-[11px] text-[15px] font-semibold text-dim no-underline"
      >
        <Building2 className="h-5 w-5" aria-hidden />
        For institutions
      </Link>
    </nav>
  );
}
