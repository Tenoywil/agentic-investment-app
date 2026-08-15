'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import { Bell, LineChart, type LucideIcon, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

const PIPE = [
  { n: '1', t: 'Research', b: 'Scans 47 instruments across 8 partners', flag: false },
  { n: '2', t: 'Suitability', b: 'Matches your balanced-income risk band', flag: false },
  { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds checks', flag: false },
  { n: '4', t: 'Your approval', b: 'You confirm every move above your limits', flag: true },
  { n: '5', t: 'Execute', b: 'Routed to the licensed partner, then monitored', flag: false },
];

const ACTED = [
  {
    dot: '#0a8f5b',
    t: 'Swept US$400 of idle cash into the NCB Money Market Fund',
    s: 'Inside your US$500 auto-invest limit · 2 days ago',
  },
  {
    dot: '#0a8f5b',
    t: 'Reinvested a US$388 GOJ coupon after you approved it',
    s: 'Human-in-the-loop · Last week',
  },
  {
    dot: '#c56a3e',
    t: 'Paused a JMD transfer. FX spread was 0.4% above your rule',
    s: 'Held for your review · Last week',
  },
];

const APPROVALS = [
  { tag: 'Reinvest', tagColor: '#124e48', title: 'Put your GOJ coupon to work', when: 'Today' },
  { tag: 'Idle cash', tagColor: '#c56a3e', title: 'US$2,150 earning nothing', when: '2d ago' },
];

const HELD = [
  {
    code: 'NCB',
    name: 'National Commercial Bank',
    sub: 'GOJ Bond 2029 · Chequing',
    amt: 'US$13,400',
    tint: '#e7edf8',
    color: '#1a4aa0',
  },
  {
    code: 'SAG',
    name: 'Sagicor Investments',
    sub: 'Sigma Global Fund',
    amt: 'US$8,200',
    tint: '#e6f2ea',
    color: '#1f7a44',
  },
  {
    code: 'PRV',
    name: 'Proven Wealth',
    sub: 'USD Income Fund',
    amt: 'US$5,600',
    tint: '#f6efe0',
    color: '#9a6a1e',
  },
  {
    code: 'JMMB',
    name: 'JMMB Group',
    sub: 'Money Market · Savings',
    amt: 'US$4,150',
    tint: '#fae8e6',
    color: '#c4362b',
  },
];

const ALLOC = [
  { label: 'Fixed income', pct: 46, color: '#17786e' },
  { label: 'Real estate', pct: 18, color: '#f0b98d' },
  { label: 'Money market', pct: 15, color: '#7fb5ad' },
  { label: 'Equities', pct: 14, color: '#c56a3e' },
  { label: 'Cash', pct: 7, color: '#e6dccb' },
];

const STATS: {
  label: string;
  Icon: LucideIcon;
  val: string;
  valClass: string;
  sub: string;
  subClass: string;
}[] = [
  {
    label: 'Tracked across partners',
    Icon: LineChart,
    val: 'US$31,350',
    valClass: 'text-foreground',
    sub: '47 holdings · 4 institutions · live',
    subClass: 'text-faint',
  },
  {
    label: 'Blended yield',
    Icon: TrendingUp,
    val: '6.2%',
    valClass: 'text-success',
    sub: '≈ US$1,940 income / year',
    subClass: 'text-faint',
  },
  {
    label: 'Matched to your goals',
    Icon: Sparkles,
    val: '6',
    valClass: 'text-foreground',
    sub: '2 ready for your approval →',
    subClass: 'font-bold text-terra',
  },
];

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

function Donut() {
  const r = 52;
  const cir = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
      <g transform="rotate(-90 66 66)">
        {ALLOC.map((a) => {
          const len = (a.pct / 100) * cir;
          const seg = (
            <circle
              key={a.label}
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth="20"
              strokeDasharray={`${len} ${cir - len}`}
              strokeDashoffset={-acc}
            />
          );
          acc += len;
          return seg;
        })}
      </g>
    </svg>
  );
}

export default function HomePage() {
  const [cur, setCur] = useState<'USD' | 'JMD' | 'TTD' | 'GYD' | 'BBD' | 'XCD' | 'BSD'>('USD');

  return (
    <AppScreen active="home" basePath="/demo">
      <PageHead
        eyebrow="Saturday, July 18"
        title="Good afternoon, Marcus"
        right={
          <div className="flex items-center gap-3">
            {/* A dropdown, matching the live portfolio's switcher — the demo
                and real flows keep the same controls. */}
            <label className="flex items-center">
              <span className="sr-only">Display currency</span>
              <select
                value={cur}
                onChange={(e) => setCur(e.target.value as typeof cur)}
                className="h-[38px] rounded-[10px] border border-solid border-border bg-card px-2.5 font-mono text-[13px] font-semibold text-foreground"
              >
                {(['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'] as const).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="icon"
              aria-label="Notifications"
              className="h-[42px] w-[42px] rounded-full text-dim [&_svg]:size-[18px]"
            >
              <Bell />
            </Button>
            <Avatar className="h-[42px] w-[42px]">
              <AvatarFallback>MB</AvatarFallback>
            </Avatar>
          </div>
        }
      />

      {/* Hero card */}
      <div className="g-hero rounded-[20px] bg-primary p-7 text-[#eafaf5]">
        <div>
          <div className={cn(UPPR, 'text-[#eafaf5]/[.66]')}>
            Total net worth · 4 licensed partners
          </div>
          <div className="my-[10px] mb-3 font-display text-[52px] font-bold leading-none tracking-[-1.5px]">
            US$31,350
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-[#eafaf5]/[.82]">
            <span className="rounded-[7px] bg-white/[.12] px-[9px] py-[3px] font-mono font-bold text-[#9fe6c6]">
              ↑ 6.8%
            </span>
            +US$1,994 all-time · 47 holdings · yield 6.2%
          </div>
          <svg
            width="100%"
            height="64"
            viewBox="0 0 420 64"
            preserveAspectRatio="none"
            className="mt-4"
            aria-hidden="true"
          >
            <polyline
              points="0,52 40,48 80,50 120,40 160,44 200,32 240,36 280,24 320,26 360,16 420,10"
              fill="none"
              stroke="rgba(159,230,198,.75)"
              strokeWidth="2.5"
            />
          </svg>
        </div>
        <div className="border-l border-[#eafaf5]/[.16] pl-[26px]">
          <div className={cn(UPPR, 'flex items-center gap-[7px] text-[#eafaf5]/[.66]')}>
            <span className="h-[7px] w-[7px] rounded-full bg-peach" />
            Your agent · acting within your limits
          </div>
          <p className="my-3 mb-[18px] text-[17px] font-medium leading-relaxed text-white">
            This week I matched <b className="text-gold">6 opportunities</b>, swept{' '}
            <b className="text-gold">US$400</b> of idle cash inside your limit, and prepared{' '}
            <b className="text-gold">2 actions</b> for your approval.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="peach" asChild>
              <Link href="/agent">Review 2 approvals</Link>
            </Button>
            <Button
              asChild
              className="border border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/opportunities">Opportunities</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Held / Allocation — first under the hero, matching the live home:
          the person's money before the agent's commentary. The pipeline
          explainer that stood here lives on the Agent screen now. */}
      <div className="g-held mt-[18px]">
        <Card className="p-[22px]">
          <div className="mb-3.5 flex items-center justify-between">
            <b className="font-display text-lg">Held across partners</b>
            <Link href="/portfolio" className="text-sm font-bold text-teal2 no-underline">
              View portfolio →
            </Link>
          </div>
          {HELD.map((h) => (
            <div key={h.code} className="flex items-center gap-3 border-t border-border py-[11px]">
              <span
                className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                style={{ background: h.tint, color: h.color }}
              >
                {h.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold">{h.name}</div>
                <div className="text-[12.5px] text-faint">{h.sub}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-bold">{h.amt}</div>
                <div className="text-[11.5px] text-success-ink">· FSC-regulated</div>
              </div>
            </div>
          ))}
        </Card>

        <Card className="p-[22px]">
          <b className="font-display text-lg">Allocation</b>
          <div className="mb-2 text-[13px] text-faint">Blended across all 4 partners</div>
          <div className="flex items-center gap-[18px]">
            <Donut />
            <div className="flex-1">
              {ALLOC.map((a) => (
                <div key={a.label} className="mb-[7px] flex items-center gap-2 text-[13.5px]">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-[3px]"
                    style={{ background: a.color }}
                  />
                  <span className="flex-1 text-dim">{a.label}</span>
                  <b className="font-mono text-[13px]">{a.pct}%</b>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Acted / Approvals */}
      <div className="g2 mt-[18px]">
        <Card className="p-[22px]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cn(UPPR, 'text-foreground')}>Acted on your behalf</span>
            <Badge variant="secondary">within your limits</Badge>
          </div>
          {ACTED.map((a) => (
            <div key={a.t} className="mb-[15px] flex gap-2.5">
              <span
                className="mt-1.5 h-[9px] w-[9px] flex-none rounded-full"
                style={{ background: a.dot }}
              />
              <div>
                <div className="text-[14.5px] font-semibold leading-snug">{a.t}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">{a.s}</div>
              </div>
            </div>
          ))}
          <Button variant="outline" className="mt-1.5 w-full text-teal2" asChild>
            <Link href="/agent">Adjust your agent's limits</Link>
          </Button>
        </Card>

        <Card className="p-[22px]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
            <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra-ink">
              2
            </span>
          </div>
          {APPROVALS.map((a) => (
            <div
              key={a.title}
              className="mb-3 rounded-xl border border-border p-4"
              style={{ borderLeft: `3px solid ${a.tagColor}` }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className="rounded-md px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[.5px]"
                  style={{ color: a.tagColor, background: `${a.tagColor}14` }}
                >
                  {a.tag}
                </span>
                <span className="text-[12.5px] text-faint">{a.when}</span>
              </div>
              <div className="mb-3 text-[15px] font-bold">{a.title}</div>
              <Button className="w-full" asChild>
                <Link href="/agent">Review &amp; approve</Link>
              </Button>
            </div>
          ))}
        </Card>
      </div>

      {/* Stat cards */}
      <div className="g3 mt-[18px]">
        {STATS.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-dim">{s.label}</span>
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-mint text-teal2">
                <s.Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
            </div>
            <div className={cn('font-display text-3xl font-bold tracking-[-.5px]', s.valClass)}>
              {s.val}
            </div>
            <div className={cn('mt-1 text-[13.5px]', s.subClass)}>{s.sub}</div>
          </Card>
        ))}
      </div>
    </AppScreen>
  );
}
