'use client';

import { RequireSurface, SessionProvider } from '@/app/_lib/session';
import type * as React from 'react';

/** The console's half of the surface guard — see (customer)/layout.tsx. */
export default function InstitutionLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RequireSurface surface="institution">{children}</RequireSurface>
    </SessionProvider>
  );
}
