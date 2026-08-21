'use client';

import { InfoSection, MarketingPage } from '@/app/_components/marketing';
import { Button } from '@/app/_components/ui/button';
import { DEMO_ENABLED } from '@/lib/config';
import {
  LineChart,
  type LucideIcon,
  ScrollText,
  SearchCheck,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The explanation the landing page used to carry: the mission narrative, the
 * four surfaces, the five-step pipeline and the fee policy. Moved here so the
 * landing page can do one job (route people) and this page can do the other
 * (convince the ones who want the detail).
 */

const SURFACES: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LineChart,
    title: 'Unified portfolio',
    body: 'Every holding across every partner, in your chosen currency at published central-bank rates. Cash you hold at each firm is shown per firm, because money settled with one institution is not spendable at another.',
  },
  {
    Icon: TrendingUp,
    title: 'Opportunities marketplace',
    body: 'Bonds, funds, real estate and private credit listed by regional institutions. Every product carries the firm that executes it and the regulator that supervises them.',
  },
  {
    Icon: Target,
    title: 'Capital agent',
    body: 'Chat or talk to an agent that researches, compares, screens against your profile and limits, and prepares moves for your approval. Anything it finds while you are away waits as an approval card, never as an action already taken.',
  },
  {
    Icon: ShieldCheck,
    title: 'Planning & protection',
    body: 'Life cover, retirement, mortgages and estate planning that work across borders.',
  },
];

const PIPE = [
  {
    n: '1',
    t: 'Research',
    b: 'A research agent scans the marketplace of listed regional instruments.',
    flag: false,
  },
  {
    n: '2',
    t: 'Portfolio fit',
    b: 'A fit agent weighs the shortlist against your holdings, goals, currency exposure and concentration.',
    flag: false,
  },
  {
    n: '3',
    t: 'Suitability',
    b: 'A screening step checks each candidate against your risk band, cash floor and caps.',
    flag: false,
  },
  {
    n: '4',
    t: 'Compliance readiness',
    b: 'The agent checks recorded identity status, declarations, source-of-funds declarations and evidence, and the executing-firm relationship. The licensed firm keeps the final KYC and AML decision.',
    flag: false,
  },
  {
    n: '5',
    t: 'Your approval',
    b: 'You inspect the evidence, comparison, amount, fees and limits result. Nothing runs without your decision.',
    flag: true,
  },
  {
    n: '6',
    t: 'Licensed firm executes',
    b: 'Your approved instruction is routed to the licensed firm, which accepts or declines it, then executes, custodies and settles.',
    flag: false,
  },
];

/**
 * Why a proposal from CCN is one you can evaluate. The grounds are
 * them structural rather than promotional — who holds the money, what screens
 * the candidates, how research is graded, and what gets written down.
 */
const TRUST: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: ShieldCheck,
    title: 'Licensed partners hold everything',
    body: 'Regulated institutions execute and custody every instrument, and each product names its executing firm and that firm’s regulator. CCN never holds your money.',
  },
  {
    Icon: Target,
    title: 'Screened against your limits',
    body: 'Every recommendation is checked against your own risk band, cash floor and position caps by a deterministic engine: the same rules every time, never a mood.',
  },
  {
    Icon: SearchCheck,
    title: 'Research labels its evidence',
    body: 'The agent’s research marks what is verified and what is self-reported, and a contradiction between the two vetoes the recommendation rather than being smoothed over.',
  },
  {
    Icon: ScrollText,
    title: 'Every step is written down',
    body: 'Each recommendation writes an audit trail and shows its stage-by-stage reasoning, so you can read how it was decided, not just what was decided.',
  },
  {
    Icon: LineChart,
    title: 'Compared with where you live',
    body: 'A regional proposal is not assumed to be better. The agent compares it with a like-for-like US, Canadian or UK option across diversification, currency, liquidity and settlement, fees, tax and reporting, and investor protections, and names what still needs verification.',
  },
];

export default function HowItWorksPage() {
  const router = useRouter();
  return (
    <MarketingPage
      eyebrow="How it works"
      title="Your agent does the work. You keep control."
      lead="If you are building a life between the region and the diaspora, your money lives in fragments: a bond at NCB, a fund at Sagicor, cash at JMMB, a pension you have half-forgotten. CCN brings all of it into one place and gives you an agent that researches, compares, screens and prepares. It never executes or approves a move for you."
    >
      <InfoSection title="The six steps behind every move">
        <div className="grid grid-cols-1 gap-3">
          {PIPE.map((s) => (
            <div
              key={s.n}
              className={
                s.flag
                  ? 'flex gap-4 rounded-[13px] border border-solid border-[#e7c3ab] bg-[#f9ede2] p-[18px] dark:border-[#5a3f2a] dark:bg-[#2e2118]'
                  : 'flex gap-4 rounded-[13px] border border-solid border-border bg-card p-[18px]'
              }
            >
              <div
                className={
                  s.flag
                    ? 'grid h-[30px] w-[30px] flex-none place-items-center rounded-lg bg-[#f0d3bd] font-mono text-[15px] font-bold text-terra-ink dark:bg-[#4a3320]'
                    : 'grid h-[30px] w-[30px] flex-none place-items-center rounded-lg bg-mint font-mono text-[15px] font-bold text-teal2'
                }
              >
                {s.n}
              </div>
              <div>
                <div className="mb-0.5 text-base font-bold text-foreground">{s.t}</div>
                <div className="text-sm leading-relaxed">{s.b}</div>
              </div>
            </div>
          ))}
        </div>
      </InfoSection>

      <InfoSection title="Four surfaces, one account">
        <div className="grid grid-cols-1 gap-3">
          {SURFACES.map((f) => (
            <div
              key={f.title}
              className="flex gap-4 rounded-[13px] border border-solid border-border bg-card p-[18px]"
            >
              <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[11px] bg-mint">
                <f.Icon className="h-[22px] w-[22px] text-teal2" aria-hidden />
              </span>
              <div>
                <div className="mb-1 font-display text-[16px] font-bold text-foreground">
                  {f.title}
                </div>
                <div className="text-sm leading-relaxed">{f.body}</div>
              </div>
            </div>
          ))}
        </div>
      </InfoSection>

      <InfoSection title="How CCN prepares a proposal">
        <div className="grid grid-cols-1 gap-3">
          {TRUST.map((t) => (
            <div
              key={t.title}
              className="flex gap-4 rounded-[13px] border border-solid border-border bg-card p-[18px]"
            >
              <span className="grid h-[42px] w-[42px] flex-none place-items-center rounded-[11px] bg-mint">
                <t.Icon className="h-[22px] w-[22px] text-teal2" aria-hidden />
              </span>
              <div>
                <div className="mb-1 font-display text-[16px] font-bold text-foreground">
                  {t.title}
                </div>
                <div className="text-sm leading-relaxed">{t.body}</div>
              </div>
            </div>
          ))}
        </div>
      </InfoSection>

      <InfoSection title="The line CCN never crosses">
        <p>
          CCN holds no client money, executes nothing and never becomes custodian. Every instrument
          is custodied, executed and settled by a licensed institution. With your consent, CCN
          collects and passes declarations and documents to that firm; the firm reviews them, may
          request more, and owns the final KYC, AML and suitability decisions. CCN routes signed
          instructions and keeps the append-only audit trail.
        </p>
      </InfoSection>

      <InfoSection title="What it costs">
        <p>
          Applicable CCN and partner product fees, plus any withdrawal fee or local tax the firm
          applies, are shown before you approve. The executing firm reports the actual settlement
          price, units and fee; CCN does not invent a missing settlement figure.
        </p>
      </InfoSection>

      <div className="mt-2 flex flex-wrap gap-3">
        <Button size="lg" onClick={() => router.push('/sign-in')} className="text-base">
          Get started
        </Button>
        {DEMO_ENABLED && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => router.push('/demo/home')}
            className="text-base"
          >
            See a live demo →
          </Button>
        )}
      </div>
      <p className="mt-6 text-[13.5px] text-faint">
        More questions? The <Link href="/help">Help page</Link> answers the practical ones: how
        money gets in and out, what the agent can and cannot do, and what happens when a firm
        declines something.
      </p>
    </MarketingPage>
  );
}
