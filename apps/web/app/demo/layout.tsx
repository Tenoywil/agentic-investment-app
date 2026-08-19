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
        aria-label="Interactive demo with sample data only, no real accounts or transactions"
        className="demo-status sticky top-0 z-[100] border-b border-solid border-[#2c6f68] bg-primary px-3 py-1 text-center text-[10px] font-bold uppercase tracking-[0.55px] text-white shadow-sm"
      >
        <span className="demo-status__full">
          Interactive demo · sample data only · no real accounts or transactions
        </span>
        <span className="demo-status__mobile">Demo · sample data · no real transactions</span>
      </aside>
      {children}
    </>
  );
}
