'use client';

import { MeApiError, getMe, landingPathFor } from '@/lib/me-api';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The single post-sign-in redirect authority.
 *
 * Google's callback lands here rather than on a hardcoded `/onboarding`, so the
 * decision of where a user belongs — console, dashboard, or the rest of
 * onboarding — is made once, from `/api/me`, instead of being guessed by each
 * entry point.
 */
export default function AfterSignInPage() {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Ask who we are, and keep asking for a few seconds.
     *
     * One attempt was not enough. This runs at the worst possible moment: the
     * instant after the OAuth redirect, which on a cold API — a free-plan
     * instance that has been idle, reached over a phone network — is exactly
     * when the first request is slowest. A single failure here is permanent and
     * shows the user a dead end, with the session cookie sitting in the browser
     * perfectly valid.
     *
     * A 401 is not retried: that means the cookie did not arrive, which more
     * time will not fix.
     */
    const attempt = async (n: number): Promise<void> => {
      try {
        const me = await getMe();
        if (!cancelled) router.replace(landingPathFor(me));
      } catch (err) {
        if (cancelled) return;
        const status = err instanceof MeApiError ? err.status : 0;
        const worthRetrying = status !== 401 && n < 4;
        if (worthRetrying) {
          setTimeout(() => void attempt(n + 1), 400 * 2 ** n);
          return;
        }
        // Say which failure it was. "We couldn't finish signing you in" with no
        // detail is what this page said before, and it made a report of
        // "sign-in doesn't work" impossible to act on.
        setFailed(
          status === 401
            ? "Your browser didn't keep the sign-in cookie."
            : status > 0
              ? `The server answered ${status}.`
              : "We couldn't reach the server.",
        );
        console.error('after-sign-in: /api/me failed', err);
      }
    };
    void attempt(0);

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>
        <div className="mb-4 flex items-center justify-center gap-2.5">
          <span
            className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-primary font-display text-[17px] font-bold text-primary-foreground"
            aria-hidden
          >
            C
          </span>
          <span className="font-display text-base font-bold text-foreground">
            Caribbean Capital
          </span>
        </div>
        {failed ? (
          <>
            <p className="text-[15px] text-dim">We couldn't finish signing you in.</p>
            <p className="mt-1 text-[13.5px] text-faint">{failed}</p>
            <a
              href="/sign-in"
              className="mt-3 inline-block font-sans text-[15px] font-bold text-primary dark:text-teal2"
            >
              Try again
            </a>
          </>
        ) : (
          <p className="text-[15px] text-dim">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
