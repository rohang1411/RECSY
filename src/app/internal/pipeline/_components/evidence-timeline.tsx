import { Clock3, GitBranch, XCircle } from 'lucide-react';

import type { EvidenceIngestRun } from '@/services/internal/phone-evidence';

const STATUS_COLORS: Record<string, string> = {
  started: 'var(--chart-2)',
  success: 'var(--success)',
  failed: 'var(--destructive)',
  skipped: 'var(--warning)',
};

export function EvidenceTimeline({ runs }: { readonly runs: readonly EvidenceIngestRun[] }) {
  return (
    <div className="border-border/60 bg-card/45 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="text-primary size-4" aria-hidden />
            Ingest Timeline
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Recent scheduler and adapter attempts for this phone.
          </p>
        </div>
        <span className="text-muted-foreground font-mono text-[11px]">{runs.length} runs</span>
      </div>

      <div className="mt-3 space-y-2">
        {runs.length > 0 ? (
          runs.map((run) => (
            <article
              key={run.id}
              className="border-border/50 bg-background/70 grid gap-3 rounded-md border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <span
                className="border-border/60 inline-flex size-8 items-center justify-center rounded-md border"
                style={{ color: STATUS_COLORS[run.status] ?? 'var(--muted-foreground)' }}
              >
                {run.status === 'failed' ? (
                  <XCircle className="size-4" aria-hidden />
                ) : (
                  <Clock3 className="size-4" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground text-sm font-medium">{run.adapter}</span>
                  <span className="border-border/60 text-muted-foreground rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase">
                    {run.status}
                  </span>
                  {run.tier ? (
                    <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 font-mono text-[10px] uppercase">
                      {run.tier}
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {run.rejectedReason ??
                    run.error ??
                    run.sourceUrl ??
                    run.discoveryStrategy ??
                    'ingest attempt'}
                </p>
              </div>
              <div className="text-muted-foreground text-xs sm:text-right">
                <p>{formatDateTime(run.startedAt)}</p>
                <p className="font-mono">
                  {formatDuration(run.durationMs)} / {run.chunksCreated} chunks
                </p>
              </div>
            </article>
          ))
        ) : (
          <p className="text-muted-foreground border-border/60 rounded-md border border-dashed p-4 text-sm">
            No phone-scoped ingest telemetry is stored yet.
          </p>
        )}
      </div>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return 'unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null) return 'n/a';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}
