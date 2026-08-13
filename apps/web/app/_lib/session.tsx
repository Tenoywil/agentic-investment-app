'use client';

import { type Me, MeApiError, type Surface, getMe } from '@/lib/me-api';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * The signed-in user, fetched once per surface and shared.
 *
 * Every screen previously re-derived identity for itself — or invented it. This
 * is the single source, so the greeting, the console's partner branding, the
 * KYC checks in the execute dialog and the surface guard can never disagree.
 */

type SessionState =
  | { status: 'loading'; me: null }
  | { status: 'authenticated'; me: Me }
  | { status: 'unauthenticated'; me: null };

const SessionContext = React.createContext<{
  state: SessionState;
  refresh: () => Promise<void>;
} | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({ status: 'loading', me: null });

  const load = React.useCallback(async () => {
    try {
      setState({ status: 'authenticated', me: await getMe() });
    } catch (err) {
      // A 401 is the ordinary signed-out case, not an error worth surfacing.
      // Anything else (network, 5xx) is also treated as unauthenticated: the
      // surface guard must fail closed rather than render a dashboard it
      // cannot verify the viewer is entitled to.
      if (!(err instanceof MeApiError) || err.status !== 401) {
        console.error('session lookup failed', err);
      }
      setState({ status: 'unauthenticated', me: null });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const value = React.useMemo(() => ({ state, refresh: load }), [state, load]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** The signed-in user, or null while loading / signed out. */
export function useMe(): Me | null {
  return useSession().state.me;
}

/**
 * Client-side surface guard: sends a signed-out visitor to sign-in and a
 * wrong-surface user to their own dashboard.
 *
 * This is a routing convenience, not the security boundary — the API returns
 * 403 to the wrong surface regardless of what the browser does (see
 * apps/api/src/roles.ts and apps/api/test/role-split.test.ts).
 */
export function RequireSurface({
  surface,
  children,
}: {
  surface: Surface;
  children: React.ReactNode;
}) {
  const { state } = useSession();
  const router = useRouter();

  React.useEffect(() => {
    if (state.status === 'unauthenticated') {
      router.replace('/sign-in');
      return;
    }
    if (state.status === 'authenticated' && state.me.surface !== surface) {
      router.replace(state.me.surface === 'institution' ? '/institutions' : '/home');
    }
  }, [state, surface, router]);

  if (state.status !== 'authenticated' || state.me.surface !== surface) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-2.5">
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
      </div>
    );
  }

  return <>{children}</>;
}
