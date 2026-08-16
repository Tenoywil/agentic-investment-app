'use client';

import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { cn } from '@/app/_lib/utils';
import type {
  AgentDisplayData,
  AllocationDisplayData,
  AllocationSlice,
  ComparisonDisplayData,
  FitDisplayData,
  GoalsDisplayData,
  PipelineDisplayData,
  TraceStageDisplay,
} from '@/lib/agent-api';
import { type LucideIcon, Route, Scale, Search, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Inline visual cards for the agent chat. Every number rendered here arrives
 * through the `display` SSE channel, computed by the pure agent context
 * server-side — the model narrates these figures but cannot author them, and
 * neither can this file: there are no data literals below, only layout.
 *
 * Mobile-first: each card lives inside a 390px chat bubble column first, and
 * anything wide (the comparison table) scrolls inside its own box so the page
 * never scrolls sideways.
 */

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

/**
 * Slice colours per instrument type — the same palette the home dashboard's
 * ASSET_COLOR uses, extended with a cash tone. Colours are chrome; the widths
 * they paint always come from the API's pct fields.
 */
const TYPE_COLOR: Record<string, string> = {
  cash: '#b3a68b',
  bond: '#17786e',
  fund: '#7fb5ad',
  equity: '#c56a3e',
  real_estate: '#f0b98d',
  private: '#9a6a1e',
};
const TYPE_COLOR_FALLBACK = '#e6dccb';

function typeColor(key: string): string {
  return TYPE_COLOR[key] ?? TYPE_COLOR_FALLBACK;
}

const RISK_VARIANT: Record<string, BadgeProps['variant']> = {
  low: 'success',
  medium: 'warning',
  high: 'terra',
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <Badge variant={RISK_VARIANT[risk] ?? 'outline'} className="capitalize">
      {risk} risk
    </Badge>
  );
}

/** Colour band for a 0-100 fit score: high reads as go, low as caution. */
function fitVariant(score: number): BadgeProps['variant'] {
  if (score >= 70) return 'success';
  if (score >= 40) return 'secondary';
  return 'warning';
}

function fitTileClasses(score: number): string {
  if (score >= 70) return 'bg-[#e2f4ea] text-[#0a6e44] dark:bg-[#12352a] dark:text-[#5fce9e]';
  if (score >= 40) return 'bg-muted text-foreground';
  return 'bg-[#f6efdf] text-[#7a5712] dark:bg-[#38301a] dark:text-[#e2bd6b]';
}

/* ------------------------------- Allocation ------------------------------- */

/** Keep the top slices and fold the remainder into one summary row. */
function topSlices(
  slices: AllocationSlice[],
  keep: number,
): { top: AllocationSlice[]; rest: { count: number; pct: number } | null } {
  if (slices.length <= keep + 1) return { top: slices, rest: null };
  const rest = slices.slice(keep);
  return {
    top: slices.slice(0, keep),
    rest: {
      count: rest.length,
      pct: Math.round(rest.reduce((sum, s) => sum + s.pct, 0) * 10) / 10,
    },
  };
}

function SliceLegend({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  if (slices.length === 0) return null;
  const { top, rest } = topSlices(slices, 4);
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.4px] text-faint">
        {title}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
        {top.map((s) => (
          <li key={s.key} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-dim">{s.label}</span>
            <b className="font-mono text-foreground">{s.pct}%</b>
          </li>
        ))}
        {rest && (
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-faint">{rest.count} more</span>
            <b className="font-mono text-faint">{rest.pct}%</b>
          </li>
        )}
      </ul>
    </div>
  );
}

export function AllocationDisplay({ data }: { data: AllocationDisplayData }) {
  const held = data.byType.filter((t) => t.pct > 0);
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={cn(UPPR, 'text-foreground')}>Your allocation</span>
        <span className="flex items-baseline gap-2">
          <Badge variant="outline" className="capitalize">
            {data.band} band
          </Badge>
          <b className="font-mono text-[13.5px]">{data.total}</b>
        </span>
      </div>
      <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {held.map((t) => (
          <span
            key={t.key}
            style={{ width: `${t.pct}%`, background: typeColor(t.key) }}
            className="h-full"
          />
        ))}
      </div>
      {/* Current vs target, every mix key — a 0% row with a target IS the gap. */}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {data.byType.map((t) => {
          const off = Math.abs(t.gapPts) >= 5;
          return (
            <li key={t.key} className="flex items-center gap-2 text-[13px]">
              <span
                className="h-2.5 w-2.5 flex-none rounded-[3px]"
                style={{ background: typeColor(t.key) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-dim">{t.label}</span>
              {off && (
                <span className="flex-none rounded-full bg-[#f6efdf] px-2 py-px text-[11.5px] font-bold text-[#7a5712] dark:bg-[#38301a] dark:text-[#e2bd6b]">
                  {Math.abs(t.gapPts)} pts {t.gapPts > 0 ? 'under' : 'over'} target
                </span>
              )}
              <b className="flex-none font-mono text-foreground">{t.pct}%</b>
              <span className="flex-none font-mono text-[12px] text-faint">of {t.targetPct}%</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-2.5 min-[561px]:grid-cols-2">
        <SliceLegend title="By firm" slices={data.byPartner} />
        <SliceLegend title="By currency" slices={data.byCurrency} />
      </div>
    </div>
  );
}

/* ---------------------------------- Goals --------------------------------- */

export function GoalsDisplay({ data }: { data: GoalsDisplayData }) {
  return (
    <div>
      <span className={cn(UPPR, 'mb-2.5 block text-foreground')}>Your goals</span>
      {data.goals.length === 0 ? (
        <p className="m-0 text-[13px] text-dim">No goals set yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.goals.map((g) => (
            <div key={g.name}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <b className="text-[13.5px]">{g.name}</b>
                <span className="font-mono text-[12.5px] text-dim">
                  {g.current} <span className="text-faint">of {g.target}</span>
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, g.pct))}%` }}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-[12px]">
                <b className="font-mono text-teal2">{g.pct}% funded</b>
                {g.eta && <span className="text-faint">{g.eta}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Comparison ------------------------------- */

const COMPARE_TH =
  'border-0 border-b border-solid border-border bg-muted/60 px-2.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-[.4px] text-dim';
const COMPARE_TD =
  'border-0 border-b border-solid border-border/60 px-2.5 py-2 align-top [tr:last-child>&]:border-b-0';

export function ComparisonDisplay({ data }: { data: ComparisonDisplayData }) {
  const concerns = data.rows.filter((r) => r.topConcern);
  return (
    <div>
      <span className={cn(UPPR, 'mb-2.5 block text-foreground')}>Side by side</span>

      {/* Phone: stacked mini-cards. */}
      <div className="flex flex-col gap-2.5 min-[561px]:hidden">
        {data.rows.map((r) => (
          <div key={r.instrumentId} className="rounded-lg border border-solid border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <b className="min-w-0 text-[13.5px]">{r.name}</b>
              <RiskBadge risk={r.risk} />
            </div>
            <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
              {r.metric && (
                <div>
                  <dt className="text-faint">{r.metricLabel ?? 'Headline'}</dt>
                  <dd className="m-0 font-mono font-bold">{r.metric}</dd>
                </div>
              )}
              <div>
                <dt className="text-faint">Minimum</dt>
                <dd className="m-0 font-mono font-bold">{r.minimum}</dd>
              </div>
              {r.partner && (
                <div>
                  <dt className="text-faint">Firm</dt>
                  <dd className="m-0">{r.partner}</dd>
                </div>
              )}
              <div>
                <dt className="text-faint">Portfolio fit</dt>
                <dd className="m-0">
                  <Badge variant={fitVariant(r.fitScore)} className="font-mono">
                    {r.fitScore}
                  </Badge>
                </dd>
              </div>
            </dl>
            <div className="mt-2">
              {r.suitable ? (
                <Badge variant="success">Fits your band</Badge>
              ) : (
                <Badge variant="warning">Outside your band</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Wider screens: one aligned table, scrolling inside its own box. */}
      <div className="hidden overflow-x-auto rounded-lg border border-solid border-border min-[561px]:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={COMPARE_TH}>Name</th>
              <th className={COMPARE_TH}>Risk</th>
              <th className={COMPARE_TH}>Headline</th>
              <th className={COMPARE_TH}>Minimum</th>
              <th className={COMPARE_TH}>Firm</th>
              <th className={COMPARE_TH}>Fit</th>
              <th className={COMPARE_TH}>Suitable</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.instrumentId}>
                <td className={COMPARE_TD}>
                  <b>{r.name}</b>
                  {r.region && <div className="text-[11.5px] text-faint">{r.region}</div>}
                </td>
                <td className={COMPARE_TD}>
                  <RiskBadge risk={r.risk} />
                </td>
                <td className={cn(COMPARE_TD, 'whitespace-nowrap')}>
                  {r.metric ? (
                    <>
                      <b className="font-mono">{r.metric}</b>
                      {r.metricLabel && (
                        <div className="text-[11.5px] text-faint">{r.metricLabel}</div>
                      )}
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className={cn(COMPARE_TD, 'whitespace-nowrap font-mono')}>{r.minimum}</td>
                <td className={COMPARE_TD}>{r.partner ?? <span className="text-faint">—</span>}</td>
                <td className={COMPARE_TD}>
                  <Badge variant={fitVariant(r.fitScore)} className="font-mono">
                    {r.fitScore}
                  </Badge>
                </td>
                <td className={COMPARE_TD}>
                  {r.suitable ? (
                    <Badge variant="success">Yes</Badge>
                  ) : (
                    <Badge variant="warning">No</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {concerns.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[12px] leading-snug text-faint">
          {concerns.map((r) => (
            <li key={r.instrumentId}>
              <b className="text-dim">{r.name}:</b> {r.topConcern}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------- Fit ---------------------------------- */

export function FitDisplay({ data }: { data: FitDisplayData }) {
  return (
    <div>
      <span className={cn(UPPR, 'mb-2.5 block text-foreground')}>Portfolio fit</span>
      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            'grid h-14 w-14 flex-none place-items-center rounded-2xl font-mono text-lg font-bold',
            fitTileClasses(data.score),
          )}
        >
          {data.score}
        </span>
        <div className="min-w-0">
          <b className="text-[14.5px]">{data.name}</b>
          <div className="text-[12.5px] leading-snug text-faint">
            Fit score out of a hundred — how this sits beside what you already hold
          </div>
        </div>
      </div>
      {data.reasons.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[.4px] text-success-ink">
            Works for you
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-snug text-dim">
            {data.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {data.concerns.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[.4px] text-[#7a5712] dark:text-[#e2bd6b]">
            Worth weighing
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-snug text-dim">
            {data.concerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Trace --------------------------------- */

const STAGE_ICON: Record<string, LucideIcon> = {
  research: Search,
  fit: Scale,
  suitability: ShieldCheck,
  coordination: Route,
};

/** "research confidence 82/100" or "Name: fit 90/100 — ..." inside a trace line. */
const TRACE_SCORE = /(?:research confidence|fit) (\d+)\/100/;

export interface TraceScore {
  label: string;
  score: number;
}

/**
 * Pull the research/fit scores out of a trace's free-text lines for a chip
 * row. Best-effort by design: a trace from before the scores existed simply
 * yields no chips. Where a stage scored several candidates, the strongest
 * number stands in for the stage.
 */
export function extractTraceScores(trace: TraceStageDisplay[]): TraceScore[] {
  const best = new Map<string, number>();
  for (const stage of trace) {
    for (const line of [stage.summary, ...stage.detail]) {
      const match = TRACE_SCORE.exec(line);
      if (!match) continue;
      const score = Number(match[1]);
      if (!Number.isFinite(score)) continue;
      const label = match[0].startsWith('research') ? 'Research confidence' : 'Fit';
      const prev = best.get(label);
      if (prev === undefined || score > prev) best.set(label, score);
    }
  }
  return [...best.entries()].map(([label, score]) => ({ label, score }));
}

export function TraceDisplay({ trace }: { trace: TraceStageDisplay[] }) {
  if (trace.length === 0) return null;
  const scores = extractTraceScores(trace);
  return (
    <div>
      {scores.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {scores.map((s) => (
            <Badge key={s.label} variant={fitVariant(s.score)} className="font-mono">
              {s.label} {s.score}
            </Badge>
          ))}
        </div>
      )}
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {trace.map((s, i) => {
          const Icon = STAGE_ICON[s.stage];
          return (
            <li key={`${s.stage}-${s.agent}`} className="flex items-start gap-2.5">
              <span className="mt-px grid h-6 w-6 flex-none place-items-center rounded-[7px] bg-mint text-teal2">
                {Icon ? (
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <span className="font-mono text-[11px] font-bold">{i + 1}</span>
                )}
              </span>
              <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                <b className="text-foreground">
                  {i + 1}. {s.agent}
                </b>{' '}
                <span className="text-dim">{s.summary}</span>
                {s.detail.length > 0 && (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-[12px] font-semibold text-teal2">
                      {s.detail.length === 1 ? 'One detail' : `${s.detail.length} details`}
                    </summary>
                    <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-4 text-faint">
                      {s.detail.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PipelineDisplay({ data }: { data: PipelineDisplayData }) {
  return (
    <div>
      <span className={cn(UPPR, 'mb-2.5 block text-foreground')}>How this run went</span>
      <TraceDisplay trace={data.trace} />
      {data.proposal ? (
        <p className="m-0 mt-2.5 rounded-lg bg-mint/60 px-3 py-2 text-[12.5px] leading-snug text-foreground dark:bg-white/[0.05]">
          Prepared: <b>{data.proposal.name}</b> ·{' '}
          <b className="font-mono">{data.proposal.amount}</b>
          {data.proposal.partner && <> — via {data.proposal.partner}</>}
          {data.proposal.decision === 'requires_approval' && '. Waiting on your approval.'}
        </p>
      ) : (
        <p className="m-0 mt-2.5 text-[12.5px] text-faint">
          No candidate cleared the bar this run, so nothing was prepared.
        </p>
      )}
    </div>
  );
}

/* -------------------------------- Switcher -------------------------------- */

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-solid border-border bg-card p-3.5">
      {children}
    </div>
  );
}

/** One display event → one inline card. Exhaustive over the known kinds. */
export function AgentDisplayCard({ display }: { display: AgentDisplayData }) {
  switch (display.kind) {
    case 'allocation':
      return (
        <Shell>
          <AllocationDisplay data={display.data} />
        </Shell>
      );
    case 'goals':
      return (
        <Shell>
          <GoalsDisplay data={display.data} />
        </Shell>
      );
    case 'comparison':
      return (
        <Shell>
          <ComparisonDisplay data={display.data} />
        </Shell>
      );
    case 'fit':
      return (
        <Shell>
          <FitDisplay data={display.data} />
        </Shell>
      );
    case 'pipeline':
      return (
        <Shell>
          <PipelineDisplay data={display.data} />
        </Shell>
      );
  }
}
