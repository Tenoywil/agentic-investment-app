'use client';

import { AccountMenu } from '@/app/_components/AccountMenu';
import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { useMaybeMe } from '@/app/_lib/session';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { AgentCard, DemoAgentCard, NavLinks, navGroupsFor } from './AppSidebar';
import type { NavGroup } from './AppSidebar';

/**
 * The phone shell: a compact top bar, and a drawer holding the same navigation
 * the rail shows on a desktop.
 *
 * Below 900px the rail used to become a wrapping row of every destination —
 * ten links plus four group headings — which filled most of a phone screen
 * before a single word of the page appeared. The greeting sat below the fold and
 * the net worth figure was barely on it. There was no way to collapse it,
 * because it *was* the navigation.
 *
 * A sheet suits this product better than a bottom tab bar: there are ten
 * destinations across four named groups, and the grouping is the information
 * architecture — Overview, Invest, Plan, Gateway. A five-slot tab bar would have
 * to bury Gateway behind a "More", and that is the part of the product least
 * likely to be guessed at and most likely to be shown.
 *
 * It rises from the bottom rather than sliding in from the left. The left-edge
 * panel was a desktop drawer scaled down, and read as one; the bottom sheet is
 * the native idiom on both phone platforms and the reachable one, opening and
 * dismissing where the thumb already is instead of at the far top corner. It
 * carries a grab handle and takes a downward swipe, alongside the backdrop tap
 * and Escape — a gesture is an addition to the ways out, never the only one.
 *
 * The links come from AppSidebar, so the two presentations cannot drift.
 *
 * Built on <dialog>.showModal() rather than a div with role="dialog". The
 * browser then owns the top layer, the backdrop, Escape, and keeping focus
 * inside — four things that are ours to get wrong otherwise, and that a
 * hand-rolled version of this had to reimplement.
 */
export function MobileNav({
  active,
  basePath = '',
}: {
  active: Parameters<typeof NavLinks>[0]['active'];
  basePath?: string;
}) {
  const pathname = usePathname();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  // Same rule as the rail: the onboarding link appears only for a session
  // known to be mid-onboarding.
  const me = useMaybeMe();
  const groups: NavGroup[] = navGroupsFor(basePath, me !== null && !me.onboarding.complete);

  const close = React.useCallback(() => {
    dialogRef.current?.close();
  }, []);

  useSheetDismiss(dialogRef, close);

  // Navigating closes it. Without this the drawer stays open over the screen it
  // just took you to, which reads as a link that did nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacting to the path change is the point
  React.useEffect(() => {
    close();
  }, [pathname, close]);

  return (
    <div className="app-mobilenav" data-tour={basePath ? undefined : 'customer-nav'}>
      {/* Stickiness lives on .app-mobilenav (globals.css), not here: a sticky
          element can never leave its parent's box, and this wrapper used to be
          exactly one header tall — so the bar scrolled away with the page. */}
      <header className="flex items-center gap-2 border-0 border-b border-solid border-border bg-card px-3 py-2.5 pt-[max(10px,env(safe-area-inset-top))]">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            dialogRef.current?.showModal();
            setOpen(true);
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Open navigation"
          className="grid h-11 w-11 flex-none place-items-center rounded-[12px] text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Menu className="h-6 w-6" aria-hidden />
        </button>

        <Link
          href={`${basePath}/home`}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-foreground no-underline"
        >
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[11px] bg-primary font-display text-[17px] font-bold text-white">
            C
          </span>
          <span className="truncate font-display text-[15px] font-bold tracking-tight">
            Caribbean Capital Network
          </span>
        </Link>

        {/* The preview shell has no session to name, so it offers the theme
            control on its own rather than an account menu about nobody. */}
        {basePath ? <ThemeToggle /> : <AccountMenu compact />}
      </header>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard route to this
          same action is Escape, which <dialog> handles natively and delivers
          through onClose below — there is no keyboard-only user left without a
          way to dismiss, which is what this rule exists to prevent. */}
      <dialog
        ref={dialogRef}
        className="app-sheet"
        aria-label="Navigation"
        // Fires for Escape and for close(), so focus returns by either route.
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        // A click on the backdrop lands on the dialog element itself; a click on
        // anything inside lands on a descendant. That distinction is the whole
        // dismiss-on-outside-click behaviour.
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
      >
        {/* The handle is a button, not decoration: the swipe it advertises is
            unavailable to anyone not using touch, and a control that only some
            people can operate needs a click target too. */}
        <button
          type="button"
          data-sheet-handle
          onClick={close}
          aria-label="Close navigation"
          className="app-sheet__handle"
        />
        <div className="flex max-h-[calc(88dvh-24px)] flex-col px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-1">
          <div className="flex items-center justify-between pb-1">
            <span className="font-display text-[15px] font-bold tracking-tight">Menu</span>
            <button
              type="button"
              onClick={close}
              aria-label="Close navigation"
              className="grid h-10 w-10 place-items-center rounded-[12px] text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {/* No tour targets here. They live on the rail, which is what the
                steps were written against; carrying them on both would give the
                tour two elements per step. (It resolves the visible one either
                way — see tour.tsx — but one owner is clearer than two.) */}
            <NavLinks groups={groups} active={active} basePath={basePath} withTourTargets={false} />
          </div>

          <div className="pt-3">
            {basePath ? (
              <>
                <DemoAgentCard basePath={basePath} />
                <Link
                  href={`${basePath}/institutions`}
                  className="flex items-center gap-2.5 rounded-[11px] px-3 py-[11px] text-[15px] font-semibold text-dim no-underline"
                >
                  For institutions
                </Link>
              </>
            ) : (
              <AgentCard />
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
