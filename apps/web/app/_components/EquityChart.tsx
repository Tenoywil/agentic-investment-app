'use client';

import { cn } from '@/app/_lib/utils';
import { LineChart } from 'lucide-react';

/**
 * The equity-over-time chart, one component for both surfaces: the investor's
 * "your money over time" and the console's "held by your clients over time".
 *
 * Layout only — every figure it draws arrives through `points`, and every
 * money string it prints comes back from the caller's `fmt`. There are no
 * data literals here, no currency symbols, and no invented copy about what
 * the line means: the empty-state wording differs per surface, so it rides in
 * as a prop.
 *
 * Geometry and text are split deliberately. The plot is an SVG stretched to
 * the container (viewBox 0-100 with `preserveAspectRatio="none"`), which
 * would distort glyphs — so the line uses `vectorEffect="non-scaling-stroke"`
 * and everything readable (labels, the latest-point dot and its value) is
 * HTML positioned at the same percentage coordinates. Text stays crisp at any
 * width; the shape flexes underneath it.
 */

export interface EquityPoint {
  /** X label, e.g. an ISO day "2026-08-16" or "now". */
  label: string;
  /** The recorded value in minor units. Strings pass through to `fmt` as-is. */
  valueMinor: bigint | string;
}

/** Vertical padding of the plot, in viewBox percent: the line never touches
 *  the top or bottom edge, leaving room for the min/max reference rules. */
const Y_TOP = 8;
const Y_BOT = 92;

function minorString(v: bigint | string): string {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function EquityChart({
  points,
  fmt,
  emptyNote,
  singleNote = 'One day recorded. The line begins tomorrow.',
  className,
}: {
  points: EquityPoint[];
  /** Formats a minor-unit string for display. Money never gets formatted in
   *  here — the caller knows the currency; this component does not. */
  fmt: (valueMinor: string) => string;
  /** Zero-history wording, per surface. */
  emptyNote: string;
  /** One-day wording; the default reads the same on both surfaces. */
  singleNote?: string;
  className?: string;
}) {
  if (points.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-card/40 px-6 py-8 text-center',
          className,
        )}
      >
        <LineChart className="h-5 w-5 text-dim" aria-hidden />
        <p className="m-0 max-w-[42ch] text-[13.5px] leading-relaxed text-dim">{emptyNote}</p>
      </div>
    );
  }

  const values = points.map((p) => Number(minorString(p.valueMinor)));
  let minAt = 0;
  let maxAt = 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as number;
    if (v < (values[minAt] as number)) minAt = i;
    if (v > (values[maxAt] as number)) maxAt = i;
  }
  const min = values[minAt] as number;
  const max = values[maxAt] as number;
  const span = max - min;

  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => (span === 0 ? 50 : Y_TOP + ((max - v) / span) * (Y_BOT - Y_TOP));

  const first = points[0] as EquityPoint;
  const latest = points[points.length - 1] as EquityPoint;
  const latestX = x(points.length - 1);
  const latestY = y(values[values.length - 1] as number);
  const latestValue = fmt(minorString(latest.valueMinor));

  const linePath = points
    .map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(values[i] as number).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L100 100 L0 100 Z`;

  return (
    <div className={className}>
      {/* What a screen reader gets instead of the drawing. */}
      <p className="sr-only">
        {points.length === 1
          ? `${latest.label}: ${latestValue}. ${singleNote}`
          : `From ${fmt(minorString(first.valueMinor))} on ${first.label} to ${latestValue} on ${latest.label}.`}
      </p>

      <div className="relative" aria-hidden>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="block h-36 w-full"
          role="presentation"
        >
          {/* Reference rules at the min/max the labels name. */}
          {span > 0 && (
            <>
              <line
                x1="0"
                x2="100"
                y1={Y_TOP}
                y2={Y_TOP}
                stroke="hsl(var(--border))"
                strokeWidth="1"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="0"
                x2="100"
                y1={Y_BOT}
                y2={Y_BOT}
                stroke="hsl(var(--border))"
                strokeWidth="1"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {points.length > 1 && (
            <>
              <path d={areaPath} fill="hsl(var(--teal2) / 0.12)" stroke="none" />
              <path
                d={linePath}
                fill="none"
                stroke="hsl(var(--teal2))"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* The latest point: a dot with its value, in HTML so neither warps
            with the stretched SVG underneath. */}
        <span
          className="absolute h-2.5 w-2.5 rounded-full bg-teal2 ring-2 ring-card"
          style={{
            left: `${latestX}%`,
            top: `${latestY}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
        <span
          className="absolute whitespace-nowrap font-mono text-[11.5px] font-bold text-teal2"
          style={{
            left: `${latestX}%`,
            top: `${latestY}%`,
            // Above the dot normally; below it when the dot is near the top.
            transform:
              latestY < 30
                ? `translate(${points.length === 1 ? '-50%' : '-100%'}, 10px)`
                : `translate(${points.length === 1 ? '-50%' : '-100%'}, -170%)`,
          }}
        >
          {latestValue}
        </span>

        {/* Min/max y labels, on the reference rules. Omitted for a flat or
            single-point series, where they would repeat the dot's own value. */}
        {span > 0 && (
          <>
            <span className="absolute left-0 top-0 -translate-y-1/2 rounded bg-card/80 pr-1 font-mono text-[10.5px] text-faint">
              {fmt(minorString((points[maxAt] as EquityPoint).valueMinor))}
            </span>
            <span className="absolute bottom-0 left-0 translate-y-1/2 rounded bg-card/80 pr-1 font-mono text-[10.5px] text-faint">
              {fmt(minorString((points[minAt] as EquityPoint).valueMinor))}
            </span>
          </>
        )}
      </div>

      {/* First and last x labels. One centered label for a single day. */}
      <div
        className={cn(
          'mt-1.5 flex text-[11px] text-faint',
          points.length === 1 ? 'justify-center' : 'justify-between',
        )}
        aria-hidden
      >
        {points.length > 1 && <span>{first.label}</span>}
        <span>{latest.label}</span>
      </div>

      {points.length === 1 && (
        <p className="mb-0 mt-2 text-center text-[12.5px] text-dim">{singleNote}</p>
      )}
    </div>
  );
}
