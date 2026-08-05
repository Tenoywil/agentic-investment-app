import type { CSSProperties, ReactNode } from 'react';

/** CCN "Warm" palette + type families, from the prototype (index.html / demo assets). */
export const C = {
  bg: '#efece4',
  card: '#fdfcfa',
  card2: '#fbfaf6',
  ink: '#1e1c19',
  dim: '#5c5449',
  faint: '#675d4d' /* darkened from #8a8172 to clear 4.5:1 on cream + card (WCAG 1.4.3) */,
  line: '#e4e0d6',
  teal: '#124e48',
  teal2: '#0e5952',
  tealInk: '#eafaf5',
  mint: '#e8f1ec',
  gold: '#e6b450' /* brightened so gold-on-teal highlights clear 4.5:1 */,
  terra: '#c56a3e',
  peach: '#f0b98d',
  peachBg: '#f9ede2',
  peachLine: '#e7c3ab',
  green: '#0a8f5b',
  disp: "'Bricolage Grotesque', sans-serif",
  body: "'Hanken Grotesk', sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

export function Icon({
  path,
  size = 21,
  stroke = 'currentColor',
  sw = 1.9,
}: {
  path: ReactNode;
  size?: number;
  stroke?: string;
  sw?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

export const icons = {
  home: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  portfolio: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </>
  ),
  opportunities: <path d="M3 17l6-6 4 4 8-8M21 7v5M21 7h-5" />,
  agent: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  planning: (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M9.3 12l1.9 1.9 3.6-3.9" />
    </>
  ),
  onboarding: (
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6" />
  ),
  institutions: <path d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-6h6v6" />,
  bell: <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  ),
};

export const chip = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '9px 16px',
  borderRadius: 999,
  border: `1px solid ${active ? C.teal : C.line}`,
  background: active ? C.teal : C.card,
  color: active ? '#fff' : C.dim,
  fontFamily: C.body,
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
});
