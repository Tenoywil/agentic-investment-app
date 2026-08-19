'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { useMe } from '@/app/_lib/session';
import { useRealtime } from '@/app/_lib/use-realtime';
import { agentFeedPreview, cn, splitApprovalTitle } from '@/app/_lib/utils';
import {
  type AgentMessage,
  type AllocationSlice,
  type Approval,
  type ApprovalType,
  type Portfolio,
  PortfolioApiError,
  getAgentHistory,
  getApprovals,
  getPortfolio,
  regulatorLabel,
} from '@/lib/portfolio-api';
import { CheckCheck, CircleAlert, PieChart, ShieldAlert, Sparkles, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

// Slice colours per instrument_type, keeping the prototype's palette. The
// percentages themselves come from the API (holdings joined to their
// instrument), never from a constant — this used to be a hardcoded breakdown,
// which on a live account meant showing a signed-in user invented figures for
// their own money.
const ASSET_COLOR: Record<string, string> = {
  bond: '#17786e',
  real_estate: '#f0b98d',
  fund: '#7fb5ad',
  equity: '#c56a3e',
  private: '#9a6a1e',
  other: '#e6dccb',
};
const ASSET_COLOR_FALLBACK = '#e6dccb';

function assetColor(type: string): string {
  return ASSET_COLOR[type] ?? ASSET_COLOR_FALLBACK;
}

/** Today, in the viewer's own locale and timezone. Was a hardcoded
 *  "Saturday, July 18". */
function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Greet the signed-in user by their first name. Falls back to a name-less
 *  greeting rather than a placeholder — addressing someone by the wrong name is
 *  worse than not naming them. */
function greeting(name: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

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

/**
 * Approval type badges. These were inline hex colours used for both the text
 * and an 8%-alpha fill behind it, which meant the light-theme ink was painted
 * on the dark theme's background — "Investment" measured 1.68:1 there, far
 * under the 4.5:1 floor. Tailwind classes with a dark variant instead, so each
 * theme gets ink tuned for its own surface.
 */
const APPROVAL_TAG: Record<ApprovalType, { label: string; className: string }> = {
  investment_rec: {
    label: 'Investment',
    className: 'bg-primary/10 text-primary dark:bg-teal2/15 dark:text-teal2',
  },
  fund_transfer: {
    label: 'Transfer',
    className: 'bg-terra/10 text-terra-ink dark:bg-terra/15 dark:text-terra-ink',
  },
  plan_enrollment: {
    label: 'Plan',
    className: 'bg-gold/15 text-[#7a5316] dark:bg-gold/15 dark:text-gold',
  },
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

function Donut({ slices }: { slices: AllocationSlice[] }) {
  const r = 52;
  const cir = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
      <g transform="rotate(-90 66 66)">
        {slices.map((a) => {
          const len = (a.pct / 100) * cir;
          const seg = (
            <circle
              key={a.type}
              cx="66"
              cy="66"
              r={r}
              fill="none"
              stroke={assetColor(a.type)}
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
  // Identity comes from the one session fetch the layout already made — this
  // screen used to ask Better Auth for its own copy of the user.
  const me = useMe();
  const userName = me ? me.user.name.trim() || me.user.email : null;

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);

  const [agentMessages, setAgentMessages] = useState<AgentMessage[] | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  /**
   * Home is the screen someone leaves open. Its net worth moves when an order
   * settles at a partner, and its approvals panel is the product's whole
   * premise — a card that appears when the agent needs a decision. Both were
   * frozen at whatever they read when the tab was opened.
   */
  const reload = useCallback(() => {
    void getPortfolio()
      .then(setPortfolio)
      .catch(() => {});
    void getApprovals()
      .then(({ approvals: rows }) => setApprovals(rows))
      .catch(() => {});
    void getAgentHistory()
      .then(({ messages }) => setAgentMessages(messages))
      .catch(() => {});
  }, []);

  useRealtime(['order', 'approval', 'connection'], reload);

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
  const allocation: AllocationSlice[] = portfolio?.allocation ?? [];
  const holdingsCount = portfolio
    ? portfolio.partners.reduce((sum, p) => sum + p.holdings.length, 0)
    : 0;
  const pendingApprovals = (approvals ?? []).filter((a) => a.status === 'pending');
  const recentAgentActivity = (agentMessages ?? [])
    .filter((m) => m.role === 'agent')
    .slice(-3)
    .reverse();

  // The two stat cards that stood between the hero and the holdings restated
  // the hero's own net worth and the allocation card's own split. Numbers a
  // reader has already been shown are clutter, not reassurance — gone.

  return (
    <AppScreen active="home">
      {/* No right-hand slot. A notification bell stood here with no handler and
          no notifications behind it — there is no notification record anywhere
          in the schema. The avatar that replaced it was no better: an icon
          shaped exactly like an account menu that opened nothing, on the one
          screen that had it. The real account menu now lives in the sidebar
          footer, where it is on every screen and always in view. */}
      <PageHead eyebrow={todayLabel()} title={greeting(userName)} />

      {/* A firm asked this person to finish verification, and their KYC is
          genuinely incomplete: one banner naming the firm, one door to the
          flow that clears it. Gone the moment onboarding completes. */}
      {me && !me.onboarding.complete && (me.kycRequests?.length ?? 0) > 0 && (
        <div className="mb-[18px] flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-solid border-[#e3d3b8] bg-[#f9f3e4] px-4 py-3 dark:border-[#5a4a2e] dark:bg-[#2c2517]">
          <ShieldAlert className="h-5 w-5 flex-none text-[#8a6a1e] dark:text-gold" aria-hidden />
          <p className="m-0 min-w-0 flex-1 text-[14px] leading-snug text-[#5c4d2e] dark:text-[#e2d3ae]">
            <b>
              {(me.kycRequests ?? [])
                .map((r) => r.partner)
                .filter((p, i, all) => all.indexOf(p) === i)
                .join(' and ')}
            </b>{' '}
            asked you to finish verifying your identity. It takes a few minutes, and it is what lets
            the firm act on your instructions.
          </p>
          <Button size="sm" asChild className="flex-none">
            <Link href="/onboarding">Finish verification</Link>
          </Button>
        </div>
      )}

      {/* Hero card */}
      <div className="g-hero rounded-[20px] bg-primary p-7 text-[#eafaf5] dark:bg-[#124e48]">
        {/* Net worth is the only figure here. The "↑6.8% · +US$1,994 all-time ·
            yield 6.2%" line and the rising sparkline under it were drawn from
            constants: there is no valuation history in the schema, so no
            change, no all-time return and no trend can be computed for anyone.
            What replaces them is what the portfolio endpoint does know. */}
        <div>
          <div className={cn(UPPR, 'text-[#eafaf5]/[.78]')}>Total net worth</div>
          {portfolio ? (
            <div
              className="my-[10px] mb-3 font-display text-[52px] font-bold leading-none tracking-[-1.5px]"
              data-tour="customer-net-worth"
            >
              {portfolio.netWorth}
            </div>
          ) : portfolioLoading ? (
            // Same box the 52px figure occupies (leading-none, my-[10px] mb-3),
            // so the hero does not resize under the reader when it resolves.
            // On the hero's own dark ground rather than bg-muted, which would
            // read as a hole punched in the card.
            <output aria-busy="true" className="my-[10px] mb-3 block h-[52px]">
              <span className="sr-only">Adding up your position</span>
              <div className="h-[52px] w-56 animate-pulse rounded-md bg-white/15" aria-hidden />
            </output>
          ) : null}
          {portfolioError && (
            <p className="mb-3 flex items-center gap-2 text-sm text-[#f6d9c9]">
              <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
              {portfolioError}
            </p>
          )}
          {portfolio && (
            <div className="text-sm text-[#eafaf5]/[.94]">
              {holdingsCount === 0
                ? `Nothing linked yet · shown in ${portfolio.currency}`
                : `${holdingsCount} ${holdingsCount === 1 ? 'holding' : 'holdings'} · ${partnersCount} licensed ${
                    partnersCount === 1 ? 'partner' : 'partners'
                  } · shown in ${portfolio.currency}`}
            </div>
          )}
        </div>
        {/* The hero's height is whichever column is taller, and this one fills
            from three separate fetches — the agent's last message, the approval
            count, the buttons that depend on both. Until they land it is short,
            and the whole page sits 55px higher than it will: measured as a
            single 0.156 layout shift on /home, every element below the hero
            moving at once. Reserving the settled height holds the page still.
            The numbers are measured (207px at 1280, 297px stacked on a phone)
            and are a floor, not a cap — a longer message grows the card as it
            always did. */}
        {/*
          Where to next — not a running commentary from the agent.

          This column used to narrate the agent's latest message on every visit
          ("Catching up with your agent…"), which put an assistant's inner
          monologue above the person's own money. The agent earns this space
          only when it actually needs a decision; otherwise the column is three
          plain doors into the product, in the order a person uses them.
        */}
        <div
          className="min-h-[207px] pl-[26px] max-[900px]:min-h-[297px]"
          data-tour="customer-agent"
        >
          <div className={cn(UPPR, 'flex items-center gap-[7px] text-[#eafaf5]/[.78]')}>
            <span className="h-[7px] w-[7px] rounded-full bg-peach" />
            {pendingApprovals.length > 0 ? 'Waiting on you' : 'Where to next'}
          </div>
          <p className="my-3 mb-2 text-[17px] font-medium leading-relaxed text-white">
            {pendingApprovals.length > 0
              ? `${pendingApprovals.length === 1 ? 'One move is' : `${pendingApprovals.length} moves are`} waiting for your approval. Nothing happens until you say so.`
              : 'Browse what you can invest in, follow your orders, or ask your agent. It checks every move against your limits and asks you first.'}
          </p>
          <div className="mt-[18px] flex flex-wrap gap-2.5">
            {pendingApprovals.length > 0 && (
              <Button variant="peach" asChild>
                <Link href="/agent">
                  Review {pendingApprovals.length} approval
                  {pendingApprovals.length === 1 ? '' : 's'}
                </Link>
              </Button>
            )}
            <Button
              asChild
              className={
                pendingApprovals.length > 0
                  ? 'border border-white/30 bg-transparent text-white hover:bg-white/10'
                  : undefined
              }
              variant={pendingApprovals.length > 0 ? undefined : 'peach'}
            >
              <Link href="/opportunities">Invest</Link>
            </Button>
            <Button
              asChild
              className="border border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/orders">My orders</Link>
            </Button>
            <Button
              asChild
              className="border border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              <Link href="/agent">Ask your agent</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Held / Allocation — the person's own money, first thing under the
          hero. It used to sit at the very bottom, under two screens of cards
          about the agent. */}
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
            <EmptyState
              icon={Wallet}
              title="No holdings yet"
              body="Link an account or invest through an opportunity, and every position appears here, grouped by institution."
            />
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
                  {/* The partner's own regulator, not the blanket
                      "· FSC-regulated" this used to print under every
                      institution. Omitted entirely when the partner record
                      names none — claiming a regulator is not a detail to
                      guess at. */}
                  {h.regulator && (
                    <div className="text-[11.5px] text-success-ink">
                      {regulatorLabel(h.regulator)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        <Card className="p-[22px]">
          <b className="font-display text-lg">Allocation</b>
          <div className="mb-2 text-[13px] text-faint">
            {partnersCount > 0
              ? `Blended across ${partnersCount} ${partnersCount === 1 ? 'partner' : 'partners'}`
              : 'By asset class'}
          </div>
          {allocation.length === 0 ? (
            <EmptyState
              icon={PieChart}
              title="Nothing to break down yet"
              body="Once you hold something, your split by asset class appears here."
            />
          ) : (
            <div className="flex items-center gap-[18px]">
              <Donut slices={allocation} />
              <div className="flex-1">
                {allocation.map((a) => (
                  <div key={a.type} className="mb-[7px] flex items-center gap-2 text-[13.5px]">
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-[3px]"
                      style={{ background: assetColor(a.type) }}
                    />
                    <span className="flex-1 text-dim">{a.label}</span>
                    <b className="font-mono text-[13px]">{a.pct}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* The agent's corner — after the money, and only when it has something
          real to show. A brand-new account used to meet two agent cards
          narrating that nothing had happened; silence about nothing reads
          better at any age. */}
      {(pendingApprovals.length > 0 || recentAgentActivity.length > 0) && (
        <div className="g2 mt-[18px]">
          <Card className="p-[22px]" data-tour="customer-approvals">
            <div className="mb-4 flex items-center gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
              {pendingApprovals.length > 0 && (
                <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra-ink">
                  {pendingApprovals.length}
                </span>
              )}
            </div>
            {approvalsError && !approvalsLoading && <ErrorLine message={approvalsError} />}
            {!approvalsLoading && !approvalsError && pendingApprovals.length === 0 && (
              <EmptyState
                icon={CheckCheck}
                title="Nothing needs your approval"
                body="Moves outside your limits wait here for a decision from you."
              />
            )}
            {pendingApprovals.map((a) => {
              const tag = APPROVAL_TAG[a.type] ?? APPROVAL_TAG.investment_rec;
              // Same treatment the agent screen gives the full card: the
              // instrument as the headline, the amount as the figure. This
              // card stays minimal — deciding happens on /agent.
              const split = splitApprovalTitle(a.title);
              return (
                <div
                  key={a.id}
                  className="mb-3 rounded-xl border border-solid border-border bg-muted/20 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={cn(
                        'rounded-md px-[9px] py-[3px] text-[11px] font-bold uppercase tracking-[.5px]',
                        tag.className,
                      )}
                    >
                      {tag.label}
                    </span>
                    <span className="text-[12.5px] text-faint">{relativeTime(a.createdAt)}</span>
                  </div>
                  {split ? (
                    <>
                      <div className="mb-0.5 text-[15px] font-bold leading-snug">{split.name}</div>
                      <div className="mb-3 font-display text-[22px] font-bold leading-none tracking-tight text-teal2">
                        {split.amount}
                      </div>
                    </>
                  ) : (
                    <div className="mb-3 text-[15px] font-bold">{a.title}</div>
                  )}
                  <Button className="w-full" asChild>
                    <Link href="/agent">Review &amp; approve</Link>
                  </Button>
                </div>
              );
            })}
          </Card>

          <Card className="p-[22px]" data-tour="customer-activity">
            <div className="mb-4 flex items-center gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Acted on your behalf</span>
              <Badge variant="secondary">within your limits</Badge>
            </div>
            {agentError && !agentLoading && <ErrorLine message={agentError} />}
            {!agentLoading && !agentError && recentAgentActivity.length === 0 && (
              <EmptyState
                className="mb-[15px]"
                icon={Sparkles}
                title="Your agent hasn't acted yet"
                body="Everything it does inside your limits is recorded here, newest first."
              />
            )}
            {recentAgentActivity.map((m, i) => (
              <div key={`${m.createdAt}-${i}`} className="mb-[15px] flex gap-2.5">
                <span className="mt-1.5 h-[9px] w-[9px] flex-none rounded-full bg-teal2" />
                <div className="min-w-0">
                  {/* One plain sentence, never raw markdown — the agent's
                      tables and emphasis belong on /agent, not in a feed row. */}
                  <div className="line-clamp-2 text-[14.5px] font-semibold leading-snug">
                    {agentFeedPreview(m.content)}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-faint">{relativeTime(m.createdAt)}</div>
                </div>
              </div>
            ))}
            <Button variant="outline" className="mt-1.5 w-full text-teal2" asChild>
              <Link href="/agent">Adjust your agent's limits</Link>
            </Button>
          </Card>
        </div>
      )}

      {/* "How your agent works" is gone from here: a static explainer between
          a person and their money read as demo furniture. It lives on the
          Agent screen (AgentPipeline), where somebody goes to understand it. */}
    </AppScreen>
  );
}
