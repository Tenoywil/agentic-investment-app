'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { Button } from '@/app/_components/ui/button';
import { DEMO_ENABLED } from '@/lib/config';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type * as React from 'react';

/**
 * The marketing shell: one nav and one footer shared by the landing page and
 * every informational sub-page (how it works, help, privacy, terms).
 *
 * It exists because the landing page was carrying the whole pitch — mission,
 * feature grid, pipeline, fee policy — on one screen. That content now lives on
 * sub-pages, and the shell is what keeps them all recognisably one site: same
 * nav, same footer, same container rhythm. Navigation is identical on every
 * page (consistency: moving the nav is what makes people feel lost).
 */

export const MARKETING_CONTAINER =
  'mx-auto max-w-[1200px] px-10 max-[760px]:px-[22px] max-[440px]:px-[18px]';

export function MarketingNav() {
  const router = useRouter();
  return (
    /* Sticky on every width: the nav carries the two actions a visitor came
       for (Sign in, See a demo), and on a phone scrolling away from them means
       scrolling back up to act. Translucent over the page with a blur, padded
       past the iPhone's status area (safe-area inset — non-zero because
       layout.tsx declares viewport-fit=cover). */
    <div className="sticky top-0 z-40 border-x-0 border-b border-t-0 border-solid border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div
        className={`flex items-center justify-between gap-5 py-[14px] max-[760px]:py-3 ${MARKETING_CONTAINER}`}
      >
        <Link href="/" className="flex items-center gap-[11px] text-foreground no-underline">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-gradient-to-br from-primary to-navy-active font-display text-[19px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
            C
          </span>
          <span className="font-display text-lg font-bold tracking-tight max-[440px]:hidden">
            Caribbean Capital
          </span>
        </Link>
        <div className="flex items-center gap-[26px] text-[15px] font-medium text-dim max-[760px]:hidden">
          <Link href="/how-it-works" className="text-inherit no-underline hover:text-foreground">
            How it works
          </Link>
          <Link href="/help" className="text-inherit no-underline hover:text-foreground">
            Help
          </Link>
          <Link href="/sign-in" className="text-inherit no-underline hover:text-foreground">
            For institutions
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button
            variant="ghost"
            onClick={() => router.push('/sign-in')}
            className="font-semibold max-[480px]:hidden"
          >
            Sign in
          </Button>
          {DEMO_ENABLED ? (
            <Button onClick={() => router.push('/demo/home')}>See a demo</Button>
          ) : (
            <Button onClick={() => router.push('/sign-in')} className="max-[480px]:hidden">
              Get started
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <div className="border-y-0 border-x-0 border-t border-solid border-border bg-card">
      <div className={`py-8 ${MARKETING_CONTAINER}`}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-gradient-to-br from-primary to-navy-active font-display text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
              C
            </span>
            <span className="font-display text-[15px] font-bold tracking-tight">
              Caribbean Capital Network
            </span>
          </div>
          <nav aria-label="Site" className="flex flex-wrap gap-x-7 gap-y-2 text-[13.5px] text-dim">
            <Link href="/how-it-works" className="text-inherit no-underline hover:text-foreground">
              How it works
            </Link>
            <Link href="/help" className="text-inherit no-underline hover:text-foreground">
              Help
            </Link>
            <Link href="/sign-in" className="text-inherit no-underline hover:text-foreground">
              For institutions
            </Link>
            <Link href="/privacy" className="text-inherit no-underline hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="text-inherit no-underline hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[13px] text-faint">
          <span>© 2026 Caribbean Capital Network</span>
          <span>Kingston · Port of Spain · Bridgetown · Toronto · London</span>
        </div>
      </div>
    </div>
  );
}

/**
 * An informational sub-page: nav, a titled article column, footer. The measure
 * is capped at ~720px because these pages are for reading, not scanning a
 * dashboard — a full-width paragraph is the classic unreadable line length.
 */
export function MarketingPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <MarketingNav />
      <main className={`pb-20 pt-8 ${MARKETING_CONTAINER}`}>
        <div className="max-w-[720px]">
          <div className="mb-3 font-mono text-xs uppercase tracking-[2px] text-teal2">
            {eyebrow}
          </div>
          <h1 className="m-0 font-display text-[38px] font-bold leading-[1.08] tracking-[-.8px] max-[760px]:text-[30px]">
            {title}
          </h1>
          {lead ? <p className="mt-4 text-[17px] leading-[1.65] text-dim">{lead}</p> : null}
          <div className="mt-10">{children}</div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

/** One titled block on an informational page. */
export function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="m-0 mb-3 font-display text-[22px] font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-[15.5px] leading-[1.65] text-dim">{children}</div>
    </section>
  );
}
