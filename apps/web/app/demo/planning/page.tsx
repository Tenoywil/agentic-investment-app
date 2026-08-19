'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import Link from 'next/link';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  Recommended: 'success',
  Available: 'secondary',
  Explore: 'terra',
};

const PRODUCTS = [
  {
    code: 'LI',
    title: 'Life insurance',
    provider: 'Sagicor · Guardian Life',
    status: 'Recommended',
    desc: 'Term or whole-life cover priced for diaspora residents, protecting your family across borders.',
  },
  {
    code: 'RA',
    title: 'Retirement annuity',
    provider: 'NCB · JMMB',
    status: 'Recommended',
    desc: 'Tax-efficient retirement income, whether you retire abroad or return home to the region.',
  },
  {
    code: 'CI',
    title: 'Health & critical illness',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Cover medical costs at home and abroad, with critical-illness lump-sum protection.',
  },
  {
    code: 'ES',
    title: 'Estate planning',
    provider: 'CCN Legal Network',
    status: 'Explore',
    desc: 'Wills, trusts and cross-border succession so wealth transfers smoothly to the next generation.',
  },
  {
    code: 'MG',
    title: 'Diaspora mortgage',
    provider: 'NCB · Republic Bank',
    status: 'Available',
    desc: 'Finance property in the region with income earned abroad fully recognized.',
  },
  {
    code: 'ED',
    title: 'Education savings',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Ring-fenced, goal-linked savings that grow toward tuition with automated top-ups.',
  },
];

const GOALS = [
  {
    name: 'University fund',
    from: 'NCB · Sagicor',
    pct: 82,
    of: 'US$41,000 of US$50,000',
    eta: 'On track · mid-2028',
    color: '#17786e',
    etaClass: 'text-teal2',
  },
  {
    name: 'Retirement',
    from: 'Sagicor · Proven',
    pct: 24,
    of: 'US$118,000 of US$500,000',
    eta: 'Projected 2044',
    color: '#c56a3e',
    etaClass: 'text-terra',
  },
  {
    name: 'Emergency fund',
    from: 'JMMB',
    pct: 100,
    of: 'US$15,000 of US$15,000',
    eta: 'Complete',
    color: '#0a8f5b',
    etaClass: 'text-success',
  },
];

const STATS: { label: string; val: string; valClass: string; sub: string }[] = [
  {
    label: 'Protection gap',
    val: 'US$120,000',
    valClass: 'text-terra',
    sub: 'Recommended life cover',
  },
  {
    label: 'Est. legacy value',
    val: 'US$310,000',
    valClass: 'text-foreground',
    sub: 'Projected at retirement',
  },
];

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 26;
  const cir = 2 * Math.PI * r;
  const on = (pct / 100) * cir;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${on} ${cir - on}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill="hsl(var(--foreground))"
        fontFamily="'Hanken Grotesk', sans-serif"
      >
        {pct}%
      </text>
    </svg>
  );
}

export default function PlanningPage() {
  return (
    <AppScreen active="planning" basePath="/demo">
      <PageHead
        eyebrow="Cover, retirement, property and legacy planning across borders"
        title="Planning"
      />

      <div data-tour="customer-planning">
        <div className="g3">
          <div className="rounded-2xl bg-primary p-5 text-[#eafaf5]">
            <div className="text-[13.5px] opacity-80">Financial health</div>
            <div className="my-1 font-display text-3xl font-bold">72 / 100</div>
            <div className="text-[13.5px] font-bold text-[#9fe6c6]">Good · on track</div>
          </div>
          {STATS.map((s) => (
            <Card key={s.label} className="p-5">
              <div className="text-[13.5px] text-dim">{s.label}</div>
              <div className={cn('my-1 font-display text-3xl font-bold', s.valClass)}>{s.val}</div>
              <div className="text-[13.5px] text-faint">{s.sub}</div>
            </Card>
          ))}
        </div>

        <h2 className="mb-3.5 mt-7 font-display text-[22px] font-bold">Recommended for you</h2>
        <div className="g2">
          {PRODUCTS.map((p) => (
            <Card key={p.code} className="p-[22px]">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-mint font-mono text-xs font-bold text-teal2">
                  {p.code}
                </span>
                <div className="flex-1">
                  <div className="text-base font-bold">{p.title}</div>
                  <div className="text-[13px] text-faint">{p.provider}</div>
                </div>
                <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status}</Badge>
              </div>
              <p className="mb-4 text-sm leading-relaxed text-dim">{p.desc}</p>
              {/* A door, not a dead control: the demo agent answers planning
                questions from its script, which is the feel this preview owes. */}
              <Button variant="secondary" className="w-full" asChild>
                <Link href="/demo/agent">Explore with agent</Link>
              </Button>
            </Card>
          ))}
        </div>

        <h2 className="mb-3.5 mt-7 font-display text-[22px] font-bold">Your goals</h2>
        <div className="g3">
          {GOALS.map((g) => (
            <Card key={g.name} className="p-[22px]">
              <div className="mb-4 flex items-center gap-4">
                <Ring pct={g.pct} color={g.color} />
                <div>
                  <div className="text-base font-bold">{g.name}</div>
                  <div className="text-[13px] text-faint">{g.from}</div>
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="font-mono text-sm">{g.of}</div>
                <div className={cn('mt-1 text-[13.5px] font-bold', g.etaClass)}>{g.eta}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppScreen>
  );
}
