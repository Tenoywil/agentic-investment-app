'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { GatewayApiError, type Match, getMatches } from '@/lib/gateway-api';
import { CircleAlert, Target } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'success',
  medium: 'warning',
  high: 'terra',
};

const METRIC_BOX = 'rounded-xl bg-[#f4f0e7] px-[15px] py-[13px] dark:bg-white/[0.04]';
const METRIC_LBL =
  'mb-[5px] text-[11.5px] uppercase tracking-[.4px] text-[#6d6455] dark:text-faint';

function formatMoney(minor: string, currency: string): string {
  const n = Number(minor) / 100;
  const prefix = currency === 'USD' ? 'US$' : `${currency} `;
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function MatchCard({ m }: { m: Match }) {
  const o = m.opportunity;
  const scorePct = Math.round(Number(m.score) * 100);
  return (
    <Card className="flex flex-col p-[22px]" style={{ borderLeft: '4px solid #124e48' }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-bold uppercase tracking-[.6px] text-teal2">
          {o.sector}
        </span>
        <Badge variant={RISK_VARIANT[o.riskRating]}>{o.riskRating} risk</Badge>
      </div>
      <div className="mb-1 text-[13px] text-faint">
        {o.country} · {o.stage}
      </div>
      <div className="mb-3.5 font-display text-lg font-bold leading-tight">{o.name}</div>

      <div className="mb-3.5 grid grid-cols-2 gap-[11px]">
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Match score</div>
          <div className="font-mono text-lg font-bold text-success">{scorePct}%</div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Readiness</div>
          <div className="font-mono text-lg font-bold text-foreground">
            {o.readinessScore ?? '—'}
          </div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Capital sought</div>
          <div className="font-mono text-base font-bold text-foreground">
            {formatMoney(o.capitalSoughtMinor, o.currency)}
          </div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Target return</div>
          <div className="font-mono text-base font-bold text-foreground">
            {Number(o.targetReturnPct)}%
          </div>
        </div>
      </div>

      <Button asChild className="mt-auto w-full">
        <Link href={`/gateway/opportunities/detail?id=${o.id}&matchId=${m.id}`}>
          <Target className="h-4 w-4" aria-hidden />
          Why it matches you
        </Link>
      </Button>
    </Card>
  );
}

export default function GatewayOpportunitiesPage() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [needsMandate, setNeedsMandate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMatches()
      .then(({ matches }) => setMatches(matches))
      .catch((err) => {
        if (err instanceof GatewayApiError && err.status === 409) {
          setNeedsMandate(true);
        } else {
          setError(err instanceof Error ? err.message : 'Could not load your matches.');
        }
      });
  }, []);

  return (
    <AppScreen active="gatewayOpportunities">
      <PageHead
        eyebrow="Caribbean Capital Gateway · private-deal matching"
        title="Private deals matched to you"
        right={
          matches ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-mint px-[15px] py-[9px]">
              <b className="font-display text-xl">{matches.length}</b>
              <span className="text-[12.5px] leading-tight text-dim">
                matched to
                <br />
                your mandate
              </span>
            </div>
          ) : undefined
        }
      />

      {needsMandate && (
        <Card className="flex flex-wrap items-center gap-4 border-[#cde0d8] bg-mint p-[22px] dark:border-white/10">
          <Target className="h-8 w-8 flex-none text-teal2" aria-hidden />
          <div className="min-w-[240px] flex-1">
            <div className="mb-1 font-display text-lg font-bold">Set up your mandate first</div>
            <p className="text-sm leading-snug text-dim">
              Matches are scored against your investor mandate — describe what you're looking for
              and we'll find the deals that fit.
            </p>
          </div>
          <Button asChild className="flex-none">
            <Link href="/gateway/mandate">Create my mandate</Link>
          </Button>
        </Card>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {matches && matches.length === 0 && !needsMandate && (
        <p className="text-sm text-dim">
          No approved opportunities match your mandate yet. Check back soon.
        </p>
      )}

      {matches && matches.length > 0 && (
        <div className="g2">
          {matches.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </AppScreen>
  );
}
