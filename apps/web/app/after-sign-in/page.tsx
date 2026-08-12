'use client';

import { getMe, landingPathFor } from '@/lib/me-api';
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) router.replace(landingPathFor(me));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
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
