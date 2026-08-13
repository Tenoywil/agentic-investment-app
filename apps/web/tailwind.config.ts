import type { Config } from 'tailwindcss';

/**
 * Tailwind themed to the CCN "Warm" palette (see globals.css :root). Preflight is
 * OFF: the app is migrating to shadcn incrementally, and disabling Tailwind's
 * reset keeps the not-yet-migrated, inline-styled screens visually untouched.
 * shadcn primitives always name their border/background colors explicitly, so
 * they render correctly without preflight.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    container: { center: true, padding: '1.5rem', screens: { '2xl': '1200px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        // CCN Warm extras — the palette the screens speak in.
        teal2: 'hsl(var(--teal2) / <alpha-value>)',
        mint: 'hsl(var(--mint) / <alpha-value>)',
        terra: 'hsl(var(--terra) / <alpha-value>)',
        'terra-ink': 'hsl(var(--terra-ink) / <alpha-value>)',
        peach: 'hsl(var(--peach) / <alpha-value>)',
        gold: 'hsl(var(--gold) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        'success-ink': 'hsl(var(--success-ink) / <alpha-value>)',
        dim: 'hsl(var(--dim) / <alpha-value>)',
        faint: 'hsl(var(--faint) / <alpha-value>)',
        navy: {
          DEFAULT: 'hsl(var(--navy) / <alpha-value>)',
          active: 'hsl(var(--navy-active) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        display: ['Bricolage Grotesque', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
