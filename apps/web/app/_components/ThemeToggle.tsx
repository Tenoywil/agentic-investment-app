'use client';

import { Button } from '@/app/_components/ui/button';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Toggles the CCN Warm theme between light and dark. The theme is applied before
 * first paint by the inline bootstrap in layout.tsx; this control just flips the
 * `dark` class on <html> and persists the choice. Renders a stable placeholder
 * until mounted so server and client markup agree.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('ccn-theme', next ? 'dark' : 'light');
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={mounted ? dark : undefined}
      aria-label={mounted && dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={className}
    >
      {mounted && dark ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
    </Button>
  );
}
