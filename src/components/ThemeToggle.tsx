'use client';

/**
 * Accessible light/dark toggle.
 *
 * Avoids the classic "hydration mismatch" bug by rendering a neutral skeleton
 * on the server and only painting the current-theme icon after mount.
 */
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes requires a post-mount flag to avoid a hydration mismatch
  // between SSR (no theme known) and the first client paint. This is the
  // library's canonical pattern; cascading renders are bounded to one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe mount detection
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : true;
  const nextTheme = isDark ? 'light' : 'dark';

  return (
    <button
      type="button"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={isDark}
      onClick={() => setTheme(nextTheme)}
      className={cn(
        'border-border bg-card hover:bg-secondary inline-flex size-9 items-center justify-center rounded-md border transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        className,
      )}
    >
      {/* Render both icons so the layout is stable; fade between them. */}
      <Sun
        className={cn(
          'size-4 transition-all',
          isDark ? 'scale-0 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
        )}
      />
      <Moon
        className={cn(
          'absolute size-4 transition-all',
          isDark ? 'scale-100 rotate-0 opacity-100' : 'scale-0 rotate-90 opacity-0',
        )}
      />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
