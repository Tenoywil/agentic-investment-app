'use client';

import { PartnerMark } from '@/app/_components/PartnerMark';
import { MARKETING_CONTAINER, MarketingFooter, MarketingNav } from '@/app/_components/marketing';
import { Button } from '@/app/_components/ui/button';
import { useGoogleSignIn } from '@/app/_lib/google-sign-in';
import { DEMO_ENABLED } from '@/lib/config';
import { getMe, landingPathFor } from '@/lib/me-api';
import {
  type PublicPartnerMark,
  getPublicPartnerMarks,
  publicPartnerLogoUrl,
} from '@/lib/public-api';
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
import { useEffect, useState } from 'react';

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

/**
 * The institutions on the network, by their full names — not ticker shorthand.
 * This curated list is what the strip always shows. The public partner-marks
 * endpoint only ENRICHES it: when the live record for a code carries an
 * uploaded logo or brand colors, the mark wears them. It never replaces the
 * list or the names — the deployed database may hold fewer firms or stale
 * spellings (it briefly held exactly one), and a marketing strip that
 * collapses to whatever a half-seeded table returns is worse than the curated
 * truth. Names come from the approved public network roster; live data only
 * enriches the presentation.
 */
const NETWORK_PARTNERS: { code: string; name: string; color: string; tint: string }[] = [
  { code: 'NCB', name: 'NCB Capital Markets', color: '#1a4aa0', tint: '#e7edf8' },
  { code: 'SAG', name: 'Sagicor Investments', color: '#1f7a44', tint: '#e6f2ea' },
  { code: 'JMMB', name: 'JMMB Group', color: '#c4362b', tint: '#fae8e6' },
  { code: 'PRV', name: 'PROVEN Wealth', color: '#9a6a1e', tint: '#f6efe0' },
  { code: 'BAR', name: 'Barita Investments', color: '#6b4a9e', tint: '#f0eaf8' },
  { code: 'REP', name: 'Republic Bank', color: '#1a6aa0', tint: '#e7f0f8' },
  { code: 'SYG', name: 'Sygnus Capital', color: '#8a5a2e', tint: '#f6eee2' },
  { code: 'BMC', name: 'Blue Mahoe Capital', color: '#275b78', tint: '#e7f0f4' },
  { code: 'RNV', name: 'Renovare Development', color: '#7a5b34', tint: '#f3eee5' },
];

const PILLARS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LineChart,
    title: 'One portfolio',
    body: 'Every holding at every licensed institution you connect, in one view and one currency.',
  },
  {
    Icon: Target,
    title: 'An agent with limits',
    body: 'It researches and screens the region for you, and it can never move money without your yes.',
  },
  {
    Icon: ShieldCheck,
    title: 'Licensed execution',
    body: 'The licensed executing firm accepts, executes, custodies and settles. CCN never holds your money.',
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { start: google, pending, slow, error } = useGoogleSignIn();
  const demo = () => router.push('/demo/planning');

  // The live records, for enrichment only (real uploaded logos, brand
  // colors). Keyed by partner code; a fetch that fails just means the strip
  // keeps its own colors and monograms.
  const [liveMarks, setLiveMarks] = useState<Map<string, PublicPartnerMark> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPublicPartnerMarks()
      .then((m) => {
        if (!cancelled) setLiveMarks(new Map(m.map((mark) => [mark.code, mark])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

      {/* HERO — the one decision. Headline, one sentence, two actions. A
          radial brand wash sits behind it and the pieces rise in on load
          (still, under prefers-reduced-motion). */}
      <div className="relative overflow-hidden">
        <div aria-hidden className="landing-glow" />
        <div
          className={`relative pb-14 pt-16 text-center max-[760px]:pt-10 ${MARKETING_CONTAINER}`}
        >
          <div className="landing-rise mx-auto mb-6 inline-flex items-center gap-2 rounded-[22px] border border-solid border-teal2/25 bg-card/85 px-3.5 py-[7px] text-[13px] font-semibold tracking-wide text-teal2 shadow-[0_1px_2px_rgba(20,14,8,0.05)] backdrop-blur-sm">
            <span className="h-[7px] w-[7px] rounded-full bg-success" />
            The financial operating system of the Caribbean
          </div>
          <h1 className="landing-rise landing-rise--2 mx-auto m-0 max-w-[760px] font-display text-[56px] font-bold leading-[1.02] tracking-[-2px] max-[760px]:text-[38px] max-[760px]:tracking-[-1px] max-[440px]:text-[33px]">
            One agent for your whole Caribbean portfolio.
          </h1>
          <p className="landing-rise landing-rise--3 mx-auto mt-5 max-w-[540px] text-lg leading-relaxed text-dim">
            See everything you own across the region, and let an agent you control find what to do
            next. Licensed partners execute; you approve.
          </p>
          <div className="landing-rise landing-rise--4 mt-8 flex flex-wrap justify-center gap-3">
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
            {DEMO_ENABLED && (
              <Button variant="outline" size="lg" onClick={demo} className="text-base">
                See a live demo
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Button>
            )}
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
                Waking the server. This can take up to a minute the first time.
              </output>
            ) : null}
          </div>
          <div className="landing-rise landing-rise--4 mt-4 flex flex-wrap items-center justify-center gap-3.5 text-[13.5px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-[15px] w-[15px] text-success" aria-hidden />
              Regulated execution by licensed firms
            </span>
            <span aria-hidden>·</span>
            <span>Institution-led KYC &amp; AML</span>
            <span aria-hidden>·</span>
            <span>You approve every move</span>
          </div>
        </div>
      </div>

      {/* PARTNER STRIP — the institutions the network is built around, by
          their full names, wearing their real uploaded logos when the public
          brand endpoint answers and their brand-color monograms until then.
          A centered wall of pills: uniform chips wrap evenly at every width,
          where a bare left-aligned row broke into ragged half-lines on a
          phone. */}
      <div className="border-x-0 border-y border-solid border-border bg-card">
        <div className={`py-6 ${MARKETING_CONTAINER}`}>
          <div className="mb-4 text-center text-[12px] font-semibold uppercase tracking-[1.6px] text-faint">
            Network institutions and issuers
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {NETWORK_PARTNERS.map((p) => {
              const live = liveMarks?.get(p.code);
              return (
                <span
                  key={p.code}
                  className="inline-flex items-center gap-2 rounded-full border border-solid border-border bg-background py-1.5 pl-1.5 pr-3.5"
                >
                  {/* The curated name always wins; the live record contributes
                      only its uploaded logo and brand colors when it has them. */}
                  <PartnerMark
                    name={p.name}
                    code={p.code}
                    id={live?.id}
                    hasLogo={live?.hasLogo}
                    logoUrl={live ? publicPartnerLogoUrl(live.id) : undefined}
                    color={live?.color ?? p.color}
                    size="sm"
                    className="h-6 w-6 rounded-full"
                  />
                  <span className="whitespace-nowrap text-[13.5px] font-semibold text-dim">
                    {p.name}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* THREE PILLARS — summaries only; the detail lives on /how-it-works. */}
      <div className={`pb-6 pt-14 ${MARKETING_CONTAINER}`}>
        <div className="grid grid-cols-3 gap-4 max-[960px]:grid-cols-1">
          {PILLARS.map((b) => (
            <div
              key={b.title}
              className="rounded-2xl border border-solid border-border bg-card p-6 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[3px] hover:border-teal2/40 hover:shadow-[0_14px_36px_rgba(23,120,110,0.14)]"
            >
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-mint to-card ring-1 ring-inset ring-teal2/20">
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
            Free to start. Applicable platform and product fees are shown before you approve.
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
            {DEMO_ENABLED && (
              <Button
                size="lg"
                variant="ghost"
                onClick={demo}
                className="text-base text-white hover:bg-white/10 hover:text-white"
              >
                See a live demo →
              </Button>
            )}
          </div>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
