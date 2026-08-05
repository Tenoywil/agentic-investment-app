'use client';

import { ThemeProvider } from '@ccn/ui';
import type { ReactNode } from 'react';

/** Client boundary that provides theme/appearance context to the whole tree. */
export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
