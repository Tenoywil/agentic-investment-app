'use client';

import { MARKETING_CONTAINER, MarketingFooter, MarketingNav } from '@/app/_components/marketing';
import { Button } from '@/app/_components/ui/button';
import { useGoogleSignIn } from '@/app/_lib/google-sign-in';
import { getMe, landingPathFor } from '@/lib/me-api';
import {
  ArrowRight,
  CircleAlert,
  LineChart,
  type LucideIcon,
  ShieldCheck,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The landing page, cut down to one job: tell a visitor what CCN is in a
 * sentence, and route them to the right door — sign up, see the demo, or (for
 * a firm) the institution entrance.
 *
 * Everything that explains rather than routes — the mission narrative, the
 * feature grid, the five-step pipeline, the fee policy — moved to
 * /how-it-works and /help. A landing page that pushes the whole pitch at a
 * first-time visitor buries the one decision they came to make (NN/g: every
 * extra unit of information competes with the relevant units). The three cards
 * that remain are summaries, and each one links to the page that explains it.
 */

function GoogleG() {
  return (
    <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-solid border-border bg-white font-display text-sm font-bold text-[#3f7ae0]">
      G
    </span>
  );
}

const PILLARS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LineChart,
    title: 'One portfolio',
    body: 'Every holding at every licensed institution you connect, in one view and one currency.',
  },
  {
    Icon: Target,
    title: 'An agent with limits',
    body: 'It researches and screens the region for you — and can never move money without your yes.',
  },
  {
    Icon: ShieldCheck,
    title: 'Regulated partners',
    body: 'Licensed firms custody and execute everything. CCN never holds your money.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { start: google, pending, slow, error } = useGoogleSignIn();
  const demo = () => router.push('/demo/home');

  // Somebody already signed in does not belong on the marketing page; a failed
  // check means "not signed in" and the page simply stays.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) router.replace(landingPathFor(me));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <MarketingNav />

      {/* HERO — the one decision. Headline, one sentence, two actions. */}
      <div className={`pb-14 pt-16 text-center max-[760px]:pt-10 ${MARKETING_CONTAINER}`}>
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-[22px] border border-solid border-border bg-card px-3.5 py-[7px] text-[13px] font-semibold tracking-wide text-teal2">
          <span className="h-[7px] w-[7px] rounded-full bg-success" />
          The financial operating system of the Caribbean
        </div>
        <h1 className="mx-auto m-0 max-w-[760px] font-display text-[56px] font-bold leading-[1.03] tracking-[-1.8px] max-[760px]:text-[38px] max-[760px]:tracking-[-1px]">
          One agent for your whole Caribbean portfolio.
        </h1>
        <p className="mx-auto mt-5 max-w-[540px] text-lg leading-relaxed text-dim">
          See everything you own across the region, and let an agent you control find what to do
          next. Licensed partners execute; you approve.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            onClick={google}
            disabled={pending}
            aria-busy={pending}
            className="gap-[11px] text-base"
          >
            <GoogleG />
            {pending ? 'Connecting to Google…' : 'Continue with Google'}
          </Button>
          <Button variant="outline" size="lg" onClick={demo} className="text-base">
            See a live demo
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
          </Button>
        </div>
        {/* Fixed height whichever state shows, so the hero does not resize
            under the button that was just pressed. */}
        <div className="min-h-[30px] pt-3">
          {error ? (
            <p className="flex items-center justify-center gap-2 text-sm text-[#a44e20] dark:text-terra">
              <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
              {error}
            </p>
          ) : slow ? (
            <output className="block text-sm text-dim">
              Waking the server — this can take up to a minute the first time.
            </output>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3.5 text-[13.5px] text-dim">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-[15px] w-[15px] text-success" aria-hidden />
            Licensed, regulated partners
          </span>
          <span aria-hidden>·</span>
          <span>KYC &amp; AML built in</span>
          <span aria-hidden>·</span>
          <span>Data held in-region</span>
        </div>
      </div>

      {/* PARTNER STRIP — the institutions the network is built around. */}
      <div className="border-x-0 border-y border-solid border-border bg-card">
        <div className={`flex flex-wrap items-center gap-7 py-5 ${MARKETING_CONTAINER}`}>
          <span className="text-[13px] font-semibold uppercase tracking-wide text-faint">
            Institutions on the network
          </span>
          <div className="flex flex-wrap gap-[26px] font-mono text-[15px] font-semibold text-dim">
            {['NCB', 'SAGICOR', 'JMMB', 'PROVEN', 'BARITA', 'REPUBLIC', 'SYGNUS'].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* THREE PILLARS — summaries only; the detail lives on /how-it-works. */}
      <div className={`pb-6 pt-14 ${MARKETING_CONTAINER}`}>
        <div className="grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {PILLARS.map((b) => (
            <div
              key={b.title}
              className="rounded-2xl border border-solid border-border bg-card p-6"
            >
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-mint">
                <b.Icon className="h-[22px] w-[22px] text-teal2" aria-hidden />
              </span>
              <div className="mb-1.5 font-display text-lg font-bold">{b.title}</div>
              <div className="text-[14.5px] leading-relaxed text-dim">{b.body}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 text-center">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1.5 text-[15px] font-bold text-teal2 no-underline underline-offset-4 hover:underline"
          >
            How it all works, step by step
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      {/* FINAL CTA — the same two actions as the hero, same emphasis. */}
      <div className={`pb-20 pt-12 ${MARKETING_CONTAINER}`}>
        <div className="rounded-2xl bg-primary px-8 py-12 text-center text-white max-[760px]:px-5">
          <h2 className="m-0 font-display text-[30px] font-bold tracking-tight max-[760px]:text-[24px]">
            Your money, working across the region.
          </h2>
          <p className="mx-auto mt-2.5 max-w-[440px] text-[15.5px] leading-relaxed text-white/80">
            Free to start. One flat platform fee when you invest — every other cost is shown before
            you approve.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              variant="secondary"
              onClick={google}
              disabled={pending}
              aria-busy={pending}
              className="text-base"
            >
              {pending ? 'Connecting to Google…' : 'Get started with Google'}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={demo}
              className="text-base text-white hover:bg-white/10 hover:text-white"
            >
              See a live demo →
            </Button>
          </div>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
