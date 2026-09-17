import Link from 'next/link';
import { RefreshCw } from 'lucide-react';

export default function LifecycleLoading() {
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
              Device Lifecycle Probe
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Lifecycle Explorer
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Isolated per-device pipeline inspector, 3-stage schematic probe, and chunk workbench
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-accent inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
            Loading Probe Schematic...
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
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex size-3">
              <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
              <span className="bg-accent relative inline-flex size-3 rounded-full" />
            </span>
            <div className="font-mono text-xs">
              <span className="text-accent font-bold tracking-[0.14em] uppercase">
                Device Probe Initializing:{' '}
              </span>
              <span className="text-primary tracking-wide">
                Mounting Ingestion &rarr; Processing &rarr; Retrieval diagnostic harness
              </span>
            </div>
          </div>
          <span className="text-muted-foreground hidden font-mono text-[11px] tracking-wider uppercase sm:inline">
            Stage: Ingest &bull; Process &bull; Retrieve
          </span>
        </div>
      </div>

      {/* Device Selector Skeleton */}
      <section className="border-outline-variant bg-background mt-8 border p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="bg-surface-container/80 h-4 w-44 animate-pulse" />
            <div className="bg-surface-container/50 mt-2 h-3 w-64 animate-pulse" />
          </div>
          <div className="border-outline-variant bg-surface-container/40 h-9 w-60 animate-pulse border" />
        </div>
      </section>

      {/* 3-Stage Schematic Skeleton */}
      <section className="border-outline-variant bg-background mt-8 border p-6">
        <div className="bg-surface-container/80 h-4 w-56 animate-pulse" />
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            { stage: 'Stage 1: Ingestion', sub: 'Crawl adapters, YouTube transcripts & GSMArena' },
            { stage: 'Stage 2: Processing', sub: 'Semantic chunking, deduplication & embeddings' },
            {
              stage: 'Stage 3: Retrieval',
              sub: 'Hybrid RRF vector ranking & scorecard extraction',
            },
          ].map((item, idx) => (
            <div key={idx} className="border-outline-variant bg-surface-container/20 border p-5">
              <div className="flex items-center justify-between">
                <span className="text-primary font-mono text-xs font-bold tracking-wider uppercase">
                  {item.stage}
                </span>
                <span className="bg-accent/40 size-2 animate-pulse rounded-full" />
              </div>
              <p className="text-muted-foreground mt-2 font-mono text-xs">{item.sub}</p>
              <div className="border-outline-variant/60 bg-background/80 mt-4 space-y-2 border p-3">
                <div className="bg-surface-container/70 h-3 w-3/4 animate-pulse" />
                <div className="bg-surface-container/50 h-3 w-1/2 animate-pulse" />
                <div className="bg-surface-container/40 h-3 w-2/3 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
