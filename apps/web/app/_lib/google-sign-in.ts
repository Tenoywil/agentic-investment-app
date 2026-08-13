'use client';

import { authClient } from '@/lib/auth-client';
import * as React from 'react';

/**
 * Starting Google sign-in, and saying so on screen.
 *
 * Both entry points — the landing page and /sign-in — called
 * `signIn.social(...).catch(setError)` and nothing else. Two things were wrong
 * with that, and together they produced a button that, in the words of the
 * person tapping it, does nothing:
 *
 * 1. **The catch was unreachable.** Better Auth's client is a betterFetch
 *    wrapper: it RESOLVES with `{ data, error }` and does not throw on an HTTP
 *    failure. A 403 from CORS, a 500, a provider misconfiguration — every
 *    ordinary failure landed in neither branch, so the screen showed nothing at
 *    all and there was no way to learn what had happened.
 *
 * 2. **Success looked identical to failure.** There was no pending state. The
 *    API sleeps when idle and can take most of a minute to answer its first
 *    request, so the honest best case was also a minute of a button that
 *    appeared inert. On a phone that means tapping it repeatedly and giving up.
 *
 * Shared by both pages so the two can never drift again, and so a third entry
 * point inherits the handling rather than reinventing half of it.
 */

interface SocialResult {
  url?: string;
  error?: string;
}

/** Read whatever `signIn.social` came back with, defensively. */
export function readSocialResult(result: unknown): SocialResult {
  if (typeof result !== 'object' || result === null) return {};
  const r = result as { data?: { url?: unknown }; error?: unknown };
  if (r.error) {
    const e = r.error as { message?: unknown; statusText?: unknown; status?: unknown };
    // Status 0 is not a reply. It is the request never having left the device —
    // no connection, DNS, or a blocked origin — and quoting it as a number
    // tells the person holding the phone nothing they can act on.
    if (e.status === 0) {
      return { error: 'Could not reach the sign-in service. Check your connection and try again.' };
    }
    const message =
      (typeof e.message === 'string' && e.message) ||
      (typeof e.statusText === 'string' && e.statusText) ||
      (typeof e.status === 'number' ? `the sign-in service answered ${e.status}` : '') ||
      'the sign-in service refused the request';
    return { error: message };
  }
  return typeof r.data?.url === 'string' ? { url: r.data.url } : {};
}

export interface GoogleSignIn {
  /** Start the flow. A no-op while one is already in flight. */
  start: () => void;
  /** True from the tap until the page leaves or the attempt fails. */
  pending: boolean;
  /** Set once the wait passes the point where silence reads as breakage. */
  slow: boolean;
  error: string | null;
}

export function useGoogleSignIn(): GoogleSignIn {
  const [pending, setPending] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = React.useCallback(() => {
    if (pending) return;
    setError(null);
    setPending(true);
    setSlow(false);
    timer.current = setTimeout(() => setSlow(true), 5000);

    const stop = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const fail = (message: string) => {
      stop();
      setSlow(false);
      setPending(false);
      setError(message);
    };

    void authClient.signIn
      .social({ provider: 'google', callbackURL: `${window.location.origin}/after-sign-in` })
      .then((result: unknown) => {
        const { url, error: failed } = readSocialResult(result);
        if (failed) return fail(failed);
        if (url) {
          window.location.href = url;
          return;
        }
        // No error and no URL: the client is navigating itself. Stay pending —
        // clearing it here flicks the button back to idle in the instant before
        // the page leaves, which reads as the tap having been dropped.
        stop();
      })
      .catch((err: unknown) => {
        fail(err instanceof Error ? err.message : 'Could not reach the sign-in service.');
      });
  }, [pending]);

  return { start, pending, slow, error };
}
