'use client';

import { cn } from '@/app/_lib/utils';
import { type PartnerMarkInfo, getPartnerMarks, partnerLogoUrl } from '@/lib/portfolio-api';
import * as React from 'react';

/**
 * A partner institution's brand mark, one component for every screen.
 *
 * When the firm has uploaded a real logo (`id && hasLogo`) it renders the
 * bytes from /api/portfolio/partner-logo/:id in a bordered tile; otherwise a
 * monogram tile — the firm's 2-3 letter code (or initials derived from its
 * name) on the firm's own brand color with a tint ring. When the record
 * carries no colors, a stable hue is derived from the name, so the same firm
 * gets the same mark on every screen and every visit — deterministic, never
 * random.
 *
 * Purely presentational: it never fetches. Screens that want the network's
 * real marks load them once via `usePartnerMarks()` (backed by the module
 * cache in lib/portfolio-api) and pass the matching entry's fields in.
 * Unauthenticated surfaces (the landing page) use it with just a name/code
 * and get the deterministic monogram.
 */

export type PartnerMarkSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<PartnerMarkSize, string> = {
  sm: 'h-[22px] w-[22px] rounded-md text-[9px]',
  md: 'h-10 w-10 rounded-[10px] text-xs',
  lg: 'h-14 w-14 rounded-xl text-sm',
};

const LOGO_PAD: Record<PartnerMarkSize, string> = {
  sm: 'p-[2px]',
  md: 'p-1',
  lg: 'p-1.5',
};

/** Stable, unsigned 32-bit hash of a name — the seed for the derived hue. */
function hashName(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** The graceful default: a hue owned by this name forever. Saturation and
 *  lightness are fixed in the warm palette's range so white monogram text
 *  clears contrast on every derived color. */
function derivedColors(name: string): { color: string; tint: string } {
  const hue = hashName(name) % 360;
  return {
    color: `hsl(${hue} 42% 34%)`,
    tint: `hsl(${hue} 38% 82%)`,
  };
}

/** "NCB Capital Markets" -> "NCM"; "Sagicor" -> "SA". */
function initials(name: string): string {
  const words = name
    .split(/[\s·-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => Array.from(w)[0] ?? '')
      .join('')
      .toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function PartnerMark({
  name,
  code,
  id,
  hasLogo,
  color,
  tint,
  size = 'md',
  className,
  logoUrl,
}: {
  name: string;
  code?: string | null;
  id?: string | null;
  hasLogo?: boolean;
  /** CSS color strings from the partner record; null/undefined = derive. */
  color?: string | null;
  tint?: string | null;
  size?: PartnerMarkSize;
  className?: string;
  /** Where the logo bytes live. Defaults to the authenticated portfolio
   *  endpoint; unauthenticated surfaces (the landing) pass the public one. */
  logoUrl?: string;
}) {
  // A logo that 404s (cleared between list load and render) falls back to the
  // monogram rather than a broken-image glyph.
  const [logoFailed, setLogoFailed] = React.useState(false);
  const showLogo = Boolean(id && hasLogo && !logoFailed);

  if (showLogo && id) {
    return (
      <span
        className={cn(
          'grid flex-none place-items-center overflow-hidden border border-solid border-border bg-card',
          SIZE_CLASS[size],
          className,
        )}
      >
        {/* Bytes come from the API with the firm's own content-type; alt is the
            firm's name so the mark reads as the firm to a screen reader. */}
        <img
          src={logoUrl ?? partnerLogoUrl(id)}
          alt={name}
          className={cn('h-full w-full object-contain', LOGO_PAD[size])}
          onError={() => setLogoFailed(true)}
        />
      </span>
    );
  }

  const fallback = derivedColors(name);
  const bg = color || fallback.color;
  const ring = tint || fallback.tint;
  const mono = (code || initials(name)).slice(0, 3).toUpperCase();

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'grid flex-none place-items-center font-mono font-bold text-white',
        SIZE_CLASS[size],
        className,
      )}
      style={{ background: bg, boxShadow: `0 0 0 1.5px ${ring}` }}
    >
      <span aria-hidden>{mono}</span>
    </span>
  );
}

/**
 * The network's marks, loaded once (module-cached) and shared. Returns null
 * until they arrive; a failed read stays null and the screen simply keeps its
 * derived monograms — the mark list is decoration, never a blocker.
 */
export function usePartnerMarks(): PartnerMarkInfo[] | null {
  const [marks, setMarks] = React.useState<PartnerMarkInfo[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    getPartnerMarks()
      .then((m) => {
        if (!cancelled) setMarks(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return marks;
}

/** Find the mark for a partner referenced by code or (display) name. */
export function markFor(
  marks: PartnerMarkInfo[] | null,
  ref: { code?: string | null; name?: string | null },
): PartnerMarkInfo | undefined {
  if (!marks) return undefined;
  if (ref.code) {
    const byCode = marks.find((m) => m.code === ref.code);
    if (byCode) return byCode;
  }
  if (ref.name) return marks.find((m) => m.name === ref.name);
  return undefined;
}
