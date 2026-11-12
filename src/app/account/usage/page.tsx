'use client';

import React, { useEffect, useState } from 'react';
import { UsageStrip, type DayUsage } from '@/components/billing/UsageStrip';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';

interface LeaseRecord extends Record<string, unknown> {
  id?: string;
  ref?: string;
  createdAt?: string;
  at?: string;
  route: string;
  chargeSource?: string;
  source?: string;
  status?: string;
  outcome?: string;
  reason?: string;
  model?: string;
  costMicros?: number;
}

const LEASE_COLUMNS: DataTableColumn<LeaseRecord>[] = [
  {
    key: 'createdAt',
    header: 'Timestamp',
    className: 'font-mono text-xs text-muted-foreground whitespace-nowrap',
    render: (item) => {
      try {
        const raw = item.at ?? item.createdAt;
        if (!raw) return '—';
        const d = new Date(String(raw));
        return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      } catch {
        return String(item.at ?? item.createdAt);
      }
    },
  },
  {
    key: 'route',
    header: 'Route',
    className: 'font-mono text-xs uppercase text-foreground',
    render: (item) => (String(item.route).includes('ask') ? 'Phone Q&A' : 'Recommender'),
  },
  {
    key: 'chargeSource',
    header: 'Allowance Source',
    className: 'font-mono text-xs uppercase',
    render: (item) => {
      const src = String(item.source ?? item.chargeSource ?? 'unknown');
      if (src === 'daily_free') return <span className="text-muted-foreground">Daily Free</span>;
      if (src === 'credit') return <span className="text-accent">Credit Pack</span>;
      if (src === 'subscription')
        return <span className="text-accent font-semibold">Pro Monthly</span>;
      if (src === 'byok') return <span className="text-muted-foreground">BYOK Key</span>;
      return <span className="text-muted-foreground">{src}</span>;
    },
  },
  {
    key: 'status',
    header: 'Outcome',
    align: 'right',
    className: 'font-mono text-xs',
    render: (item) => {
      const status = String(item.outcome ?? item.status ?? '');
      if (status === 'committed') {
        return (
          <span className="border-accent/40 bg-accent/10 text-accent border px-2 py-0.5 text-[11px] font-semibold uppercase">
            Charged
          </span>
        );
      }
      if (status === 'no_charge') {
        const reason = item.reason ? ` · ${String(item.reason)}` : '';
        return (
          <span className="border-border-hairline bg-surface-elevated text-muted-foreground border px-2 py-0.5 text-[11px] uppercase">
            Not Charged{reason}
          </span>
        );
      }
      if (status === 'refunded') {
        return (
          <span className="border-border-hairline bg-surface-elevated text-text-secondary border px-2 py-0.5 text-[11px] uppercase">
            Refunded
          </span>
        );
      }
      return (
        <span className="border-border-hairline text-muted-foreground border px-2 py-0.5 text-[11px] uppercase">
          {status || 'Unknown'}
        </span>
      );
    },
  },
];

export default function AccountUsagePage() {
  const [loading, setLoading] = useState(true);
  const [dailyCounts, setDailyCounts] = useState<DayUsage[]>([]);
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadUsage() {
      try {
        const res = await fetch('/api/me/usage');
        if (!res.ok) {
          throw new Error('Failed to load usage data');
        }
        const data = await res.json();
        setDailyCounts(data.days ?? data.dailyRollup ?? []);
        setLeases(data.leases ?? data.recentLeases ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading usage telemetry.');
      } finally {
        setLoading(false);
      }
    }
    loadUsage();
  }, []);

  return (
    <div className="space-y-8">
      {/* 30-Day Activity Heat Strip */}
      <section aria-labelledby="heatmap-heading">
        <h2 id="heatmap-heading" className="sr-only">
          30-Day Query Heatmap
        </h2>
        {loading ? <Skeleton className="h-40 w-full" /> : <UsageStrip days={dailyCounts} />}
      </section>

      {/* Query Leases Audit Table */}
      <section aria-labelledby="leases-heading" className="space-y-4">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Audit Trail
          </div>
          <h2 id="leases-heading" className="text-foreground text-xl font-bold">
            Recent Query History & Settlement
          </h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Verification receipts showing why a query was or was not charged. Queries with
            clarifying questions or errors are never charged.
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="border-destructive/40 bg-surface text-destructive border p-6 font-mono text-xs">
            {error}
          </div>
        ) : (
          <DataTable
            columns={LEASE_COLUMNS}
            data={leases}
            emptyMessage="No queries yet. Your first 2 today are free."
            caption="Recent query lease settlements"
          />
        )}
      </section>
    </div>
  );
}
