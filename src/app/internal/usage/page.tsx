import type { Metadata } from 'next';
import { InternalRefreshButton } from '@/app/internal/_components/internal-refresh-button';
import { loadUsageDashboardData } from '@/services/internal/usage-dashboard';
import { UsageDashboardClient } from './usage-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Usage & Quotas Dashboard | RECSY Internal',
  description:
    'Platform admission telemetry, daily quota gauge, flag controls, and abuse blocking.',
};

export default async function InternalUsagePage() {
  const data = await loadUsageDashboardData();

  return (
    <div className="space-y-6">
      <header className="border-border-hairline flex flex-wrap items-center justify-between gap-4 border-b p-6 lg:p-8">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Internal Operations
          </div>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Usage & Quotas Telemetry
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Live query throughput, cap rungs, platform flags, and abuse management.
          </p>
        </div>
        <InternalRefreshButton />
      </header>

      <UsageDashboardClient initialData={data} />
    </div>
  );
}
