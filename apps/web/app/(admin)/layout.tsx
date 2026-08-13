'use client';

import { RequireSurface, SessionProvider } from '@/app/_lib/session';
import type * as React from 'react';

/** The administration surface's half of the guard — see (customer)/layout.tsx.
 *  The real boundary is the API: /api/admin/* answers 403 to everyone whose
 *  roles do not include `admin`, and the database refuses the cross-tenant read
 *  regardless of what the browser believes. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <RequireSurface surface="admin">{children}</RequireSurface>
    </SessionProvider>
  );
}
