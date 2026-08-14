'use client';

import { useMe } from '@/app/_lib/session';
import { cn } from '@/app/_lib/utils';
import { authClient } from '@/lib/auth-client';
import { ChevronsUpDown, HelpCircle, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useTourAvailable } from './tour/tour';
import { Avatar, AvatarFallback } from './ui/avatar';

/**
 * The account menu: who you are, the theme, replaying the tour, and the way out.
 *
 * The customer surface had no sign-out at all. The only profile affordance was a
 * decorative avatar in the /home header — an icon shaped exactly like an account
 * menu that opened nothing, on the one screen that had it. The institution
 * console has had a real Sign out button since it was built, so a signed-in
 * customer was the only person in the product who could not leave.
 *
 * It lives in the sidebar footer rather than the page header for two reasons:
 * the footer is on every screen (the header avatar was on one), and the page
 * header's right-hand slot is already spoken for on four screens.
 *
 * Hand-rolled against the ARIA menu-button pattern because @radix-ui/react-
 * dropdown-menu is not a dependency of this app. That means the keyboard
 * contract is ours to honour, so it is written out explicitly below: the trigger
 * is one tab stop, arrows move within the menu, Escape closes and returns focus
 * to the trigger, and a click outside dismisses.
 */

/** Up to two initials. Mirrors the helper the /home header used to own. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const ITEM =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[14px] font-semibold text-foreground no-underline transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

/**
 * `compact` is the phone header's presentation: the avatar alone, sized to a
 * comfortable touch target, with the menu dropping below it. The rail's version
 * shows the name beside the avatar and opens upward out of the footer.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const tourAvailable = useTourAvailable();
  const [open, setOpen] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  /** Close on a click anywhere outside, and on Escape from anywhere within. */
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  /** Opening moves focus into the menu — otherwise the keyboard user is left
   *  behind on the trigger with no way into what just appeared. */
  React.useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  /** Arrows move within the menu; Tab leaves it entirely, as the pattern says. */
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') focus(at + 1);
    else if (e.key === 'ArrowUp') focus(at - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('ccn-theme', next ? 'dark' : 'light');
    } catch {
      // Private mode or blocked storage: the theme still flips, it is just not
      // remembered for the next visit.
    }
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      // A full navigation rather than a router push: it discards every cached
      // fetch and all component state, so nothing of the previous account can
      // survive into the sign-in screen behind it.
      window.location.href = '/';
    }
  }

  const name = me?.user.name?.trim() ? me.user.name.trim() : null;
  const email = me?.user.email ?? null;
  // Identity is what this control is for. Until the session resolves there is
  // nothing truthful to label it with, so it is not rendered at all rather than
  // shown as an empty circle that opens a menu about nobody.
  if (!me) return null;

  return (
    <div ref={wrapRef} className="relative">
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute z-50 w-[240px] rounded-[14px] border border-solid border-border bg-card p-1.5 shadow-[0_18px_44px_rgba(24,32,29,0.22)]',
            // In the phone header there is nothing above to open into, so it
            // drops; out of the rail's footer there is nothing below, so it rises.
            compact ? 'right-0 top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)] left-0',
          )}
        >
          <div className="border-0 border-b border-solid border-border px-2.5 pb-2 pt-1.5">
            {name ? <div className="truncate text-[14px] font-bold">{name}</div> : null}
            {email ? <div className="truncate text-[12.5px] text-dim">{email}</div> : null}
          </div>

          <div className="pt-1.5">
            <button type="button" role="menuitem" className={ITEM} onClick={toggleTheme}>
              {mounted && dark ? (
                <Sun className="h-[17px] w-[17px] text-dim" aria-hidden />
              ) : (
                <Moon className="h-[17px] w-[17px] text-dim" aria-hidden />
              )}
              {mounted && dark ? 'Light theme' : 'Dark theme'}
            </button>

            {/* Only when there is a tour to replay. The launcher used to be a
                floating pill pinned to the bottom-right corner — the same corner
                as Ask CCN, which it sat directly on top of. */}
            {tourAvailable ? (
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent('ccn:tour'));
                }}
              >
                <HelpCircle className="h-[17px] w-[17px] text-dim" aria-hidden />
                Replay tour
              </button>
            ) : null}

            {/*
              The only route into /admin.

              The administration surface has never been linked from anywhere.
              The single occurrence of the string in the whole app was a fallback
              destination inside an error screen, so an administrator's way in
              was to know the URL and type it. It is shown only to accounts that
              hold the role, which comes from ADMIN_EMAILS and cannot be granted
              in-product, so this reveals nothing to anyone who could not already
              open it.
            */}
            {(me?.roles ?? []).includes('admin') ? (
              <Link href="/admin" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
                <ShieldCheck className="h-[17px] w-[17px] text-dim" aria-hidden />
                Administration
              </Link>
            ) : null}

            <button
              type="button"
              role="menuitem"
              className={cn(ITEM, signingOut && 'opacity-60')}
              onClick={signOut}
              disabled={signingOut}
            >
              <LogOut className="h-[17px] w-[17px] text-dim" aria-hidden />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        // The avatar alone carries no text, so the name is the accessible name.
        aria-label={compact ? `Account: ${name ?? 'signed in'}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex items-center rounded-[12px] border border-solid border-transparent transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[open=true]:bg-muted',
          compact ? 'h-11 w-11 flex-none justify-center' : 'w-full gap-2.5 px-2 py-2 text-left',
        )}
        data-open={open}
      >
        <Avatar className={compact ? 'h-9 w-9 flex-none' : 'h-9 w-9 flex-none'}>
          <AvatarFallback className="text-[13px]">{initials(name ?? '')}</AvatarFallback>
        </Avatar>
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold leading-tight">{name}</span>
              <span className="block truncate text-[12px] leading-tight text-dim">Account</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 flex-none text-faint" aria-hidden />
          </>
        )}
      </button>
    </div>
  );
}
