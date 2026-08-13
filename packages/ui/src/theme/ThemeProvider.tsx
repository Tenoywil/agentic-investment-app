import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  type Contrast,
  STORAGE_KEYS,
  type ThemeChoice,
  type UiScale,
  isContrast,
  isThemeChoice,
  isUiScale,
  resolveTheme,
} from './constants';

interface ThemeState {
  scale: UiScale;
  theme: ThemeChoice;
  contrast: Contrast;
  setScale: (s: UiScale) => void;
  setTheme: (t: ThemeChoice) => void;
  setContrast: (c: Contrast) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function read<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  return guard(raw) ? raw : fallback;
}

function prefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<UiScale>(() =>
    read(STORAGE_KEYS.scale, isUiScale, 'base'),
  );
  const [theme, setThemeState] = useState<ThemeChoice>(() =>
    read(STORAGE_KEYS.theme, isThemeChoice, 'system'),
  );
  const [contrast, setContrastState] = useState<Contrast>(() =>
    read(STORAGE_KEYS.contrast, isContrast, 'normal'),
  );

  // Apply to <html> and persist whenever a value changes.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', resolveTheme(theme, prefersDark()));
    el.setAttribute('data-contrast', contrast);
    if (scale === 'base') el.removeAttribute('data-ui-scale');
    else el.setAttribute('data-ui-scale', scale);
  }, [scale, theme, contrast]);

  // Follow the OS theme live while the choice is "system".
  useEffect(() => {
    if (theme !== 'system' || typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () =>
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setScale = useCallback((s: UiScale) => {
    setScaleState(s);
    localStorage.setItem(STORAGE_KEYS.scale, s);
  }, []);
  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEYS.theme, t);
  }, []);
  const setContrast = useCallback((c: Contrast) => {
    setContrastState(c);
    localStorage.setItem(STORAGE_KEYS.contrast, c);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ scale, theme, contrast, setScale, setTheme, setContrast }),
    [scale, theme, contrast, setScale, setTheme, setContrast],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}
