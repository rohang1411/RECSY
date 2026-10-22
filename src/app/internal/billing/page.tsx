import type { Metadata } from 'next';
import { InternalRefreshButton } from '@/app/internal/_components/internal-refresh-button';
import { loadBillingDashboardData } from '@/services/internal/billing-dashboard';
import { BillingDashboardClient } from './billing-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Billing & Account Operations | RECSY Internal',
  description: 'Revenue telemetry, active subscriptions, customer lookup, and credit adjustments.',
};

export default async function InternalBillingPage() {
  const data = await loadBillingDashboardData();

  return (
    <div className="space-y-6">
      <header className="border-border-hairline flex flex-wrap items-center justify-between gap-4 border-b p-6 lg:p-8">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Internal Operations
          </div>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">Billing & Accounts</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Revenue telemetry, subscriber health, user auditing, and credit dispute resolution.
          </p>
        </div>
        <InternalRefreshButton />
      </header>

      <BillingDashboardClient initialData={data} />
    </div>
  );
}
