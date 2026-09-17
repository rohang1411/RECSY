import Link from 'next/link';
import { Radio, RefreshCw, Server, ShieldAlert } from 'lucide-react';

export default function DatabaseDashboardLoading() {
  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      {/* Header */}
      <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/internal/command-center"
              className="text-muted-foreground hover:text-accent font-mono text-xs tracking-[0.14em] uppercase transition-colors"
            >
              ← Command Center
            </Link>
            <span className="text-muted-foreground/40 font-mono text-xs">/</span>
            <span className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
              Database Observatory
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Database Dashboard
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Catalog phone inventory, candidate pipeline statuses, and quarantine root-cause
            diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-accent inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            Connecting to Database...
          </div>
          <span className="border-outline-variant text-muted-foreground/60 border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase">
            Standby
          </span>
        </div>
      </header>

      {/* Cybernetic Telemetry Banner & Scanner Line */}
      <div className="border-accent/40 bg-surface-container/30 relative mt-6 overflow-hidden border p-4">
        {/* Laser scanning beam moving across */}
        <div
          className="scan-beam via-accent/50 absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent to-transparent opacity-75"
          aria-hidden
        />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-accent relative inline-flex size-3 rounded-full" />
            </span>
            <div className="font-mono text-xs">
              <span className="text-accent font-bold tracking-[0.14em] uppercase">
                Telemetry Uplink Active:{' '}
              </span>
              <span className="text-primary tracking-wide">
                Streaming catalog candidates, crawl queue & quarantine logs
              </span>
            </div>
          </div>
          <div className="text-muted-foreground flex items-center gap-3 font-mono text-[11px] tracking-wider uppercase">
            <span className="inline-flex items-center gap-1.5">
              <Server className="text-accent size-3" />
              Pooler: Connecting
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <Radio className="size-3 animate-pulse text-[#39ff88]" />
              Live Stream
            </span>
          </div>
        </div>

        {/* Diagnostic Stream Steps */}
        <div className="border-outline-variant/60 bg-background/80 text-muted-foreground mt-3 grid gap-2 border p-3 font-mono text-[11px] sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <span className="text-accent font-bold">[1/3]</span>
            <span className="text-primary">Querying active catalog & queue...</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-accent font-bold">[2/3]</span>
            <span className="text-accent animate-pulse">
              Cross-referencing quarantine issues...
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground/60 font-bold">[3/3]</span>
            <span>Aggregating root-cause frequencies...</span>
          </div>
        </div>
      </div>

      {/* 5 KPI Metric Skeletons */}
      <section className="border-outline-variant bg-outline-variant mt-8 grid gap-px border md:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: 'Promoted / Active',
            color: 'bg-[#39ff88]',
            sub: 'Active in canonical phone catalog',
          },
          {
            label: 'Blocked / Quarantined',
            color: 'bg-[#ff3b30]',
            sub: 'Validation failures & errors',
          },
          {
            label: 'Pending Review',
            color: 'bg-[#ffe45e]',
            sub: 'Awaiting manual or staged review',
          },
          {
            label: 'In Pipeline',
            color: 'bg-[#00d2ff]',
            sub: 'Discovered, fetching, or extracting',
          },
          { label: 'Queued', color: 'bg-muted-foreground', sub: 'Scheduled for crawl / promotion' },
        ].map((item, idx) => (
          <div key={idx} className="bg-background relative overflow-hidden p-6">
            <div className="flex items-center justify-between">
              <p className="meta-label">{item.label}</p>
              <span className={`size-2 rounded-full ${item.color} animate-pulse`} />
            </div>
            {/* Shimmering counter block */}
            <div className="mt-3 flex items-baseline gap-2">
              <div className="bg-surface-container/80 h-10 w-16 animate-pulse" />
              <div className="bg-surface-container/40 h-4 w-8 animate-pulse" />
            </div>
            <p className="text-muted-foreground mt-2 font-mono text-xs">{item.sub}</p>
          </div>
        ))}
      </section>

      {/* Blocked Reasons Breakdown Skeleton Rail */}
      <section className="border-outline-variant bg-background mt-8 border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 animate-pulse text-[#ff3b30]/60" aria-hidden />
            <p className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
              Blocked Phones Root-Cause Breakdown
            </p>
          </div>
          <span className="text-muted-foreground/50 font-mono text-[11px] uppercase">
            Calculating frequencies...
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { w: 'w-44', count: '18' },
            { w: 'w-36', count: '12' },
            { w: 'w-40', count: '9' },
            { w: 'w-32', count: '5' },
            { w: 'w-48', count: '3' },
          ].map((pill, i) => (
            <div
              key={i}
              className="border-outline-variant bg-surface-container/40 flex items-center gap-2 border px-3 py-1.5"
            >
              <div className={`bg-surface-container/80 h-3.5 ${pill.w} animate-pulse`} />
              <div className="border-outline-variant bg-background h-4 w-5 animate-pulse" />
            </div>
          ))}
        </div>
      </section>

      {/* Filters & Table Skeleton */}
      <section className="border-outline-variant bg-background mt-8 border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {['All Entries', 'Promoted', 'Blocked', 'Pending Review', 'In Pipeline', 'Queued'].map(
              (tab, i) => (
                <div
                  key={i}
                  className={`border px-3 py-1.5 font-mono text-xs uppercase ${
                    i === 0
                      ? 'border-primary bg-primary/20 text-primary font-semibold'
                      : 'border-outline-variant text-muted-foreground/60'
                  }`}
                >
                  <span>{tab}</span>
                </div>
              ),
            )}
          </div>
          <div className="flex gap-2">
            <div className="border-outline-variant bg-surface-container/40 h-8 w-36 animate-pulse border" />
            <div className="border-outline-variant bg-surface-container/40 h-8 w-48 animate-pulse border" />
          </div>
        </div>

        {/* Table Rows Skeleton */}
        <div className="border-outline-variant mt-6 overflow-hidden border">
          <div className="border-outline-variant bg-surface-container/50 text-muted-foreground flex border-b px-4 py-3 font-mono text-[11px] font-bold tracking-[0.14em] uppercase">
            <div className="w-1/3">Device / Model</div>
            <div className="w-1/6">Category</div>
            <div className="w-1/4">Status / Blocked Reason</div>
            <div className="w-1/6">Source</div>
            <div className="w-1/12 text-right">Updated</div>
          </div>
          <div className="divide-outline-variant divide-y">
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="flex items-center px-4 py-3.5">
                <div className="flex w-1/3 items-center gap-3">
                  <div className="border-outline-variant bg-surface-container/80 size-7 shrink-0 animate-pulse border" />
                  <div className="space-y-1.5">
                    <div className="bg-surface-container/80 h-3.5 w-36 animate-pulse" />
                    <div className="bg-surface-container/40 h-2.5 w-24 animate-pulse" />
                  </div>
                </div>
                <div className="w-1/6">
                  <div className="border-outline-variant bg-surface-container/80 h-5 w-20 animate-pulse border" />
                </div>
                <div className="w-1/4 space-y-1.5">
                  <div className="bg-surface-container/80 h-3.5 w-44 animate-pulse" />
                  <div className="bg-surface-container/40 h-2.5 w-28 animate-pulse" />
                </div>
                <div className="w-1/6">
                  <div className="bg-surface-container/60 h-3 w-24 animate-pulse" />
                </div>
                <div className="flex w-1/12 justify-end">
                  <div className="bg-surface-container/60 h-3 w-14 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
