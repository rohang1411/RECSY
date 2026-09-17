import Link from 'next/link';
import { GitBranch, Radio, RefreshCw } from 'lucide-react';

export default function PipelinesLoading() {
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
              Pipeline Runs Console
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Pipeline Runs & Logs
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Data output verification, execution checkpoints, and script error diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-accent inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            Streaming Runs...
          </div>
          <span className="border-outline-variant text-muted-foreground/60 border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase">
            Standby
          </span>
        </div>
      </header>

      {/* Telemetry Bar */}
      <div className="border-accent/40 bg-surface-container/30 relative mt-6 overflow-hidden border p-4">
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
                Ingesting Telemetry Streams:{' '}
              </span>
              <span className="text-primary tracking-wide">
                Consolidating 5 pipeline engines (Catalog, Ingestion, Scorecards, Queue, CI)
              </span>
            </div>
          </div>
          <div className="text-muted-foreground flex items-center gap-3 font-mono text-[11px] tracking-wider uppercase">
            <span className="inline-flex items-center gap-1.5">
              <GitBranch className="text-accent size-3" />
              Engines: 5 Loaded
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <Radio className="size-3 animate-pulse text-[#39ff88]" />
              Live Feed
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="border-outline-variant bg-outline-variant mt-8 grid gap-px border md:grid-cols-4">
        {[
          { label: 'Total Runs Indexed', sub: 'Across all 5 pipeline engines' },
          { label: 'Successful Executions', sub: 'Clean data output verification' },
          { label: 'Failed Runs / Errors', sub: 'With script stack trace diagnostics' },
          { label: 'Active / Queued', sub: 'Currently executing or pending' },
        ].map((item, idx) => (
          <div key={idx} className="bg-background relative overflow-hidden p-6">
            <p className="meta-label">{item.label}</p>
            <div className="bg-surface-container/80 mt-3 h-10 w-20 animate-pulse" />
            <p className="text-muted-foreground mt-2 font-mono text-xs">{item.sub}</p>
          </div>
        ))}
      </section>

      {/* Filter and Table Skeleton */}
      <section className="border-outline-variant bg-background mt-8 border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {[
              'All Engines (5)',
              'Catalog Refresh',
              'Ingestion Engine',
              'Scorecards',
              'GitHub CI',
            ].map((tab, i) => (
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
            ))}
          </div>
          <div className="flex gap-2">
            <div className="border-outline-variant bg-surface-container/40 h-8 w-44 animate-pulse border" />
          </div>
        </div>

        {/* Table Rows Skeleton */}
        <div className="border-outline-variant mt-6 overflow-hidden border">
          <div className="border-outline-variant bg-surface-container/50 text-muted-foreground flex border-b px-4 py-3 font-mono text-[11px] font-bold tracking-[0.14em] uppercase">
            <div className="w-1/4">Engine / Run ID</div>
            <div className="w-1/6">Status</div>
            <div className="w-5/12">Execution Summary / Output Verified</div>
            <div className="w-1/6 text-right">Started / Ended</div>
          </div>
          <div className="divide-outline-variant divide-y">
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="flex items-center px-4 py-3.5">
                <div className="flex w-1/4 items-center gap-2">
                  <div className="border-outline-variant bg-surface-container/80 h-5 w-16 animate-pulse border" />
                  <div className="bg-surface-container/80 h-4 w-28 animate-pulse" />
                </div>
                <div className="w-1/6">
                  <div className="border-outline-variant bg-surface-container/80 h-5 w-20 animate-pulse border" />
                </div>
                <div className="w-5/12 space-y-1.5">
                  <div className="bg-surface-container/80 h-3.5 w-72 animate-pulse" />
                  <div className="bg-surface-container/40 h-2.5 w-44 animate-pulse" />
                </div>
                <div className="flex w-1/6 justify-end">
                  <div className="bg-surface-container/60 h-3 w-28 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
