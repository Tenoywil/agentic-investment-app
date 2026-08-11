'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Avatar, AvatarFallback } from '@/app/_components/ui/avatar';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import {
  type AgentMessage,
  type Approval,
  type ApprovalType,
  type Portfolio,
  PortfolioApiError,
  getAgentHistory,
  getApprovals,
  getPortfolio,
} from '@/lib/portfolio-api';
import { Bell, CircleAlert, LineChart, type LucideIcon, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// "How your agent works" is fixed illustrative UI chrome — a static explainer
// of the pipeline every action goes through, not per-user data. There's no
// backend record of "step 4 of 5" for a given action, so it stays hardcoded.
const PIPE = [
  { n: '1', t: 'Research', b: 'Scans 47 instruments across 8 partners', flag: false },
  { n: '2', t: 'Suitability', b: 'Matches your balanced-income risk band', flag: false },
  { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds checks', flag: false },
  { n: '4', t: 'Your approval', b: 'You confirm every move above your limits', flag: true },
  { n: '5', t: 'Execute', b: 'Routed to the licensed partner, then monitored', flag: false },
];

// Allocation by asset class (fixed income / equities / cash / …) isn't a field
// the portfolio API exposes — holdings only carry name/value/return, not an
// asset-class category — so this breakdown can't be computed from live data
// without inventing categories. Left as illustrative static content.
const ALLOC = [
  { label: 'Fixed income', pct: 46, color: '#17786e' },
  { label: 'Real estate', pct: 18, color: '#f0b98d' },
  { label: 'Money market', pct: 15, color: '#7fb5ad' },
  { label: 'Equities', pct: 14, color: '#c56a3e' },
  { label: 'Cash', pct: 7, color: '#e6dccb' },
];

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

const PARTNER_STYLE: Record<string, { tint: string; color: string }> = {
  NCB: { tint: '#e7edf8', color: '#1a4aa0' },
  SAG: { tint: '#e6f2ea', color: '#1f7a44' },
  PRV: { tint: '#f6efe0', color: '#9a6a1e' },
  JMMB: { tint: '#fae8e6', color: '#c4362b' },
};
const FALLBACK_STYLES = [
  { tint: '#e7edf8', color: '#1a4aa0' },
  { tint: '#e6f2ea', color: '#1f7a44' },
  { tint: '#f6efe0', color: '#9a6a1e' },
  { tint: '#fae8e6', color: '#c4362b' },
];
const DEFAULT_STYLE = { tint: '#e7edf8', color: '#1a4aa0' };

function partnerStyle(code: string, index: number): { tint: string; color: string } {
  return PARTNER_STYLE[code] ?? FALLBACK_STYLES[index % FALLBACK_STYLES.length] ?? DEFAULT_STYLE;
}

const APPROVAL_TAG: Record<ApprovalType, { label: string; color: string }> = {
  investment_rec: { label: 'Investment', color: '#124e48' },
  fund_transfer: { label: 'Transfer', color: '#c56a3e' },
  plan_enrollment: { label: 'Plan', color: '#9a6a1e' },
};

/** Coarse relative-time label ("Today", "3d ago", "Last week", …) — matches
 *  the prototype's tone without pulling in a date-formatting dependency. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 14) return 'Last week';
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof PortfolioApiError && err.status === 401) {
    return 'Your session has expired. Please sign in again.';
  }
  return err instanceof Error ? err.message : fallback;
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {message}
    </p>
  );
}

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
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);

  const [agentMessages, setAgentMessages] = useState<AgentMessage[] | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getPortfolio()
      .then((p) => {
        if (!cancelled) setPortfolio(p);
      })
      .catch((err) => {
        if (!cancelled) setPortfolioError(describeError(err, 'Could not load your portfolio.'));
      })
      .finally(() => {
        if (!cancelled) setPortfolioLoading(false);
      });

    getApprovals()
      .then(({ approvals: rows }) => {
        if (!cancelled) setApprovals(rows);
      })
      .catch((err) => {
        if (!cancelled) setApprovalsError(describeError(err, 'Could not load your approvals.'));
      })
      .finally(() => {
        if (!cancelled) setApprovalsLoading(false);
      });

    getAgentHistory()
      .then(({ messages }) => {
        if (!cancelled) setAgentMessages(messages);
      })
      .catch((err) => {
        if (!cancelled) setAgentError(describeError(err, 'Could not load recent agent activity.'));
      })
      .finally(() => {
        if (!cancelled) setAgentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const partnersCount = portfolio?.partners.length ?? 0;
  const holdingsCount = portfolio
    ? portfolio.partners.reduce((sum, p) => sum + p.holdings.length, 0)
    : 0;
  const pendingApprovals = (approvals ?? []).filter((a) => a.status === 'pending');
  const recentAgentActivity = (agentMessages ?? [])
    .filter((m) => m.role === 'agent')
    .slice(-3)
    .reverse();

  const stats: {
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
      val: portfolio?.netWorth ?? (portfolioLoading ? '···' : '—'),
      valClass: 'text-foreground',
      sub: portfolio
        ? `${holdingsCount} holdings · ${partnersCount} institutions · live`
        : portfolioLoading
          ? 'Loading…'
          : 'Unavailable',
      subClass: 'text-faint',
    },
    {
      // Blended yield needs a value-weighted return across holdings, but the
      // portfolio API only returns pre-formatted display strings (no raw
      // minor-unit values per holding), so it can't be computed client-side.
      // Illustrative static figure.
      label: 'Blended yield',
      Icon: TrendingUp,
      val: '6.2%',
      valClass: 'text-success',
      sub: '≈ US$1,940 income / year',
      subClass: 'text-faint',
    },
    {
      // Gateway match count is out of scope here — it's owned by the
      // opportunities-screen wiring, not the portfolio/approvals/agent
      // endpoints this page draws from. Left static.
      label: 'Matched to your goals',
      Icon: Sparkles,
      val: '6',
      valClass: 'text-foreground',
      sub: '2 ready for your approval →',
      subClass: 'font-bold text-terra',
    },
  ];

  return (
    <AppScreen active="home">
      <PageHead
        eyebrow="Saturday, July 18"
        title="Good afternoon, Marcus"
        right={
          <div className="flex items-center gap-3">
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
            Total net worth
            {portfolio && ` · ${partnersCount} licensed partner${partnersCount === 1 ? '' : 's'}`}
          </div>
          <div className="my-[10px] mb-3 font-display text-[52px] font-bold leading-none tracking-[-1.5px]">
            {portfolio?.netWorth ?? (portfolioLoading ? '···' : '—')}
          </div>
          {portfolioError && (
            <p className="mb-3 flex items-center gap-2 text-sm text-[#f6d9c9]">
              <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
              {portfolioError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5 text-sm text-[#eafaf5]/[.82]">
            <span className="rounded-[7px] bg-white/[.12] px-[9px] py-[3px] font-mono font-bold text-[#9fe6c6]">
              ↑ 6.8%
            </span>
            +US$1,994 all-time · {portfolio ? `${holdingsCount} holdings` : '… holdings'} · yield
            6.2%
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
            <b className="text-gold">US$400</b> of idle cash inside your limit, and{' '}
            {pendingApprovals.length > 0 ? (
              <>
                prepared{' '}
                <b className="text-gold">
                  {pendingApprovals.length} action{pendingApprovals.length === 1 ? '' : 's'}
                </b>{' '}
                for your approval.
              </>
            ) : (
              "there's nothing waiting on your approval right now."
            )}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="peach" asChild>
              <Link href="/agent">
                {pendingApprovals.length > 0
                  ? `Review ${pendingApprovals.length} approval${pendingApprovals.length === 1 ? '' : 's'}`
                  : 'Go to your agent'}
              </Link>
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

      {/* How your agent works */}
      <Card className="mt-[18px] p-[22px]">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <span className={cn(UPPR, 'text-foreground')}>How your agent works</span>
          <span className="text-sm text-dim">
            Every action is researched, screened and checked, then brought to you
          </span>
        </div>
        <div className="g5">
          {PIPE.map((s) => (
            <div
              key={s.n}
              className={cn(
                'rounded-xl border p-4',
                s.flag
                  ? 'border-[#e7c3ab] bg-[#f9ede2] dark:border-[#5a3f2a] dark:bg-[#2e2118]'
                  : 'border-border bg-[#fbfaf6] dark:bg-white/[0.02]',
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-[7px] font-mono text-[13px] font-bold',
                    s.flag
                      ? 'bg-[#f0d3bd] text-[#b4531f] dark:bg-[#4a3320] dark:text-[#e79b6f]'
                      : 'bg-mint text-teal2',
                  )}
                >
                  {s.n}
                </span>
                <b className="text-[14.5px]">{s.t}</b>
              </div>
              <div
                className={cn(
                  'text-[13px] leading-snug',
                  s.flag ? 'text-[#8a5a3e] dark:text-[#c99a76]' : 'text-dim',
                )}
              >
                {s.b}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Acted / Approvals */}
      <div className="g2 mt-[18px]">
        <Card className="p-[22px]">
          <div className="mb-4 flex items-center gap-2.5">
            <span className={cn(UPPR, 'text-foreground')}>Acted on your behalf</span>
            <Badge variant="secondary">within your limits</Badge>
          </div>
          {agentLoading && <p className="mb-[15px] text-sm text-dim">Loading recent activity…</p>}
          {agentError && !agentLoading && <ErrorLine message={agentError} />}
          {!agentLoading && !agentError && recentAgentActivity.length === 0 && (
            <p className="mb-[15px] text-sm text-dim">No recent agent activity yet.</p>
          )}
          {recentAgentActivity.map((m, i) => (
            <div key={`${m.createdAt}-${i}`} className="mb-[15px] flex gap-2.5">
              <span className="mt-1.5 h-[9px] w-[9px] flex-none rounded-full bg-teal2" />
              <div className="min-w-0">
                <div className="line-clamp-2 text-[14.5px] font-semibold leading-snug">
                  {m.content}
                </div>
                <div className="mt-0.5 text-[12.5px] text-faint">{relativeTime(m.createdAt)}</div>
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
            <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra">
              {pendingApprovals.length}
            </span>
          </div>
          {approvalsLoading && <p className="text-sm text-dim">Loading…</p>}
          {approvalsError && !approvalsLoading && <ErrorLine message={approvalsError} />}
          {!approvalsLoading && !approvalsError && pendingApprovals.length === 0 && (
            <p className="text-sm text-dim">Nothing needs your approval right now.</p>
          )}
          {pendingApprovals.map((a) => {
            const tag = APPROVAL_TAG[a.type] ?? { label: a.type, color: '#124e48' };
            return (
              <div
                key={a.id}
                className="mb-3 rounded-xl border border-border p-4"
                style={{ borderLeft: `3px solid ${tag.color}` }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className="rounded-md px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[.5px]"
                    style={{ color: tag.color, background: `${tag.color}14` }}
                  >
                    {tag.label}
                  </span>
                  <span className="text-[12.5px] text-faint">{relativeTime(a.createdAt)}</span>
                </div>
                <div className="mb-3 text-[15px] font-bold">{a.title}</div>
                <Button className="w-full" asChild>
                  <Link href="/agent">Review &amp; approve</Link>
                </Button>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Stat cards */}
      <div className="g3 mt-[18px]">
        {stats.map((s) => (
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

      {/* Held / Allocation */}
      <div className="g-held mt-[18px]">
        <Card className="p-[22px]">
          <div className="mb-3.5 flex items-center justify-between">
            <b className="font-display text-lg">Held across partners</b>
            <Link href="/portfolio" className="text-sm font-bold text-teal2 no-underline">
              View portfolio →
            </Link>
          </div>
          {portfolioLoading && <p className="py-[11px] text-sm text-dim">Loading…</p>}
          {portfolioError && !portfolioLoading && (
            <div className="py-[11px]">
              <ErrorLine message={portfolioError} />
            </div>
          )}
          {portfolio && portfolio.partners.length === 0 && (
            <p className="py-[11px] text-sm text-dim">No holdings yet.</p>
          )}
          {portfolio?.partners.map((h, index) => {
            const style = partnerStyle(h.code, index);
            const sub = h.holdings.map((holding) => holding.name).join(' · ');
            return (
              <div
                key={h.code}
                className="flex items-center gap-3 border-t border-border py-[11px]"
              >
                <span
                  className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                  style={{ background: style.tint, color: style.color }}
                >
                  {h.code}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-bold">{h.name}</div>
                  <div className="truncate text-[12.5px] text-faint">{sub}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold">{h.total}</div>
                  <div className="text-[11.5px] text-success">· FSC-regulated</div>
                </div>
              </div>
            );
          })}
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
    </AppScreen>
  );
}
