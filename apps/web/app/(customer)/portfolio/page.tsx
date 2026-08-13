'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Skeleton, SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { cn } from '@/app/_lib/utils';
import {
  type AllocationSlice,
  type Currency,
  type Portfolio,
  PortfolioApiError,
  getPortfolio,
  regulatorLabel,
} from '@/lib/portfolio-api';
import { CircleAlert, Link2, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConnectAccountDialog } from './connect-account';

/**
 * Deterministic badge tint/color per partner code, matching the prototype's
 * institution palette. Falls back to a rotating palette for partner codes
 * outside the known set (e.g. a newly linked account) since the API doesn't
 * carry a display color — only code/name/holdings.
 */
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

const CURRENCY_OPTIONS: Currency[] = ['USD', 'JMD', 'TTD'];

// Slice colours per instrument_type; the percentages come from the API, which
// derives them from real holdings joined to their instrument.
const ASSET_COLOR: Record<string, string> = {
  bond: '#17786e',
  real_estate: '#f0b98d',
  fund: '#7fb5ad',
  equity: '#c56a3e',
  private: '#9a6a1e',
  other: '#e6dccb',
};

function assetColor(type: string): string {
  return ASSET_COLOR[type] ?? '#e6dccb';
}

/** Horizontal share bar — the allocation the prototype's portfolio view had and
 *  the live screen was missing entirely. Percentages may not total exactly 100
 *  (server-side rounding), so no remainder slice is drawn. */
function AllocationBreakdown({ slices }: { slices: AllocationSlice[] }) {
  return (
    <Card className="mb-4 p-[22px]">
      <b className="font-display text-lg">Allocation</b>
      <div className="mb-3 text-[13px] text-faint">By asset class</div>
      <div className="mb-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {slices.map((a) => (
          <span
            key={a.type}
            style={{ width: `${a.pct}%`, background: assetColor(a.type) }}
            className="h-full"
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
        {slices.map((a) => (
          <li key={a.type} className="flex items-center gap-2 text-[13.5px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ background: assetColor(a.type) }}
            />
            <span className="text-dim">{a.label}</span>
            <b className="font-mono text-[13px] text-foreground">{a.pct}%</b>
            <span className="text-faint">{a.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function partnerStyle(code: string, index: number): { tint: string; color: string } {
  return PARTNER_STYLE[code] ?? FALLBACK_STYLES[index % FALLBACK_STYLES.length] ?? DEFAULT_STYLE;
}

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Display currency is a server concern: @ccn/money does the conversion so the
  // client never re-implements FX. Changing it refetches rather than converting
  // the numbers we already hold.
  const [currency, setCurrency] = useState<Currency>('USD');

  /**
   * Connecting an account is how anything gets into this screen. Without it an
   * investor finished onboarding, arrived here, and had no way to put anything
   * in — and with no cash, every order they tried was refused by their own cash
   * floor.
   */
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  /**
   * The load, callable rather than only an effect, because connecting an
   * account has to ask for it directly — the holdings it just pulled are the
   * whole point of the screen, and a counter in a dependency array is a
   * roundabout way of saying "fetch again".
   */
  const load = useCallback(
    (signal?: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      return getPortfolio(currency)
        .then((portfolio) => {
          if (!signal?.cancelled) setData(portfolio);
        })
        .catch((err) => {
          if (signal?.cancelled) return;
          if (err instanceof PortfolioApiError && err.status === 401) {
            setError('Your session has expired. Please sign in again to view your portfolio.');
          } else {
            setError(err instanceof Error ? err.message : 'Could not load your portfolio.');
          }
        })
        .finally(() => {
          if (!signal?.cancelled) setLoading(false);
        });
    },
    [currency],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const pendingOrDeclined = (data?.connections ?? []).filter((c) => c.status !== 'active');

  return (
    <AppScreen active="portfolio">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          // Wraps, because three controls do not fit across a phone. PageHead
          // wraps its own two children but this cluster did not wrap inside
          // itself, so adding the Connect button here pushed the document to
          // 610px in a 390px viewport and the whole screen scrolled sideways.
          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* Also in the empty state, but it cannot only live there: an
                investor with one account still needs to add the second. */}
            <Button type="button" size="sm" variant="outline" onClick={() => setConnecting(true)}>
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
              Connect an account
            </Button>
            <fieldset className="m-0 flex min-w-0 items-center gap-1 rounded-xl border border-solid border-border bg-card p-1">
              <legend className="sr-only">Display currency</legend>
              {CURRENCY_OPTIONS.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCurrency(code)}
                  aria-pressed={currency === code}
                  className={cn(
                    'rounded-lg px-3 py-1.5 font-sans text-[13px] font-bold transition-colors',
                    currency === code
                      ? 'bg-primary text-primary-foreground'
                      : 'text-dim hover:text-foreground',
                  )}
                >
                  {code}
                </button>
              ))}
            </fieldset>
            {data ? (
              <div className="flex items-baseline gap-2 rounded-xl border border-solid border-border bg-mint px-4 py-2.5">
                <b className="font-display text-xl">{data.netWorth}</b>
                <span className="text-[12.5px] text-dim">
                  total
                  <br />
                  net worth
                </span>
              </div>
            ) : null}
          </div>
        }
      />

      {/* Directly under the head, because it answers a button the reader just
          pressed. It used to render below the empty state, a screen's height
          from where they were looking. */}
      {connected ? (
        <output className="mb-4 block rounded-xl border border-solid border-border bg-mint px-4 py-3 text-[14px] leading-relaxed text-success-ink">
          {connected}
        </output>
      ) : null}

      {loading && (
        // Mirrors the real shape: the allocation bar, then one row per partner.
        <SkeletonRegion label="Loading your portfolio">
          <SkeletonCard lines={2} className="mb-4" />
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-solid border-border bg-card p-[18px]"
              >
                <Skeleton className="h-10 w-10 flex-none rounded-[10px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="mb-1.5 h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-4 w-20 flex-none" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      )}

      {error && (
        <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {/* Links that hold nothing yet: waiting on the firm, or refused by it.
          Both are states an investor actively looks for, and neither produces a
          holding, so neither appears in the section below. */}
      {data && pendingOrDeclined.length > 0 && (
        <Card className="mb-4 p-[22px]">
          <b className="font-display text-lg">Requested</b>
          <div className="mb-3 text-[13px] text-faint">
            An institution decides whether to take you on as a client. CCN passes them the
            verification you have already done; nothing is read from them until they accept.
          </div>
          <ul className="m-0 list-none p-0">
            {pendingOrDeclined.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-[11px] first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="text-[14.5px] font-bold">{c.name}</div>
                  <div className="text-[12.5px] text-faint">
                    {c.status === 'pending'
                      ? 'Waiting on their compliance desk'
                      : (c.declineReason ?? 'They did not take this on')}
                  </div>
                </div>
                <span
                  className={cn(
                    'flex-none rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px]',
                    c.status === 'pending'
                      ? 'bg-muted text-dim'
                      : 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra',
                  )}
                >
                  {c.status === 'pending' ? 'Pending' : 'Declined'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && data.partners.length === 0 && !error && (
        <EmptyState
          icon={Wallet}
          title="No holdings yet"
          body="Link an account and, once that institution accepts you as a client, every position you hold there appears here. CCN reads your balances — your institution keeps executing, custodying and settling."
          action={
            <Button type="button" size="sm" onClick={() => setConnecting(true)}>
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
              Connect an account
            </Button>
          }
        />
      )}

      {connecting ? (
        <ConnectAccountDialog
          onClose={() => setConnecting(false)}
          onConnected={(summary) => {
            setConnected(
              summary.status === 'pending'
                ? `Asked ${summary.partner} to take you on. They review the verification CCN passes them, and your positions appear here once they accept.`
                : `${summary.refreshed ? 'Refreshed' : 'Connected'} ${summary.partner} — ${summary.holdings} position${summary.holdings === 1 ? '' : 's'}.`,
            );
            void load();
          }}
        />
      ) : null}

      {data && data.allocation.length > 0 && <AllocationBreakdown slices={data.allocation} />}

      {data && data.partners.length > 0 && (
        <div className="g2">
          {data.partners.map((inst, index) => {
            const style = partnerStyle(inst.code, index);
            return (
              <Card key={inst.code} className="p-[22px]">
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className="grid h-10 w-10 flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                    style={{ background: style.tint, color: style.color }}
                  >
                    {inst.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">{inst.name}</div>
                    {inst.kind && <div className="text-[12.5px] text-faint">{inst.kind}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[15px] font-bold">{inst.total}</div>
                    {/* This partner's regulator, from the partners table.
                        Previously every institution carried a static
                        "· FSC-regulated", true of the seeded Jamaican partners
                        and an unverifiable claim for anyone else. Nothing is
                        rendered when the record names no regulator. */}
                    {inst.regulator && (
                      <div className="text-[11.5px] text-success-ink">
                        {regulatorLabel(inst.regulator)}
                      </div>
                    )}
                  </div>
                </div>
                {inst.holdings.map((h) => (
                  <div
                    key={h.name}
                    className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
                  >
                    <span className="text-sm">{h.name}</span>
                    <span className="flex items-baseline gap-2.5">
                      <b className="font-mono text-[13.5px]">{h.value}</b>
                      {/* No return label on this holding means the partner
                          statement carried none — nothing is printed, rather
                          than a dash that reads like a measured zero. */}
                      {h.ret !== null && (
                        <span className="min-w-[42px] text-right text-[13px] text-success-ink">
                          {h.ret}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-[18px] flex items-start gap-3.5 rounded-2xl border border-border bg-mint px-[22px] py-[18px]">
        <ShieldCheck className="mt-0.5 h-[22px] w-[22px] flex-none text-teal2" aria-hidden />
        <p className="m-0 text-[14.5px] leading-relaxed text-dim">
          <b className="text-foreground">Held at licensed, regulated partners.</b> Every instrument
          is custodied and executed by a regulated institution. Your agent coordinates and monitors;
          you approve every move.
        </p>
      </div>
    </AppScreen>
  );
}
