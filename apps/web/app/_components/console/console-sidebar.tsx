'use client';

import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Button } from '@/app/_components/ui/button';
import { TabsList, TabsTrigger } from '@/app/_components/ui/tabs';
import { useSheetDismiss } from '@/app/_lib/sheet';
import type { MePartner } from '@/lib/me-api';
import { LogOut } from 'lucide-react';
import * as React from 'react';
import { TABS, agreementDot, agreementHeadline, regulatorLabel } from './lib';

/**
 * The navy rail: who you are, where you can go, what your agreement says, and
 * the way out.
 *
 * Every word of the identity block now comes from the operator's own partner
 * row. It used to read "Sagicor Group" with an "S" avatar for every operator on
 * the network — NCB, Proven, JMMB and Barita staff all saw a competitor's name
 * over their own order flow.
 *
 * On a phone this is a bottom sheet, the same one the investor side uses. It was
 * a block that reshaped in place: identity, then five sections wrapped onto two
 * rows, then the agreement panel — roughly 500px of an 844px screen before the
 * first word of the console. Wrapping was chosen over a sideways scroller
 * because Radix's roving-focus tablist scrolls its active tab into view and
 * fought the gesture; a drawer avoids the choice entirely by taking the
 * navigation off the screen until it is asked for.
 *
 * Authored as a <dialog> with the desktop presentation put back by CSS, which
 * is how `.agent-panels` already does it — one element, two presentations, so
 * the rail and the drawer cannot drift apart.
 */
export function ConsoleSidebar({
  partner,
  pendingOrders,
  pendingReconciliation,
  signingOut,
  onSignOut,
  dialogRef,
}: {
  partner: MePartner | null;
  pendingOrders: number;
  pendingReconciliation: number;
  signingOut: boolean;
  onSignOut: () => void;
  /** Lets the phone bar open it; unused on a desktop, where it renders inline. */
  dialogRef?: React.RefObject<HTMLDialogElement | null>;
}) {
  /** useSheetDismiss needs a ref even on the desktop, where there is no sheet. */
  const fallbackRef = React.useRef<HTMLDialogElement>(null);
  const agreement = agreementHeadline(partner?.agreementStatus);
  const regulator = regulatorLabel(partner?.regulator);

  const close = React.useCallback(() => dialogRef?.current?.close(), [dialogRef]);
  useSheetDismiss(dialogRef ?? fallbackRef, close);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Partner console navigation"
      className="console-sidebar sticky top-0 flex h-screen w-[260px] flex-none flex-col bg-navy px-4 pb-[18px] pt-6 text-[#d3e0da]"
    >
      {/* Phone-only: the grab handle for the sheet, and a real button with it,
          because a gesture must never be the only way out. */}
      <button
        type="button"
        data-sheet-handle
        onClick={close}
        aria-label="Close navigation"
        className="app-sheet__handle console-sidebar__handle"
      />
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
              onClick={close}
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
        {signingOut ? 'Signing out…' : 'Sign out'}
      </Button>
    </dialog>
  );
}
