import type { PipelineSnapshot } from '@/services/internal/pipeline-snapshot';

import { MetricCard } from './metric-card';

export function CorpusOverview({ snapshot }: { readonly snapshot: PipelineSnapshot }) {
  const sourceTypes = Object.entries(snapshot.sources.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(' / ');

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Phones"
        value={snapshot.phones.total}
        icon="smartphone"
        accent="var(--chart-1)"
        detail={`${snapshot.phones.withEvidence} with evidence, ${snapshot.phones.withSpecEmbedding} with spec vectors`}
      />
      <MetricCard
        label="Sources"
        value={snapshot.sources.total}
        icon="radio"
        accent="var(--chart-2)"
        detail={sourceTypes || 'No source rows yet'}
      />
      <MetricCard
        label="Chunks"
        value={snapshot.chunks.total}
        icon="file"
        accent="var(--chart-3)"
        detail={`${snapshot.chunks.avgPerPhone.toLocaleString('en-US')} chunks per catalog phone on average`}
      />
      <MetricCard
        label="Aspects"
        value={snapshot.aspects.total}
        icon="gauge"
        accent="var(--chart-4)"
        detail={`${snapshot.aspects.phonesWithAspects} phones have generated scorecard rows`}
      />
      <MetricCard
        label="Ingest Runs"
        value={snapshot.ingestRuns.total}
        icon="activity"
        accent="var(--accent)"
        detail={formatStatusBreakdown(snapshot.ingestRuns.byStatus)}
      />
      <MetricCard
        label="Chat Queries"
        value={snapshot.chatQueries.total}
        icon="message"
        accent="var(--chart-5)"
        detail="Persisted phone-scoped Q and A turns"
      />
      <MetricCard
        label="Recommendation Turns"
        value={snapshot.recommendationTurns.total}
        icon="brain"
        accent="var(--primary)"
        detail="Stored requirement extraction and pick history"
      />
      <MetricCard
        label="LLM Cache Hits"
        value={snapshot.llmCache.totalHits}
        icon="bot"
        accent="var(--success)"
        detail={`${snapshot.llmCache.total} cached responses in Postgres`}
      />
      <MetricCard
        label="Freshness"
        value={formatDate(snapshot.freshness.newestIngest)}
        icon="clock"
        accent="var(--warning)"
        detail={`${snapshot.freshness.overduePhones} active phones are past next ingest time`}
        className="sm:col-span-2"
      />
      <MetricCard
        label="Evidence Coverage"
        value={coveragePercent(snapshot.phones.withEvidence, snapshot.phones.total)}
        icon="packageSearch"
        accent="var(--accent)"
        suffix="%"
        detail="Share of catalog phones with at least one stored source"
        className="sm:col-span-2"
      />
    </div>
  );
}

function formatStatusBreakdown(statuses: Record<string, number>): string {
  const entries = Object.entries(statuses);
  if (entries.length === 0) return 'No ingest telemetry yet';
  return entries.map(([status, count]) => `${status}: ${count}`).join(' / ');
}

function formatDate(date: Date | null): string {
  if (!date) return 'None';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function coveragePercent(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}
