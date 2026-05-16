'use client';

import { ChevronDown, ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { EvidenceChunk, EvidenceSource } from '@/services/internal/phone-evidence';

export function SourceCard({
  source,
  chunks,
}: {
  readonly source: EvidenceSource;
  readonly chunks: readonly EvidenceChunk[];
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceName = source.channel ?? source.author ?? source.type;

  return (
    <article className="border-border/60 bg-card/55 overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="grid w-full gap-3 p-3 text-left sm:grid-cols-[minmax(0,1fr)_auto]"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-border/60 bg-background/70 text-foreground rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase">
              {source.type}
            </span>
            <span className="text-muted-foreground text-xs">{sourceName}</span>
          </div>
          <h4 className="text-foreground mt-2 line-clamp-2 text-sm font-medium">{source.title}</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            {formatDate(source.publishedAt) ?? 'No publish date'} / fetched{' '}
            {formatDate(source.lastFetchedAt) ?? 'unknown'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="chunks" value={source.chunkCount} />
            <MiniStat label="rel" value={formatPercent(source.relevance)} />
            <MiniStat label="quality" value={formatPercent(source.quality)} />
          </div>
          <ChevronDown
            className={cn('text-muted-foreground size-4 transition', expanded && 'rotate-180')}
            aria-hidden
          />
        </div>
      </button>

      {expanded ? (
        <div className="border-border/50 border-t px-3 pb-3">
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-3">
              <QualityBar label="Relevance" value={source.relevance} color="var(--chart-1)" />
              <QualityBar label="Review quality" value={source.quality} color="var(--chart-3)" />
              <QualityBar label="Engagement" value={source.engagementScore} color="var(--accent)" />
              <div className="flex flex-wrap gap-1.5">
                {source.aspectsCovered.length > 0 ? (
                  source.aspectsCovered.map((aspect) => (
                    <span
                      key={aspect}
                      className="bg-primary/10 text-primary rounded-md px-2 py-1 text-[11px]"
                    >
                      {aspect}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground text-xs">No aspect tags stored</span>
                )}
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 text-xs"
              >
                Open source
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>

            <div className="space-y-2">
              {chunks.slice(0, 3).map((chunk) => (
                <div
                  key={chunk.id}
                  className="bg-background/70 border-border/50 rounded-md border p-2"
                >
                  <div className="text-muted-foreground mb-1 flex items-center gap-2 text-[11px]">
                    <FileText className="size-3" aria-hidden />
                    chunk {chunk.chunkIndex} / {chunk.tokens} tokens
                  </div>
                  <p className="text-foreground/90 line-clamp-3 text-xs leading-relaxed">
                    {chunk.text}
                  </p>
                </div>
              ))}
              {chunks.length === 0 ? (
                <p className="text-muted-foreground border-border/60 rounded-md border border-dashed p-3 text-xs">
                  This source row exists without embedded chunks yet.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MiniStat({ label, value }: { readonly label: string; readonly value: number | string }) {
  return (
    <span>
      <span className="text-foreground block font-mono text-sm tabular-nums">{value}</span>
      <span className="text-muted-foreground block text-[10px] uppercase">{label}</span>
    </span>
  );
}

function QualityBar({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly color: string;
}) {
  const percent = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));

  return (
    <div>
      <div className="mb-1 flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-mono">{value === null ? 'n/a' : `${percent}%`}</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
      </div>
    </div>
  );
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
