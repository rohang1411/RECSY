import { Cpu, Database, GitCompare, MessageSquareText, Settings2 } from 'lucide-react';
import Link from 'next/link';

import { StatusIndicator } from '@/components/ui/status-indicator';
import { cn } from '@/lib/utils';

const links = [
  { href: '/recommend', label: 'Recommend', icon: Cpu },
  { href: '/browse', label: 'Browse', icon: Database },
  { href: '/compare', label: 'Compare', icon: GitCompare },
  { href: '/about', label: 'About', icon: MessageSquareText },
  { href: '/settings', label: 'Settings', icon: Settings2 },
] as const;

export function SideNav({ active }: { readonly active?: string }) {
  return (
    <aside className="border-outline-variant bg-background sticky top-0 hidden h-dvh w-64 shrink-0 border-r lg:flex lg:flex-col">
      <div className="border-outline-variant border-b p-6">
        <p className="font-display text-primary text-2xl font-extrabold tracking-normal uppercase">
          RECSY
        </p>
        <div className="mt-6 space-y-2 font-mono text-[11px] tracking-[0.16em] uppercase">
          <p className="text-muted-foreground">System status</p>
          <p className="text-primary inline-flex items-center gap-2">
            <StatusIndicator />
            Ready
          </p>
        </div>
      </div>

      <nav className="border-outline-variant flex-1 border-b p-4" aria-label="Workspace">
        {links.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'mb-1 flex items-center gap-3 px-3 py-3 font-mono text-[12px] tracking-[0.12em] uppercase transition-colors duration-150',
                isActive
                  ? 'bg-primary text-background'
                  : 'text-muted-foreground hover:bg-surface-container-high hover:text-primary',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4">
        <Link
          href="/recommend"
          className="border-outline text-primary hover:bg-primary hover:text-background block border px-3 py-3 text-center font-mono text-[11px] tracking-[0.18em] uppercase transition-colors duration-150"
        >
          New recommendation
        </Link>
      </div>
    </aside>
  );
}
