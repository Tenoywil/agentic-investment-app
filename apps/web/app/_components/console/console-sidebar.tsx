'use client';

import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Button } from '@/app/_components/ui/button';
import { TabsList, TabsTrigger } from '@/app/_components/ui/tabs';
import type { MePartner } from '@/lib/me-api';
import { LogOut } from 'lucide-react';
import { TABS, type TabKey, agreementDot, agreementHeadline, regulatorLabel } from './lib';

/**
 * The navy rail: who you are, where you can go, what your agreement says, and
 * the way out.
 *
 * Every word of the identity block now comes from the operator's own partner
 * row. It used to read "Sagicor Group" with an "S" avatar for every operator on
 * the network — NCB, Proven, JMMB and Barita staff all saw a competitor's name
 * over their own order flow.
 *
 * This is the desktop rail. Phones use the fixed five-item tab bar below, so a
 * second navigation drawer would duplicate every destination and consume the
 * top bar's most valuable control position.
 */
export function ConsoleSidebar({
  partner,
  operator,
  pendingOrders,
  pendingReconciliation,
  signingOut,
  onSignOut,
  exitLabel = 'Sign out',
  busyExitLabel = 'Signing out…',
}: {
  partner: MePartner | null;
  operator: { name: string; email: string } | null;
  pendingOrders: number;
  pendingReconciliation: number;
  signingOut: boolean;
  onSignOut: () => void;
  /** Lets isolated previews reuse the rail without implying an authenticated session. */
  exitLabel?: string;
  busyExitLabel?: string;
}) {
  const agreement = agreementHeadline(partner?.agreementStatus);
  const regulator = regulatorLabel(partner?.regulator);
  const operatorInitials = operator?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <aside
      aria-label="Partner console navigation"
      className="console-sidebar sticky top-0 flex h-screen w-[260px] flex-none flex-col bg-navy px-4 pb-[18px] pt-6 text-[#d3e0da]"
    >
      <div
        className="console-sidebar__identity flex items-center gap-3 px-2 pb-5"
        data-tour="institution-identity"
      >
        <Avatar className="h-[42px] w-[42px] rounded-xl">
          <AvatarFallback className="rounded-xl font-display text-[19px]">
            {partner ? partner.name.trim().charAt(0).toUpperCase() : ''}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {/* Wraps rather than truncates: a firm's own name is the one string
              on this screen that must always be readable in full. */}
          <div className="font-display text-[15px] font-bold leading-tight">{partner?.name}</div>
          <div className="mt-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#d3e0da]/70">
            Partner console
          </div>
        </div>
      </div>

      <TabsList
        aria-label="Partner console sections"
        className="console-sidebar__tabs flex flex-col items-stretch gap-[3px]"
        data-tour="institution-sections"
      >
        {TABS.map(({ key, label, Icon }) => {
          const badge =
            key === 'orders' ? pendingOrders : key === 'clients' ? pendingReconciliation : 0;
          return (
            <TabsTrigger
              key={key}
              value={key}
              data-tour={`institution-tab-${key}`}
              className="justify-start gap-3 rounded-xl px-3.5 py-3 text-[15px] font-medium text-[#d3e0da] data-[state=active]:bg-navy-active data-[state=active]:font-bold data-[state=active]:text-white"
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {badge > 0 ? (
                <span className="min-w-[22px] rounded-full bg-peach px-1.5 py-px text-center text-xs font-bold text-[#3a2415]">
                  {badge}
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <div className="console-sidebar__grow flex-1" />

      {/* The accountable human behind this session. The audit trail signs
          decisions with the same identity, so an operator can verify which
          account they are about to act as before touching a client's record. */}
      {operator ? (
        <div className="mb-3 flex items-center gap-2.5 border-0 border-t border-solid border-white/15 px-1 pt-3">
          <Avatar className="h-9 w-9 flex-none">
            <AvatarFallback className="bg-white/10 text-xs font-bold text-white">
              {operatorInitials || 'OP'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-white">{operator.name}</div>
            <div className="truncate text-[11px] text-[#d3e0da]/70">{operator.email}</div>
          </div>
        </div>
      ) : null}

      {/* Hidden entirely when the partner row carries no agreement status —
          asserting one for a firm that has not signed is the exact failure
          this panel used to commit. */}
      {agreement ? (
        <div className="console-sidebar__agreement mb-3 rounded-2xl border border-solid border-white/15 bg-white/[0.06] p-3.5">
          <div className="mb-1 flex items-start gap-2 text-[13px] font-bold leading-snug">
            <span
              className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full"
              style={{ background: agreementDot(partner?.agreementStatus) }}
              aria-hidden
            />
            <span className="min-w-0">
              {agreement}
              {regulator ? ` · ${regulator}` : ''}
            </span>
          </div>
          <div className="text-[12.5px] leading-snug text-[#d3e0da]/75">
            CCN routes orders. You execute, custody and settle.
          </div>
        </div>
      ) : null}

      <Button
        variant="outline"
        className="console-sidebar__signout justify-center gap-2.5 border-solid border-white/25 bg-transparent text-[#d3e0da] hover:bg-white/10 hover:text-white"
        onClick={onSignOut}
        disabled={signingOut}
        data-tour="institution-signout"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {signingOut ? busyExitLabel : exitLabel}
      </Button>
    </aside>
  );
}

/** One phone navigation implementation shared by the live and isolated demo consoles. */
export function ConsoleMobileTabs({ badges = {} }: { badges?: Partial<Record<TabKey, number>> }) {
  return (
    <TabsList
      aria-label="Partner console sections"
      className="console-mobile-tabs"
      data-tour="institution-mobile-sections"
    >
      {TABS.map(({ key, label, Icon }) => {
        const badge = badges[key] ?? 0;
        return (
          <TabsTrigger
            key={key}
            value={key}
            data-tour={`institution-tab-${key}`}
            className="console-mobile-tabs__item"
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {badge > 0 ? (
                <span className="console-mobile-tabs__badge" aria-label={`${badge} pending`}>
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{label}</span>
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
