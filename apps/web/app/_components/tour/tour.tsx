'use client';

import type { Surface } from '@/lib/me-api';
import { type Driver, driver } from 'driver.js';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { stepsFor } from './steps';
import 'driver.js/dist/driver.css';

/**
 * The guided tour, one per surface.
 *
 * Mounted once from the root layout and driven by the pathname rather than by
 * session state, so it adds no request and holds no identity — it only decides
 * which of two step lists to use, and the surface guards have already ensured
 * the viewer is on routes they are entitled to.
 *
 * Behaviour that matters on stage:
 * - It never blocks. A step whose element is absent is dropped, so a brand-new
 *   empty account gets a shorter tour rather than a popover pointing at nothing.
 * - It waits for the screen's data to arrive before starting, then gives up.
 *   Auto-starting over a loading skeleton would highlight boxes that are about
 *   to move.
 * - It runs once per surface per browser, and the launcher replays it on demand,
 *   because it will be run more than once in front of an audience.
 */

const DISMISS_KEY = (surface: Surface) => `ccn.tour.${surface}`;

/** Routes that belong to each dashboard. Onboarding is excluded deliberately —
 *  it is already a step-by-step wizard and a tour on top of it is noise. */
function surfaceForPath(pathname: string): Surface | null {
  if (pathname.startsWith('/institutions')) return 'institution';
  if (
    ['/home', '/portfolio', '/opportunities', '/agent', '/planning', '/gateway'].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return 'customer';
  }
  return null;
}

function seen(surface: Surface): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY(surface)) === 'done';
  } catch {
    // Private-mode or blocked storage: treat as seen rather than reopening the
    // tour on every navigation.
    return true;
  }
}

function markSeen(surface: Surface): void {
  try {
    localStorage.setItem(DISMISS_KEY(surface), 'done');
  } catch {
    /* nothing to do — the tour simply is not remembered */
  }
}

export function Tour() {
  const pathname = usePathname();
  const surface = surfaceForPath(pathname ?? '');
  const instance = React.useRef<Driver | null>(null);
  const [canRun, setCanRun] = React.useState(false);

  const start = React.useCallback(() => {
    if (!surface) return;
    // Only steps whose element is actually on the page. Resolved at start time,
    // not at module load, because the screens render their data asynchronously.
    const steps = stepsFor(surface)
      .filter((s) => document.querySelector(`[data-tour="${s.target}"]`))
      .map((s) => ({
        element: `[data-tour="${s.target}"]`,
        popover: { title: s.title, description: s.body },
      }));
    if (steps.length === 0) return;

    instance.current?.destroy();
    const d = driver({
      steps,
      showProgress: true,
      allowClose: true,
      smoothScroll: true,
      overlayOpacity: 0.62,
      stagePadding: 6,
      stageRadius: 12,
      popoverClass: 'ccn-tour',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      // Highlighting a control must not make it usable through the overlay —
      // a stray click during the tour would fire a real action.
      disableActiveInteraction: true,
      onDestroyed: () => {
        markSeen(surface);
      },
    });
    instance.current = d;
    d.drive();
  }, [surface]);

  // Wait for the screen to have something to point at before auto-starting.
  // Polls briefly rather than observing, because the elements arrive with a
  // fetch and the cost of a few frames of polling is nil.
  React.useEffect(() => {
    setCanRun(false);
    if (!surface) return;
    let cancelled = false;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      const present = stepsFor(surface).some((s) =>
        document.querySelector(`[data-tour="${s.target}"]`),
      );
      if (present && !cancelled) {
        window.clearInterval(id);
        setCanRun(true);
        if (!seen(surface)) start();
      } else if (tries > 40) {
        // ~8s. The screen is empty or still loading; leave the launcher hidden
        // rather than opening a tour with nothing in it.
        window.clearInterval(id);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      instance.current?.destroy();
      instance.current = null;
    };
  }, [surface, start]);

  // Lets a nav item elsewhere replay the tour without importing this component:
  //   window.dispatchEvent(new CustomEvent('ccn:tour'))
  React.useEffect(() => {
    const handler = () => start();
    window.addEventListener('ccn:tour', handler);
    return () => window.removeEventListener('ccn:tour', handler);
  }, [start]);

  if (!surface || !canRun) return null;

  return (
    <button
      type="button"
      onClick={start}
      data-tour-launcher
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-solid border-input bg-card px-4 py-2.5 text-[13.5px] font-semibold text-foreground no-underline shadow-lg transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className="grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
      >
        ?
      </span>
      Take the tour
    </button>
  );
}
