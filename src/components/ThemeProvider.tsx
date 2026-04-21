'use client';

/**
 * Wraps `next-themes` with our RECSY defaults.
 *
 * - `attribute="data-theme"` — our design tokens key off `[data-theme=...]`.
 * - `defaultTheme="dark"`    — dark is the canonical look; light is opt-in.
 * - `enableSystem`           — respect OS preference before user override.
 * - `disableTransitionOnChange` — prevents FOUC flashes when toggling.
 */
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="recsy-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
