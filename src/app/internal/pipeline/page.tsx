import type { Metadata } from 'next';

import { getPipelineSnapshot } from '@/services/internal/pipeline-snapshot';

import { CorpusOverview } from './_components/corpus-overview';
import { DatabaseMap } from './_components/database-map';
import { PipelineHero } from './_components/pipeline-hero';
import { SectionHeading } from './_components/section-heading';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pipeline Observatory',
  robots: { index: false, follow: false },
};

export default async function PipelineObservatoryPage() {
  const snapshot = await getPipelineSnapshot();

  return (
    <main className="relative min-h-dvh">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_45%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_35%,transparent)_1px,transparent_1px)] bg-[size:56px_56px] opacity-25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--accent)_18%,transparent),transparent_68%)]"
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-border/60 bg-background/70 sticky top-0 z-30 flex flex-col gap-4 rounded-lg border px-4 py-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.22em] uppercase">
              Internal / read-only
            </p>
            <h1 className="text-foreground mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              RECSY Pipeline Observatory
            </h1>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            <span className="border-border/70 bg-card/70 inline-flex rounded-md border px-2.5 py-1 font-mono">
              /internal/pipeline
            </span>
            <span className="font-mono">Updated {formatDateTime(snapshot.generatedAt)}</span>
          </div>
        </header>

        <PipelineHero
          counts={{
            phones: snapshot.phones.total,
            ingestRuns: snapshot.ingestRuns.total,
            sources: snapshot.sources.total,
            chunks: snapshot.chunks.total,
            aspects: snapshot.aspects.total,
            chatQueries: snapshot.chatQueries.total,
            recommendationTurns: snapshot.recommendationTurns.total,
          }}
        />

        <section id="corpus-overview" className="scroll-mt-28">
          <SectionHeading
            eyebrow="Live corpus state"
            title="Corpus Overview"
            description="A compact read of what the database can currently prove, separated from historical ingestion activity."
            icon="activity"
          />
          <CorpusOverview snapshot={snapshot} />
        </section>

        <section id="database-map" className="scroll-mt-28 pb-12">
          <SectionHeading
            eyebrow="Storage contract"
            title="Database Map"
            description="The major tables grouped by the pipeline stage that writes and reads them."
            icon="database"
          />
          <DatabaseMap groups={snapshot.tableGroups} />
        </section>
      </div>
    </main>
  );
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
