'use client';

import { type Driver, driver } from 'driver.js';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { type TourSurface, stepsFor } from './steps';
import 'driver.js/dist/driver.css';

/**
 * The guided tour, auto-started once per page.
 *
 * Mounted once from the root layout and driven by the pathname rather than by
 * session state, so it adds no request and holds no identity — it only decides
 * which of two step lists to use, and the surface guards have already ensured
 * the viewer is on routes they are entitled to.
 *
 * Behaviour that matters on stage:
 * - It never blocks. A step whose element is absent is dropped, so a brand-new
 *   empty account gets a shorter tour rather than a popover pointing at nothing.
 * - It waits for the screen to settle before auto-starting. That wait used to be
 *   "any one target is on the page", which is satisfied the instant the shell
 *   renders, because the navigation carries a target and the navigation is drawn
 *   before the session has even resolved. The consequence was not a cosmetic
 *   one: the tour opened over the loading skeleton, dropped the five steps whose
 *   elements had not arrived, showed the single nav step, and then marked itself
 *   seen — so the six-step tour never ran again on that browser. On a phone it
 *   happened every time, because the phone's top bar is the one presentation of
 *   the navigation that is always visible. Waiting for the screen to stop
 *   declaring itself busy and for the target count to stop growing is what makes
 *   the auto-started tour the whole tour.
 * - It runs once per page per browser, and the account menu replays it on
 *   demand, because it will be run more than once in front of an audience.
 *
 * It renders no launcher of its own. It used to: a pill fixed to the bottom-right
 * corner, which is also where the Ask CCN button is fixed — the two occupied
 * very nearly the same rectangle, and the tour sat on top of the button it was
 * covering. The replay now lives in the account menu, and this component
 * publishes whether there is anything to replay so that menu item is never a
 * control that does nothing.
 */

const DISMISS_KEY = (surface: TourSurface, pathname: string) =>
  `ccn.tour.${surface}.${encodeURIComponent(pathname)}`;

/**
 * Whether a tour is available on the current screen, as an external store.
 *
 * The menu item and the tour live in different subtrees, so this crosses
 * between them without threading a provider through the shell. `useSyncExternal-
 * Store` rather than an event listener so a menu opened after the tour became
 * available still reads the current value instead of waiting for the next
 * change.
 */
let available = false;
const listeners = new Set<() => void>();

function publishAvailable(next: boolean): void {
  if (next === available) return;
  available = next;
  for (const l of listeners) l();
}

export function useTourAvailable(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => available,
    () => false, // server render: nothing is on the page yet
  );
}

/** Routes that belong to each dashboard. Onboarding is excluded deliberately —
 *  it is already a step-by-step wizard and a tour on top of it is noise. */
function surfaceForPath(pathname: string): TourSurface | null {
  if (pathname === '/demo/institutions' || pathname.startsWith('/demo/institutions/')) {
    return 'demo-institution';
  }
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return 'demo-customer';
  if (pathname.startsWith('/institutions')) return 'institution';
  if (
    ['/home', '/portfolio', '/opportunities', '/orders', '/agent', '/planning', '/gateway'].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  ) {
    return 'customer';
  }
  return null;
}

/**
 * The first target on screen, or null.
 *
 * `getClientRects()` is the check rather than a CSS lookup because it answers
 * the question that matters — does this occupy space the viewer can see —
 * whether the element is hidden by `display: none`, by an empty ancestor, or by
 * never having been laid out.
 */
function visibleTarget(target: string): Element | null {
  for (const el of document.querySelectorAll(`[data-tour="${target}"]`)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/**
 * Whether anything on the page is still declaring itself unresolved.
 *
 * `aria-busy` is already the honest answer to this question — the skeletons set
 * it for screen readers, so reading it here costs nothing and adds no second
 * source of truth to keep in step. It also means a screen that grows its own
 * loading state later is covered without touching this file.
 */
function screenIsBusy(): boolean {
  return document.querySelector('[aria-busy="true"]') !== null;
}

/** How many of a surface's steps currently have an element to point at. */
function visibleTargetCount(surface: TourSurface, pathname: string): number {
  return stepsFor(surface, pathname).filter((s) => visibleTarget(s.target) !== null).length;
}

function seen(surface: TourSurface, pathname: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY(surface, pathname)) === 'done';
  } catch {
    // Private-mode or blocked storage: treat as seen rather than reopening the
    // tour on every navigation.
    return true;
  }
}

function markSeen(surface: TourSurface, pathname: string): void {
  try {
    localStorage.setItem(DISMISS_KEY(surface, pathname), 'done');
  } catch {
    /* nothing to do — the tour simply is not remembered */
  }
}

export function Tour() {
  const pathname = usePathname();
  const surface = surfaceForPath(pathname ?? '');
  const instance = React.useRef<Driver | null>(null);
  // localStorage records completed/closed tours across visits. This in-memory
  // guard also prevents a second auto-start on the same mounted page before
  // driver.js has fired onDestroyed and persisted that record.
  const autoStarted = React.useRef(new Set<string>());

  const start = React.useCallback(() => {
    if (!surface) return;
    // Only steps whose element is actually on the page. Resolved at start time,
    // not at module load, because the screens render their data asynchronously.
    const steps = stepsFor(surface, pathname ?? '')
      .map((s) => ({ el: visibleTarget(s.target), step: s }))
      .filter((x): x is { el: Element; step: (typeof x)['step'] } => x.el !== null)
      .map(({ el, step }) => ({
        // The resolved element, not the selector. Some targets now exist twice
        // — the desktop rail and the phone drawer are two presentations of one
        // navigation, and both are in the DOM at every width — so a selector
        // string would hand driver.js whichever came first in document order,
        // which on a phone is the hidden one. It would then dim the screen and
        // highlight nothing.
        element: el,
        popover: { title: step.title, description: step.body },
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
        markSeen(surface, pathname ?? '');
      },
    });
    instance.current = d;
    d.drive();
  }, [pathname, surface]);

  // Wait for the screen to settle before auto-starting. Polls rather than
  // observes, because the targets arrive with a fetch and the cost of a few
  // frames of polling is nil.
  React.useEffect(() => {
    publishAvailable(false);
    if (!surface) return;
    let tries = 0;
    let previous = -1;
    const id = window.setInterval(() => {
      tries++;
      const count = visibleTargetCount(surface, pathname ?? '');
      const busy = screenIsBusy();

      // The replay item may appear as soon as there is a real screen behind it.
      // Replay is a deliberate act, so a tour that is merely shorter than it
      // could be is an acceptable thing to offer; auto-starting one is not,
      // because auto-starting also spends the once-per-browser first run.
      publishAvailable(count > 0 && !busy);

      // Settled: nothing is loading, and the last tick added no new targets.
      // Two conditions rather than one because they fail differently — a screen
      // can stop being busy while a second fetch is still populating a card, and
      // a count can hold steady for a tick while the skeleton is still up.
      const settled = count > 0 && !busy && count === previous;
      previous = count;

      if (settled) {
        window.clearInterval(id);
        const key = DISMISS_KEY(surface, pathname ?? '');
        const isPreview = surface === 'demo-customer' || surface === 'demo-institution';
        if (!isPreview && !seen(surface, pathname ?? '') && !autoStarted.current.has(key)) {
          autoStarted.current.add(key);
          start();
        }
        return;
      }
      if (tries > 40) {
        // ~8s. Something on this screen is not going to resolve. Do not spend
        // the first run on a partial tour — leave it for the replay item, which
        // is published above if there is anything worth replaying.
        window.clearInterval(id);
      }
    }, 200);
    return () => {
      window.clearInterval(id);
      publishAvailable(false);
      instance.current?.destroy();
      instance.current = null;
    };
  }, [pathname, surface, start]);

  // Lets a nav item elsewhere replay the tour without importing this component:
  //   window.dispatchEvent(new CustomEvent('ccn:tour'))
  React.useEffect(() => {
    const handler = () => start();
    window.addEventListener('ccn:tour', handler);
    return () => window.removeEventListener('ccn:tour', handler);
  }, [start]);

  // Behaviour only: it drives the tour and publishes whether one is available.
  // The replay control itself lives in the account menu (AccountMenu.tsx).
  return null;
}
