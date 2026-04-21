import Link from 'next/link';

import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

/**
 * Top-level app header. Stays thin on mobile (48px) and expands on desktop.
 * The translucent backdrop uses `backdrop-blur` so hero content shows through
 * on scroll.
 */
export function AppHeader() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 w-full border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          aria-label="RECSY home"
          className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Logo />
          <span className="text-muted-foreground text-xs tracking-widest uppercase">v2</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-4">
          <Link
            href="/browse"
            className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors sm:inline-flex"
          >
            Browse
          </Link>
          <Link
            href="/about"
            className="text-muted-foreground hover:text-foreground hidden text-sm transition-colors sm:inline-flex"
          >
            About
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
