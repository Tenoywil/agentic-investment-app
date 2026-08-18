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
  return (
    <>
      <aside
        aria-label="Demo status"
        className="sticky top-0 z-[100] border-b border-solid border-[#2c6f68] bg-primary px-4 py-2 text-center text-[12px] font-bold uppercase tracking-[0.7px] text-white shadow-sm"
      >
        Interactive demo · sample data only · no real accounts or transactions
      </aside>
      {children}
    </>
  );
}
