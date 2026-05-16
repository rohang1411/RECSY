import Link from 'next/link';

const navItems = [
  { href: '/recommend', label: 'Recommend' },
  { href: '/browse', label: 'Browse' },
  { href: '/compare', label: 'Compare' },
  { href: '/about', label: 'About' },
  { href: '/settings', label: 'Settings' },
] as const;

export function AppHeader() {
  return (
    <header className="border-outline-variant bg-background/95 sticky top-0 z-40 w-full border-b backdrop-blur">
      <div className="px-grid-margin flex min-h-16 items-center justify-between gap-8">
        <Link
          href="/"
          aria-label="RECSY home"
          className="font-display text-primary text-2xl font-extrabold tracking-normal uppercase focus-visible:outline-none"
        >
          RECSY_v2
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:border-accent hover:text-primary focus-visible:border-accent focus-visible:text-primary border-b border-transparent py-2 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors duration-150 focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="from-accent/80 hidden h-px w-12 bg-gradient-to-r to-transparent md:block" />
      </div>
      <nav
        aria-label="Primary mobile"
        className="border-outline-variant px-grid-margin text-muted-foreground flex items-center gap-4 overflow-x-auto border-t py-2 font-mono text-[10px] tracking-[0.16em] uppercase md:hidden"
      >
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="hover:text-primary shrink-0">
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
