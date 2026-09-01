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
      {children}
      <output className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/20 bg-[#173f3a]/95 px-3 py-1 text-[11px] font-semibold text-white shadow-lg max-md:bottom-20">
        Preview environment · Actions shown here do not send money or open accounts
      </output>
    </>
  );
}
