import { DEMO_ENABLED } from '@/lib/config';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * The demo's front door. When the deployment disables the demo
 * (NEXT_PUBLIC_DEMO_ENABLED=false), hiding the buttons is not enough — the
 * routes themselves must go, or the demo is one shared URL away from being
 * visible anyway. Every /demo/* page renders through here, so one check
 * covers the whole track.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  if (!DEMO_ENABLED) notFound();
  return children;
}
