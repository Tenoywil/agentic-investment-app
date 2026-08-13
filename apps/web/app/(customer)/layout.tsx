'use client';

import { RequireSurface, SessionProvider } from '@/app/_lib/session';
import type * as React from 'react';
import { CustomerShellSkeleton } from './shell-skeleton';

/**
 * Every customer screen sits behind one session fetch and one surface guard, so
 * no individual page has to remember either. A partner operator who types
 * /home is sent to their console; a signed-out visitor is sent to sign-in.
 * The real boundary is the API's 403 — this is the routing half of it.
 */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RequireSurface surface="customer" fallback={<CustomerShellSkeleton />}>
        {children}
      </RequireSurface>
    </SessionProvider>
  );
}
