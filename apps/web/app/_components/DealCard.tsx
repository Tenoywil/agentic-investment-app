'use client';

import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { cn } from '@/app/_lib/utils';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

/**
 * The deal card — one component for the live marketplace and the demo, so the
 * two can never drift apart.
 *
 * The layout follows how investment platforms actually present a product to a
 * first-time investor (Yieldstreet/Percent/Public conventions, NN/g
 * progressive-disclosure findings):
 *
 *  - Name and a plain asset-class chip lead — not a ticker.
 *  - ONE headline number, framed by the label the listing firm gave it. The
 *    framing is the honesty: "Est. yield" and "YTD return" are different
 *    claims, and the label under the figure is what keeps them distinct.
 *  - The decision triplet a novice actually uses — rate · term · minimum — is
 *    all on the card; everything else waits for the detail view (two levels of
 *    disclosure, never more).
 *  - Who executes and who regulates them sits with the card, because "which
 *    licensed firm holds this" is the trust question in this region.
 *  - "Capital at risk" is on the card itself, not buried on a legal page —
 *    the convention the FCA prescribes and the honest platforms follow.
 *  - No sparkline: these are largely fixed-rate and unpriced instruments, and
 *    a trend line on a fixed rate implies volatility that does not exist.
 */

export type DealKind = 'Bond' | 'Fund' | 'Equity' | 'Real Estate' | 'Private';

/* Warm type palette; inks darkened so labels clear WCAG 4.5:1 on the tint. */
const TONE: Record<DealKind, { ink: string; tint: string }> = {
  Bond: { ink: '#1a5c54', tint: '#e2f1ee' },
  Fund: { ink: '#0a6e44', tint: '#e2f4ea' },
  Equity: { ink: '#a44e20', tint: '#f5e7d9' },
  'Real Estate': { ink: '#7a5712', tint: '#f6efdf' },
  Private: { ink: '#7d4f36', tint: '#f2e7de' },
};

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  Low: 'success',
  Medium: 'warning',
  High: 'terra',
};

export interface DealCardData {
  id: string;
  abbr: string;
  type: DealKind;
  name: string;
  region: string | null;
  /** The listing firm's own framing of the headline figure ("Est. yield",
   *  "Target IRR"). Null together with `metric`. */
  metricLabel: string | null;
  metric: string | null;
  /** Pre-formatted minimum, or "No minimum". */
  min: string;
  term: string | null;
  partner: string;
  regulator: string | null;
  risk: string;
}

export function DealCard({
  o,
  onOpen,
}: {
  o: DealCardData;
  onOpen: () => void;
}) {
  const t = TONE[o.type];
  const facts: { label: string; value: string }[] = [];
  // The hero slot takes the headline figure when the firm claims one, and the
  // minimum when it does not — a card is anchored by one number either way.
  const hero = o.metric
    ? { value: o.metric, label: o.metricLabel ?? 'Headline figure' }
    : { value: o.min, label: 'Minimum investment' };
  if (o.metric) facts.push({ label: 'Minimum', value: o.min });
  if (o.term) facts.push({ label: 'Term', value: o.term });

  return (
    <div className="group flex flex-col rounded-2xl border border-solid border-border bg-card p-6 transition-shadow duration-150 hover:shadow-[0_10px_32px_rgba(40,34,22,0.10)] focus-within:shadow-[0_10px_32px_rgba(40,34,22,0.10)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.5px]"
            style={{ background: t.tint, color: t.ink }}
          >
            {o.type}
          </span>
          <Badge variant={RISK_VARIANT[o.risk]}>{o.risk} risk</Badge>
        </div>
        <span className="font-mono text-[11.5px] font-bold text-faint">{o.abbr}</span>
      </div>

      <div className="font-display text-[17px] font-bold leading-snug">{o.name}</div>
      {o.region ? <div className="mt-0.5 text-[13px] text-faint">{o.region}</div> : null}

      {/* The one headline number, framed by the firm's own label. */}
      <div className="mt-4">
        <div className="font-mono text-[28px] font-bold leading-none tracking-tight text-foreground">
          {hero.value}
        </div>
        <div className="mt-1 text-[12px] font-semibold uppercase tracking-[.4px] text-faint">
          {hero.label}
        </div>
      </div>

      {/* The rest of the decision triplet: minimum and term. */}
      {facts.length > 0 ? (
        <div
          className={cn(
            'mt-4 grid gap-3 border-x-0 border-b-0 border-t border-solid border-border pt-3',
            facts.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          {facts.map((f) => (
            <div key={f.label}>
              <div className="text-[11px] font-semibold uppercase tracking-[.4px] text-faint">
                {f.label}
              </div>
              <div className="mt-0.5 font-mono text-[14.5px] font-bold text-foreground">
                {f.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Who executes, who supervises them — the region's trust question. */}
      <div className="mt-4 flex items-center gap-2 text-[13px] text-dim">
        <ShieldCheck className="h-4 w-4 flex-none text-teal2" aria-hidden />
        <span className="min-w-0 truncate">
          {o.partner}
          {o.regulator ? ` · ${o.regulator}` : ''}
        </span>
      </div>

      <div className="mb-3.5 mt-1.5 text-[12px] leading-snug text-faint">
        Capital at risk — returns are not guaranteed.
      </div>

      <Button className="mt-auto w-full" onClick={onOpen}>
        Review &amp; invest
      </Button>
    </div>
  );
}

/**
 * The screened-out card — a DealCard sibling, not a stranger. It shares the
 * family's grammar (chips left, mono abbr right, name then region) so the eye
 * reads it as "a deal, in a different state" rather than a foreign widget, and
 * keeps the terra edge as that state's mark.
 *
 * Two deliberate differences from the old version:
 *
 *  - The agent's sentence is attributed. "I recommend against this…" was
 *    rendered as anonymous body copy; it is the agent speaking, and marking
 *    the speaker is what makes the refusal legible as advice.
 *  - The action is quiet. A filled orange button on the one product you
 *    cannot buy shouted as loudly as "Review & invest" on the ones you can —
 *    two rival primaries in one view. Explaining a refusal is a secondary
 *    act, so it gets a text link, in the state's own color.
 */
export function ScreenedOutCard({
  o,
  onOpen,
}: {
  o: {
    abbr: string;
    type: string;
    name: string;
    region: string | null;
    /** The agent's own words on why it will not prepare this. */
    note: string | null;
  };
  onOpen: () => void;
}) {
  return (
    <div
      className="flex flex-col rounded-2xl border border-solid border-[#ecd2c2] bg-card p-6 dark:border-[#5a3f2e]"
      style={{ borderLeft: '4px solid #c56a3e' }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#f2e7de] px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.5px] text-[#7d4f36]">
            {o.type}
          </span>
          <Badge variant="terra">Screened out</Badge>
        </div>
        <span className="font-mono text-[11.5px] font-bold text-faint">{o.abbr}</span>
      </div>

      <div className="font-display text-[17px] font-bold leading-snug">{o.name}</div>
      {o.region ? <div className="mt-0.5 text-[13px] text-faint">{o.region}</div> : null}

      {/* The agent's words, marked as the agent's words. */}
      {o.note ? (
        <div className="mt-4 rounded-xl bg-muted/60 p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.5px] text-dim">
            <Sparkles className="h-3.5 w-3.5 text-teal2" aria-hidden />
            Your agent
          </div>
          <p className="m-0 text-sm leading-snug text-dim">{o.note}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="mt-3.5 inline-flex items-center gap-1.5 self-start text-[13.5px] font-bold text-[#a44e20] underline-offset-4 hover:underline dark:text-terra"
      >
        Why the agent flags this
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
