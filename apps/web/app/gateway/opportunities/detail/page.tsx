'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { Textarea } from '@/app/_components/ui/textarea';
import {
  type Claim,
  type Evidence,
  type EvidenceStatus,
  type Match,
  type Opportunity,
  getMatches,
  getOpportunity,
  narrateMatch,
  requestIntroduction,
} from '@/lib/gateway-api';
import {
  Check,
  CircleAlert,
  CircleHelp,
  FileQuestion,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useState } from 'react';

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'success',
  medium: 'warning',
  high: 'terra',
};

const EVIDENCE_GROUPS: { status: EvidenceStatus; label: string; variant: BadgeProps['variant'] }[] =
  [
    { status: 'verified', label: 'Verified', variant: 'success' },
    { status: 'partially_verified', label: 'Partially verified', variant: 'success' },
    { status: 'self_reported', label: 'Self-reported', variant: 'warning' },
    { status: 'unverified', label: 'Unverified', variant: 'warning' },
    { status: 'contradicted', label: 'Contradicted', variant: 'terra' },
  ];

const METRIC_BOX = 'rounded-xl bg-[#f4f0e7] px-[15px] py-[13px] dark:bg-white/[0.04]';
const METRIC_LBL =
  'mb-[5px] text-[11.5px] uppercase tracking-[.4px] text-[#6d6455] dark:text-faint';

function formatMoney(minor: string | null, currency: string): string {
  if (minor == null) return '—';
  const n = Number(minor) / 100;
  const prefix = currency === 'USD' ? 'US$' : `${currency} `;
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function IntroductionDialog({
  open,
  match,
  onClose,
}: { open: boolean; match: Match | null; onClose: () => void }) {
  const titleId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      setDone(false);
    }
  }, [open]);

  async function submit() {
    if (!match) return;
    setBusy(true);
    setError(null);
    try {
      await requestIntroduction(match.id, note.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-[22px] font-sans text-foreground">
        <DialogHeader className={done ? 'sr-only' : undefined}>
          <DialogTitle id={titleId}>
            {done ? 'Request sent' : 'Request an introduction'}
          </DialogTitle>
          <DialogDescription>
            An analyst reviews every introduction request before you're connected — this is never
            automatic.
          </DialogDescription>
        </DialogHeader>
        {!done ? (
          <>
            <div className="mt-4 flex flex-col gap-1.5">
              <label htmlFor="intro-note" className="text-sm font-semibold text-foreground">
                Note to the analyst (optional)
              </label>
              <Textarea
                id="intro-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything that helps the analyst route this well…"
                rows={4}
              />
            </div>
            {error && (
              <p className="mt-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {error}
              </p>
            )}
            <Button onClick={submit} disabled={busy} size="lg" className="mt-4 w-full">
              {busy ? 'Sending…' : 'Send request'}
            </Button>
          </>
        ) : (
          <div className="px-0 pb-1 pt-1.5 text-center">
            <div className="mx-auto mb-4 grid h-[68px] w-[68px] place-items-center rounded-full bg-[#e2f4ea] dark:bg-[#12352a]">
              <Check className="h-8 w-8 text-success" aria-hidden strokeWidth={2.2} />
            </div>
            <div className="font-display text-[21px] font-bold">Request sent</div>
            <p className="mx-auto mb-[18px] mt-2 max-w-[330px] text-[14.5px] leading-snug text-dim">
              An analyst will review your request and follow up. You can track its status under
              Introductions.
            </p>
            <Button size="lg" className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailContent() {
  const params = useSearchParams();
  const id = params.get('id');
  const matchIdParam = params.get('matchId');

  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('No opportunity specified.');
      return;
    }
    Promise.all([getOpportunity(id), getMatches().catch(() => ({ matches: [] as Match[] }))])
      .then(([oppResult, matchResult]) => {
        setOpportunity(oppResult.opportunity);
        setClaims(oppResult.claims);
        setEvidence(oppResult.evidence);
        const found =
          matchResult.matches.find((m) => m.id === matchIdParam) ??
          matchResult.matches.find((m) => m.opportunityId === id) ??
          null;
        setMatch(found);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this deal.'));
  }, [id, matchIdParam]);

  async function handleNarrate() {
    if (!match) return;
    setNarrating(true);
    try {
      const { match: updated } = await narrateMatch(match.id);
      setMatch(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent is temporarily unavailable.');
    } finally {
      setNarrating(false);
    }
  }

  if (error && !opportunity) {
    return (
      <>
        <PageHead eyebrow="Caribbean Capital Gateway · private-deal matching" title="Deal" />
        <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      </>
    );
  }

  if (!opportunity) {
    return (
      <>
        <PageHead eyebrow="Caribbean Capital Gateway · private-deal matching" title="Deal" />
        <p className="text-sm text-dim">Loading…</p>
      </>
    );
  }

  const scorePct = match ? Math.round(Number(match.score) * 100) : null;
  const evidenceGroups = EVIDENCE_GROUPS.map((g) => ({
    ...g,
    items: evidence
      .filter((e) => e.status === g.status)
      .map((e) => ({ evidence: e, claim: claims.find((c) => c.id === e.claimId) })),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageHead
        eyebrow={`${opportunity.country} · ${opportunity.sector} · ${opportunity.stage}`}
        title={opportunity.name}
        right={
          <Badge variant={RISK_VARIANT[opportunity.riskRating]}>
            {opportunity.riskRating} risk
          </Badge>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-[11px] sm:grid-cols-4">
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Match score</div>
          <div className="font-mono text-lg font-bold text-success">
            {scorePct != null ? `${scorePct}%` : '—'}
          </div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Readiness</div>
          <div className="font-mono text-lg font-bold text-foreground">
            {opportunity.readinessScore ?? '—'}
          </div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Capital sought</div>
          <div className="font-mono text-base font-bold text-foreground">
            {formatMoney(opportunity.capitalSoughtMinor, opportunity.currency)}
          </div>
        </div>
        <div className={METRIC_BOX}>
          <div className={METRIC_LBL}>Target return</div>
          <div className="font-mono text-base font-bold text-foreground">
            {Number(opportunity.targetReturnPct)}%
          </div>
        </div>
      </div>

      <h2 className="mb-1.5 mt-[26px] font-display text-xl font-bold">Summary</h2>
      <p className="mb-2 text-[15px] leading-relaxed text-dim">{opportunity.summary}</p>

      <h2 className="mb-1.5 mt-[26px] font-display text-xl font-bold">Why it matches you</h2>
      {match ? (
        <Card className="border-[#cde0d8] bg-mint p-[18px] dark:border-white/10">
          {match.reasons.length > 0 || match.concerns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {match.reasons.map((r) => (
                <div key={r} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden />
                  {r}
                </div>
              ))}
              {match.concerns.map((c) => (
                <div key={c} className="flex items-start gap-2 text-sm text-foreground">
                  <CircleAlert
                    className="mt-0.5 h-4 w-4 flex-none text-[#a44e20] dark:text-terra"
                    aria-hidden
                  />
                  {c}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-dim">
                The score above is real, computed from your mandate. Get a short plain-language
                explanation from the agent.
              </p>
              <Button onClick={handleNarrate} disabled={narrating} variant="secondary">
                <Sparkles className="h-4 w-4" aria-hidden />
                {narrating ? 'Thinking…' : 'Get personalized insight'}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <p className="text-sm text-dim">No match on file for this opportunity yet.</p>
      )}

      {opportunity.criticalMissingItems.length > 0 && (
        <>
          <h2 className="mb-1.5 mt-[26px] font-display text-xl font-bold">Open questions</h2>
          <Card className="border-[#f6efdf] bg-[#f6efdf] p-[18px] dark:border-[#38301a] dark:bg-[#38301a]">
            {opportunity.criticalMissingItems.map((item) => (
              <div key={item} className="flex items-start gap-2 py-1 text-sm text-foreground">
                <FileQuestion
                  className="mt-0.5 h-4 w-4 flex-none text-[#7a5712] dark:text-[#e2bd6b]"
                  aria-hidden
                />
                {item}
              </div>
            ))}
          </Card>
        </>
      )}

      {opportunity.disclosures.length > 0 && (
        <>
          <h2 className="mb-1.5 mt-[26px] font-display text-xl font-bold">Important disclosures</h2>
          <Card className="border-[#f6efdf] bg-[#f6efdf] p-[18px] dark:border-[#38301a] dark:bg-[#38301a]">
            {opportunity.disclosures.map((item) => (
              <div key={item} className="flex items-start gap-2 py-1 text-sm text-foreground">
                <CircleAlert
                  className="mt-0.5 h-4 w-4 flex-none text-[#7a5712] dark:text-[#e2bd6b]"
                  aria-hidden
                />
                {item}
              </div>
            ))}
          </Card>
        </>
      )}

      <h2 className="mb-1.5 mt-[26px] font-display text-xl font-bold">Evidence</h2>
      {evidenceGroups.length === 0 ? (
        <p className="text-sm text-dim">No evidence recorded for this opportunity yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {evidenceGroups.map((g) => (
            <Card key={g.status} className="p-[18px]">
              <div className="mb-2.5 flex items-center gap-2">
                <Badge variant={g.variant}>{g.label}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map(({ evidence: ev, claim }) => (
                  <div
                    key={ev.id}
                    className="border-t border-border pt-2 text-sm first:border-0 first:pt-0"
                  >
                    <div className="font-semibold text-foreground">
                      {claim?.label ?? 'Claim'}: {claim?.value ?? '—'}
                    </div>
                    {ev.detail && <div className="mt-0.5 text-dim">{ev.detail}</div>}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-2 mt-[30px] flex items-center gap-2 text-[13.5px] text-dim">
        <ShieldCheck className="h-3.5 w-3.5 flex-none text-success" aria-hidden />
        Introductions are human-gated — an analyst reviews every request before you're connected.
      </div>

      {error && (
        <p className="mb-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      <Button size="lg" className="w-full" disabled={!match} onClick={() => setIntroOpen(true)}>
        <Target className="h-4 w-4" aria-hidden />
        {match ? 'Request introduction' : 'No match on file'}
      </Button>

      <IntroductionDialog open={introOpen} match={match} onClose={() => setIntroOpen(false)} />
    </>
  );
}

export default function GatewayOpportunityDetailPage() {
  return (
    <AppScreen active="gatewayOpportunities">
      <Suspense
        fallback={
          <p className="flex items-center gap-2 text-sm text-dim">
            <CircleHelp className="h-4 w-4 flex-none" aria-hidden />
            Loading…
          </p>
        }
      >
        <DetailContent />
      </Suspense>
    </AppScreen>
  );
}
