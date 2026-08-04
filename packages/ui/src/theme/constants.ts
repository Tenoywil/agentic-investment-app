/** Pure, framework-free theme constants and helpers (unit-tested). */

export const UI_SCALES = ['base', 'lg', 'xl', 'xxl'] as const;
export type UiScale = (typeof UI_SCALES)[number];

export const SCALE_LABELS: Record<UiScale, string> = {
  base: 'Comfortable',
  lg: 'Large',
  xl: 'Larger',
  xxl: 'Largest',
};

/** Root font-size multiplier (× the browser's own default). Comfortable = 18px. */
export const SCALE_FACTOR: Record<UiScale, number> = {
  base: 1.125,
  lg: 1.25,
  xl: 1.375,
  xxl: 1.5,
};

export const THEMES = ['light', 'dark', 'system'] as const;
export type ThemeChoice = (typeof THEMES)[number];

export const CONTRASTS = ['normal', 'high'] as const;
export type Contrast = (typeof CONTRASTS)[number];

export const STORAGE_KEYS = {
  scale: 'ccn.uiScale',
  theme: 'ccn.theme',
  contrast: 'ccn.contrast',
} as const;

export function isUiScale(value: unknown): value is UiScale {
  return typeof value === 'string' && (UI_SCALES as readonly string[]).includes(value);
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function isContrast(value: unknown): value is Contrast {
  return typeof value === 'string' && (CONTRASTS as readonly string[]).includes(value);
}

/** Resolve the effective light/dark theme from a choice + the OS preference. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
}
