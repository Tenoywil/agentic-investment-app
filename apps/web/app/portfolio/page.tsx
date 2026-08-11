'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import { type Portfolio, PortfolioApiError, getPortfolio } from '@/lib/portfolio-api';
import { CircleAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

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

function partnerStyle(code: string, index: number): { tint: string; color: string } {
  return PARTNER_STYLE[code] ?? FALLBACK_STYLES[index % FALLBACK_STYLES.length] ?? DEFAULT_STYLE;
}

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPortfolio()
      .then((portfolio) => {
        if (!cancelled) setData(portfolio);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof PortfolioApiError && err.status === 401) {
          setError('Your session has expired. Please sign in again to view your portfolio.');
        } else {
          setError(err instanceof Error ? err.message : 'Could not load your portfolio.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppScreen active="portfolio">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          data ? (
            <div className="flex items-baseline gap-2 rounded-xl border border-border bg-mint px-4 py-2.5">
              <b className="font-display text-xl">{data.netWorth}</b>
              <span className="text-[12.5px] text-dim">
                total
                <br />
                net worth
              </span>
            </div>
          ) : undefined
        }
      />

      {loading && <p className="text-sm text-dim">Loading your portfolio…</p>}

      {error && (
        <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {data && data.partners.length === 0 && !error && (
        <p className="text-sm text-dim">
          No holdings yet. Once your accounts are linked, your positions will appear here.
        </p>
      )}

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
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[15px] font-bold">{inst.total}</div>
                    <div className="text-[11.5px] text-success">· FSC-regulated</div>
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
                      <span
                        className={cn(
                          'min-w-[42px] text-right text-[13px]',
                          h.ret === null ? 'text-faint' : 'text-success',
                        )}
                      >
                        {h.ret ?? '—'}
                      </span>
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
          <b className="text-foreground">Held at licensed, FSC-regulated partners.</b> Every
          instrument is custodied and executed by a regulated institution. Your agent coordinates
          and monitors; you approve every move.
        </p>
      </div>
    </AppScreen>
  );
}
