import { RefreshCw } from 'lucide-react';

export default function CommandCenterLoading() {
  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      {/* Header */}
      <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
            Command Center
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Central executive hub / database inventory, Gemini budget rail, and pipeline
            observability
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-accent inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            Syncing Metrics...
          </div>
          <span className="border-outline-variant text-muted-foreground border px-2.5 py-1 font-mono text-xs">
            v2.0.4
          </span>
        </div>
      </header>

      {/* Cybernetic Telemetry Banner */}
      <div className="border-accent/40 bg-surface-container/30 relative mt-6 overflow-hidden border p-4">
        <div
          className="scan-beam via-accent/50 absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent to-transparent opacity-75"
          aria-hidden
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-accent relative inline-flex size-3 rounded-full" />
            </span>
            <div className="font-mono text-xs">
              <span className="text-accent font-bold tracking-[0.14em] uppercase">
                Executive Hub Active:{' '}
              </span>
              <span className="text-primary tracking-wide">
                Polling catalog database, Gemini quota governor & telemetry monitors
              </span>
            </div>
          </div>
          <span className="text-muted-foreground hidden font-mono text-[11px] tracking-wider uppercase sm:inline">
            Status: Operational
          </span>
        </div>
      </div>

      {/* 4 Hero KPI Cards */}
      <section className="border-outline-variant bg-outline-variant mt-8 grid gap-px border md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Phones active', sub: 'Promoted canonical catalog devices' },
          { label: 'Candidate queue', sub: 'Pending, queued, and blocked counts' },
          { label: 'Free Gemini left today', sub: 'Across active API keys in rotation' },
          { label: 'Automated pipeline runs', sub: 'Across 5 execution engines' },
        ].map((item, idx) => (
          <div key={idx} className="bg-background relative overflow-hidden p-6">
            <p className="meta-label">{item.label}</p>
            <div className="bg-surface-container/80 mt-4 h-12 w-24 animate-pulse" />
            <p className="text-muted-foreground mt-2 text-sm">{item.sub}</p>
          </div>
        ))}
      </section>

      {/* Workspace Hub Cards Skeleton */}
      <div className="mt-12">
        <div className="bg-surface-container/60 h-4 w-48 animate-pulse" />
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((card) => (
            <div
              key={card}
              className="border-outline-variant bg-background flex flex-col justify-between border p-6"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="border-accent/40 bg-accent/10 size-10 animate-pulse border" />
                  <div className="bg-surface-container/60 h-3 w-16 animate-pulse" />
                </div>
                <div className="bg-surface-container/80 mt-4 h-6 w-40 animate-pulse" />
                <div className="bg-surface-container/50 mt-2 h-10 w-full animate-pulse" />
              </div>
              <div className="border-outline-variant/60 mt-6 flex items-center justify-between border-t pt-4">
                <div className="bg-surface-container/60 h-3 w-28 animate-pulse" />
                <div className="bg-surface-container/80 size-4 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
