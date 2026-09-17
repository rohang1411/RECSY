'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Database,
  GitBranch,
  Layers,
  Sparkles,
  Search,
  Scale,
  RefreshCw,
} from 'lucide-react';

const INTERNAL_LINKS = [
  {
    label: 'Command Center',
    href: '/internal/command-center',
    icon: Activity,
    badge: 'Overview',
  },
  {
    label: 'Database Dashboard',
    href: '/internal/database',
    icon: Database,
    badge: 'Catalog',
  },
  {
    label: 'Lifecycle Explorer',
    href: '/internal/lifecycle',
    icon: Layers,
    badge: 'Device Probe',
  },
  {
    label: 'Pipeline Runs & Logs',
    href: '/internal/pipelines',
    icon: GitBranch,
    badge: 'Telemetry',
  },
] as const;

const APP_LINKS = [
  { label: 'Recommend', href: '/recommend', icon: Sparkles },
  { label: 'Browse', href: '/browse', icon: Search },
  { label: 'Compare', href: '/compare', icon: Scale },
] as const;

export function InternalNav() {
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setPendingHref(null);
  }

  const isCurrent = (href: string) => {
    if (href === '/internal/command-center') {
      return (
        pathname === '/internal' ||
        pathname === '/internal/command-center' ||
        pathname === '/internal/pipeline'
      );
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="border-outline-variant bg-background sticky top-0 hidden h-dvh w-64 shrink-0 border-r lg:flex lg:flex-col">
      <div className="border-outline-variant border-b p-6">
        <div className="flex items-center justify-between">
          <p className="text-primary font-mono text-sm font-bold tracking-[0.14em] uppercase">
            Command Center
          </p>
          <span className="status-dot text-accent" data-state="running" />
        </div>
        <p className="text-muted-foreground mt-2 font-mono text-xs tracking-[0.12em]">
          RECSY v2.0.4 / Operational
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 font-mono text-xs tracking-[0.12em] uppercase">
        <p className="text-muted-foreground/60 mb-3 px-3 text-[10px] tracking-[0.18em]">
          Core Workspaces
        </p>
        <div className="space-y-1">
          {INTERNAL_LINKS.map(({ label, href, icon: Icon, badge }) => {
            const active = isCurrent(href);
            const isPending = pendingHref === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  if (!active) setPendingHref(href);
                }}
                className={`flex items-center justify-between border px-3 py-2.5 transition-colors ${
                  active
                    ? 'border-primary bg-primary text-background font-semibold'
                    : isPending
                      ? 'border-accent bg-accent/15 text-accent font-semibold'
                      : 'hover:border-accent hover:text-primary text-muted-foreground border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {isPending ? (
                    <RefreshCw className="text-accent size-4 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="size-4 shrink-0" aria-hidden />
                  )}
                  <span>{label}</span>
                </div>
                <span
                  className={`border px-1.5 py-0.5 text-[9px] ${
                    active
                      ? 'border-background/40 bg-background/20 text-background'
                      : isPending
                        ? 'border-accent/50 bg-accent/20 text-accent animate-pulse font-bold'
                        : 'border-outline-variant text-muted-foreground'
                  }`}
                >
                  {isPending ? 'Syncing...' : badge}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="border-outline-variant my-6 border-t pt-5">
          <p className="text-muted-foreground/60 mb-3 px-3 text-[10px] tracking-[0.18em]">
            Public App
          </p>
          <div className="space-y-1">
            {APP_LINKS.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="hover:border-accent hover:text-primary text-muted-foreground flex items-center gap-2.5 border border-transparent px-3 py-2 transition-colors"
              >
                <Icon className="text-accent/80 size-3.5 shrink-0" aria-hidden />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <div className="border-outline-variant text-muted-foreground border-t p-4 font-mono text-[11px]">
        <div className="flex items-center justify-between">
          <span>Postgres DB</span>
          <span className="text-accent font-semibold">Active</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>Gemini Rail</span>
          <span className="font-semibold text-[#39ff88]">Dual-Rail</span>
        </div>
      </div>
    </aside>
  );
}

export function InternalMobileHeader() {
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setPendingHref(null);
  }

  return (
    <header className="border-outline-variant bg-background/95 sticky top-0 z-40 flex flex-col border-b backdrop-blur lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="status-dot text-accent" data-state="running" />
          <span className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
            RECSY Command Center
          </span>
        </div>
        <span className="border-outline-variant text-muted-foreground border px-2 py-0.5 font-mono text-[10px]">
          v2.0.4
        </span>
      </div>
      <nav className="border-outline-variant scrollbar-none flex overflow-x-auto border-t px-2 py-1.5 font-mono text-[11px] uppercase">
        {INTERNAL_LINKS.map(({ label, href }) => {
          const active =
            href === '/internal/command-center'
              ? pathname === '/internal' ||
                pathname === '/internal/command-center' ||
                pathname === '/internal/pipeline'
              : pathname.startsWith(href);
          const isPending = pendingHref === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => {
                if (!active) setPendingHref(href);
              }}
              className={`flex shrink-0 items-center gap-1.5 border px-3 py-1.5 transition-colors ${
                active
                  ? 'border-primary bg-primary text-background font-semibold'
                  : isPending
                    ? 'border-accent bg-accent/15 text-accent font-semibold'
                    : 'text-muted-foreground hover:text-primary border-transparent'
              }`}
            >
              {isPending ? (
                <RefreshCw className="text-accent size-3 shrink-0 animate-spin" />
              ) : null}
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
