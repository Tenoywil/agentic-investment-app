'use client';

import { ThemeToggle } from '@/app/_components/ThemeToggle';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  CircleAlert,
  LineChart,
  type LucideIcon,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '../lib/auth-client';

function GoogleG() {
  return (
    <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-border bg-white font-display text-sm font-bold text-[#3f7ae0]">
      G
    </span>
  );
}

const CONTAINER = 'mx-auto max-w-[1200px] px-10 max-[760px]:px-[22px] max-[440px]:px-[18px]';
const SEC_H1 =
  'font-display font-bold tracking-tight max-[760px]:text-[25px] max-[760px]:tracking-[-.4px]';

const BENEFITS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LineChart,
    title: 'One portfolio, every partner',
    body: 'See and manage holdings across eight licensed institutions in a single live view: net worth, yield and allocation, unified.',
  },
  {
    Icon: Target,
    title: 'An agent inside your limits',
    body: 'It surfaces regional opportunities, checks each against your risk band, and acts up to the limits you set. Anything larger comes to you to approve.',
  },
  {
    Icon: ShieldCheck,
    title: 'Regulated and regional',
    body: 'Every instrument is custodied and executed by an FSC-licensed partner, with KYC, suitability and source-of-funds handled for you.',
  },
];

const FEATURES: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LineChart,
    title: 'Unified portfolio',
    body: 'Every holding across every partner, valued live in your chosen currency.',
  },
  {
    Icon: TrendingUp,
    title: 'Opportunities marketplace',
    body: 'Bonds, funds, real estate and private credit from across the region, matched to your goals.',
  },
  {
    Icon: Target,
    title: 'Capital agent',
    body: 'Chat or talk to an agent that plans, screens and executes on your say-so, inside your limits.',
  },
  {
    Icon: ShieldCheck,
    title: 'Planning & protection',
    body: 'Life cover, retirement, mortgages and estate planning that work across borders.',
  },
];

const PIPE = [
  { n: '1', t: 'Research', b: 'Scans 47 instruments across the 8-partner network', flag: false },
  { n: '2', t: 'Suitability', b: 'Matches your risk band and goals', flag: false },
  { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds', flag: false },
  { n: '4', t: 'Your approval', b: 'You confirm every move above your limits', flag: true },
  { n: '5', t: 'Execute', b: 'Routed to the partner, then monitored', flag: false },
];

export default function LandingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const google = () => {
    setError(null);
    authClient.signIn
      .social({ provider: 'google', callbackURL: `${window.location.origin}/onboarding` })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not reach the sign-in service.');
      });
  };
  const demo = () => router.push('/home');

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* NAV */}
      <div
        className={`flex items-center justify-between gap-5 py-[22px] max-[760px]:px-5 max-[760px]:py-4 ${CONTAINER}`}
      >
        <div className="flex items-center gap-[11px]">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-primary font-display text-[19px] font-bold text-white">
            C
          </span>
          <span className="font-display text-lg font-bold tracking-tight">Caribbean Capital</span>
        </div>
        <div className="flex items-center gap-[30px] text-[15px] font-medium text-dim max-[760px]:hidden">
          <a href="#how-it-works" className="text-inherit no-underline">
            How it works
          </a>
          <button type="button" onClick={demo} className="text-inherit">
            Product
          </button>
          <button type="button" onClick={() => router.push('/sign-in')} className="text-inherit">
            For institutions
          </button>
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
          <Button onClick={demo}>See a demo</Button>
        </div>
      </div>

      {/* HERO */}
      <div
        className={`grid grid-cols-[1.02fr_.98fr] items-center gap-[52px] py-10 pb-[34px] max-[960px]:grid-cols-1 max-[440px]:gap-6 ${CONTAINER}`}
      >
        <div>
          <div className="mb-[22px] inline-flex items-center gap-2 rounded-[22px] border border-border bg-card px-3.5 py-[7px] text-[13px] font-semibold tracking-wide text-teal2">
            <span className="h-[7px] w-[7px] rounded-full bg-success" />
            The financial operating system of the Caribbean
          </div>
          <h1 className="m-0 font-display text-[53px] font-bold leading-[1.04] tracking-[-1.6px] max-[760px]:text-[40px] max-[760px]:tracking-[-1px] max-[440px]:text-[33px]">
            One agent for your whole Caribbean portfolio.
          </h1>
          <p className="mt-5 max-w-[520px] text-lg leading-relaxed text-dim">
            CCN unifies every licensed partner in one place. Your AI capital agent researches
            regional opportunities, screens them for suitability, clears compliance, and executes on
            your approval.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={google}
              className="gap-[11px] text-base shadow-[0_1px_2px_rgba(30,20,10,0.05)]"
            >
              <GoogleG />
              Continue with Google
            </Button>
            <Button size="lg" onClick={demo} className="text-base">
              See a live demo →
            </Button>
          </div>
          {error && (
            <p className="mt-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
              <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3.5 text-[13.5px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-[15px] w-[15px] text-success" aria-hidden />
              FSC-regulated partners
            </span>
            <span>·</span>
            <span>KYC / AML built in</span>
            <span>·</span>
            <span>Data held in-region</span>
          </div>
          <div className="mt-[13px] text-[13px] text-faint">
            One flat platform fee. Each partner's product fees are shown before you approve, with no
            hidden spreads from CCN.
          </div>
        </div>

        {/* Hero aside card */}
        <Card className="p-4 shadow-[0_24px_60px_rgba(40,34,22,0.12)]">
          <div className="rounded-xl bg-primary px-[22px] py-5 text-[#eafaf5]">
            <div className="text-xs font-semibold uppercase tracking-[1px] text-[#eafaf5]/[.66]">
              Total net worth · 4 partners
            </div>
            <div className="mt-1.5 font-display text-[40px] font-bold leading-none tracking-[-1px]">
              US$31,350
            </div>
            <div className="mt-2 flex items-center gap-2.5 text-[13.5px]">
              <span className="rounded-[7px] bg-white/10 px-[9px] py-[3px] font-mono font-bold text-[#9fe6c6]">
                ↑ 6.8%
              </span>
              <span className="text-[#eafaf5]/80">blended yield 6.2%</span>
            </div>
          </div>
          <div className="mt-3.5 flex items-start gap-2.5 rounded-[11px] border border-border bg-[#fbfaf6] dark:bg-white/[0.02] px-3.5 py-[13px]">
            <span className="mt-[5px] h-[9px] w-[9px] flex-none rounded-full bg-success" />
            <div className="flex-1">
              <div className="text-sm font-semibold leading-snug text-[#2c2925] dark:text-foreground">
                Agent swept US$400 into your money-market fund
              </div>
              <div className="mt-0.5 text-[12.5px] text-faint">
                Inside your US$500 limit · 2 days ago
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-3 rounded-[11px] border border-[#e7c3ab] bg-[#f9ede2] dark:border-[#5a3f2a] dark:bg-[#2e2118] px-3.5 py-[13px]">
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[.4px] text-[#b4531f]">
                Needs your approval
              </div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">
                Reinvest US$412 GOJ coupon
              </div>
            </div>
            <span className="rounded-[9px] bg-primary px-3.5 py-2 text-[13px] font-bold text-white">
              Approve
            </span>
          </div>
        </Card>
      </div>

      {/* PARTNER STRIP */}
      <div className="border-y border-border bg-card">
        <div className={`flex flex-wrap items-center gap-7 py-5 ${CONTAINER}`}>
          <span className="text-[13px] font-semibold uppercase tracking-wide text-faint">
            Held at licensed partners
          </span>
          <div className="flex flex-wrap gap-[26px] font-mono text-[15px] font-semibold text-dim">
            {['NCB', 'SAGICOR', 'JMMB', 'PROVEN', 'BARITA', 'REPUBLIC', 'SYGNUS'].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* MISSION */}
      <div className={`pb-2 pt-[58px] ${CONTAINER}`}>
        <div className="grid grid-cols-2 items-start gap-[52px] max-[960px]:grid-cols-1 max-[960px]:gap-[18px]">
          <div>
            <div className="mb-3.5 font-mono text-xs uppercase tracking-[2px] text-teal2">
              Why CCN
            </div>
            <div className={`text-[33px] leading-[1.14] ${SEC_H1}`}>
              Caribbean wealth is scattered across a dozen institutions and borders.
            </div>
          </div>
          <p className="m-0 pt-1.5 text-[17px] leading-[1.62] text-dim">
            If you are building a life between the region and the diaspora, your money lives in
            fragments: a bond at NCB, a fund at Sagicor, cash at JMMB, a pension you have
            half-forgotten. CCN brings all of it into one place and gives you an agent that
            researches, screens and acts on it, so your capital is always working and always under
            your control.
          </p>
        </div>
      </div>

      {/* BENEFITS */}
      <div className={`pb-1.5 pt-[34px] ${CONTAINER}`}>
        <div className="grid grid-cols-3 gap-4 max-[960px]:grid-cols-2 max-[760px]:grid-cols-1">
          {BENEFITS.map((b) => (
            <Card key={b.title} className="p-[22px]">
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-[11px] bg-mint">
                <b.Icon className="h-[22px] w-[22px] text-teal2" aria-hidden />
              </span>
              <div className="mb-1.5 font-display text-lg font-bold">{b.title}</div>
              <div className="text-[14.5px] leading-relaxed text-dim">{b.body}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* WHAT'S INSIDE */}
      <div className={`pt-[52px] ${CONTAINER}`}>
        <div className={`mb-1.5 text-[28px] ${SEC_H1}`}>
          Everything to grow and protect wealth in the region
        </div>
        <div className="mb-[22px] text-base text-dim">
          Four surfaces, one account. Tap any to open it in the live demo.
        </div>
        <div className="grid grid-cols-2 gap-4 max-[960px]:grid-cols-1">
          {FEATURES.map((f) => (
            <button
              key={f.title}
              type="button"
              onClick={demo}
              className="flex gap-4 rounded-[14px] border border-border bg-card px-[22px] py-[21px] text-left"
            >
              <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[11px] bg-mint">
                <f.Icon className="h-[22px] w-[22px] text-teal2" aria-hidden />
              </span>
              <div>
                <div className="mb-1 font-display text-[17px] font-bold">{f.title}</div>
                <div className="text-sm leading-normal text-dim">{f.body}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div id="how-it-works" className={`scroll-mt-5 pb-[62px] pt-[54px] ${CONTAINER}`}>
        <div className={`mb-1.5 text-[30px] ${SEC_H1}`}>
          Your agent does the work. You keep control.
        </div>
        <div className="mb-[26px] text-base text-dim">
          Every action is researched, screened and checked, then brought to you.
        </div>
        <div className="grid grid-cols-5 gap-3.5 max-[960px]:grid-cols-3 max-[620px]:grid-cols-2">
          {PIPE.map((s) => (
            <div
              key={s.n}
              className={
                s.flag
                  ? 'rounded-[13px] border border-[#e7c3ab] bg-[#f9ede2] dark:border-[#5a3f2a] dark:bg-[#2e2118] p-[18px]'
                  : 'rounded-[13px] border border-border bg-card p-[18px]'
              }
            >
              <div
                className={
                  s.flag
                    ? 'mb-3 grid h-[30px] w-[30px] place-items-center rounded-lg bg-[#f0d3bd] dark:bg-[#4a3320] font-mono text-[15px] font-bold text-[#b4531f] dark:text-[#e79b6f]'
                    : 'mb-3 grid h-[30px] w-[30px] place-items-center rounded-lg bg-mint font-mono text-[15px] font-bold text-teal2'
                }
              >
                {s.n}
              </div>
              <div className="mb-1.5 text-base font-bold">{s.t}</div>
              <div
                className={
                  s.flag
                    ? 'text-sm leading-snug text-[#8a5a3e] dark:text-[#c99a76]'
                    : 'text-sm leading-snug text-faint'
                }
              >
                {s.b}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-[34px] flex flex-wrap gap-3">
          <Button size="lg" onClick={google} className="text-base">
            Get started with Google
          </Button>
          <Button variant="outline" size="lg" onClick={demo} className="text-base">
            See a live demo →
          </Button>
        </div>
      </div>

      {/* FOOTER */}
      <div className="border-t border-border bg-card">
        <div
          className={`flex flex-wrap items-center justify-between gap-3 py-[22px] text-[13.5px] text-faint ${CONTAINER}`}
        >
          <span>© 2026 Caribbean Capital Network</span>
          <span>Kingston · Port of Spain · Bridgetown · Toronto · London</span>
        </div>
      </div>
    </div>
  );
}
