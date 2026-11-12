'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ACCOUNT_TABS = [
  { href: '/account', label: 'Overview', exact: true },
  { href: '/account/usage', label: 'Usage & Quotas', exact: false },
  { href: '/account/billing', label: 'Billing & Credits', exact: false },
  { href: '/account/history', label: 'Search History', exact: false },
  { href: '/account/privacy', label: 'Data & Privacy', exact: false },
] as const;

export function AccountNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop Vertical Rail */}
      <nav className="hidden space-y-1 lg:block" aria-label="Account Tabs">
        {ACCOUNT_TABS.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center justify-between border px-4 py-3 font-mono text-xs tracking-wider uppercase transition-colors ${
                isActive
                  ? 'border-accent bg-accent/10 text-accent font-bold shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'border-border-hairline bg-surface text-muted-foreground hover:border-foreground/40 hover:text-foreground'
              }`}
            >
              <span>{tab.label}</span>
              <span className="text-muted-foreground text-[10px]">›</span>
            </Link>
          );
        })}
      </nav>

      {/* Mobile Horizontally Scrolling Tab Strip */}
      <nav
        className="border-border-hairline bg-surface scrollbar-none flex gap-1 overflow-x-auto border-b p-1 lg:hidden"
        aria-label="Account Mobile Tabs"
      >
        {ACCOUNT_TABS.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 border px-3 py-2 font-mono text-[11px] tracking-wide whitespace-nowrap uppercase transition-colors ${
                isActive
                  ? 'border-accent bg-accent/10 text-accent font-bold'
                  : 'border-border-hairline text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
