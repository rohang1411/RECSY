'use client';

import {
  DatabaseZap,
  FileText,
  Layers3,
  RadioTower,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { PhoneEvidence, PhoneEvidenceCatalog } from '@/services/internal/phone-evidence';

import { ChunkViewer } from './chunk-viewer';
import { EvidenceTimeline } from './evidence-timeline';
import { PhonePicker } from './phone-picker';
import { ScorecardRadar } from './scorecard-radar';
import { SourceCard } from './source-card';

export function PhoneEvidenceSection({ catalog }: { readonly catalog: PhoneEvidenceCatalog }) {
  const firstSlug = catalog.defaultSlug ?? catalog.options[0]?.slug ?? '';
  const [selectedSlug, setSelectedSlug] = useState(firstSlug);
  const evidence = catalog.evidenceBySlug[selectedSlug] ?? getFirstEvidence(catalog);
  const chunksBySource = useMemo(() => groupChunksBySource(evidence?.chunks ?? []), [evidence]);

  if (!evidence) {
    return (
      <div className="border-border/60 bg-card/45 text-muted-foreground rounded-lg border p-6 text-sm">
        No active phones were found for the evidence lens.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <PhonePicker
        options={catalog.options}
        selectedSlug={selectedSlug}
        onChange={setSelectedSlug}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="border-border/60 bg-card/45 overflow-hidden rounded-lg border backdrop-blur-xl">
          <div className="grid gap-4 p-4 lg:grid-cols-[10rem_1fr]">
            <div className="border-border/60 bg-background/70 flex aspect-square items-center justify-center overflow-hidden rounded-lg border">
              {evidence.phone.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={evidence.phone.imageUrl}
                  alt={`${evidence.phone.brand} ${evidence.phone.model}`}
                  className="h-full w-full object-contain p-3"
                />
              ) : (
                <Smartphone className="text-muted-foreground size-12" aria-hidden />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase">
                Stored phone record
              </p>
              <h3 className="text-foreground mt-1 text-2xl font-semibold tracking-tight">
                {evidence.phone.brand} {evidence.phone.model}
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <EvidenceMetric
                  icon={RadioTower}
                  label="Sources"
                  value={evidence.summary.sourceCount}
                />
                <EvidenceMetric
                  icon={FileText}
                  label="Chunks"
                  value={evidence.summary.chunkCount}
                />
                <EvidenceMetric
                  icon={Layers3}
                  label="Aspects"
                  value={evidence.summary.aspectCount}
                />
                <EvidenceMetric
                  icon={DatabaseZap}
                  label="Spec vector"
                  value={evidence.phone.hasSpecEmbedding ? 'ready' : 'pending'}
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <DataPoint label="MSRP" value={formatMoney(evidence.phone.msrpUsd)} />
                <DataPoint label="Last ingest" value={formatDate(evidence.phone.lastIngestAt)} />
                <DataPoint label="Next ingest" value={formatDate(evidence.phone.nextIngestAt)} />
                <DataPoint
                  label="Avg source quality"
                  value={formatPercent(evidence.summary.averageQuality)}
                />
              </div>
            </div>
          </div>

          <div className="border-border/50 grid border-t p-4 sm:grid-cols-4">
            {[
              ['fetch', 'adapter fetch'],
              ['curate', 'source row'],
              ['embed', 'chunk vector'],
              ['rank', 'scorecard use'],
            ].map(([id, label], index) => (
              <div key={id} className="relative flex items-center gap-3 py-2">
                <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs">
                  {index + 1}
                </span>
                <span className="text-foreground text-sm">{label}</span>
                {index < 3 ? (
                  <span
                    className="bg-border/70 absolute top-1/2 right-3 hidden h-px w-10 sm:block"
                    aria-hidden
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <ScorecardRadar aspects={evidence.aspects} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]">
        <div className="border-border/60 bg-card/45 rounded-lg border p-3">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-foreground text-sm font-semibold">Source Evidence Cards</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Stored source rows with curator scores, aspect tags, and representative chunks.
              </p>
            </div>
            <span className="text-muted-foreground font-mono text-[11px]">
              {evidence.sources.length} rows
            </span>
          </div>
          <div className="max-h-[44rem] space-y-3 overflow-y-auto pr-1">
            {evidence.sources.length > 0 ? (
              evidence.sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  chunks={chunksBySource.get(source.id) ?? []}
                />
              ))
            ) : (
              <p className="text-muted-foreground border-border/60 rounded-md border border-dashed p-4 text-sm">
                This phone does not have source rows yet.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <ChunkViewer chunks={evidence.chunks} />
          <EvidenceTimeline runs={evidence.ingestRuns} />
        </div>
      </div>
    </div>
  );
}

function EvidenceMetric({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: number | string;
}) {
  return (
    <div className="bg-background/70 border-border/50 rounded-md border p-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="text-foreground mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DataPoint({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="bg-background/70 border-border/50 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[11px] uppercase">{label}</p>
      <p className="text-foreground mt-1 truncate text-sm">{value}</p>
    </div>
  );
}

function groupChunksBySource(chunks: readonly PhoneEvidence['chunks'][number][]) {
  const bySource = new Map<string, PhoneEvidence['chunks'][number][]>();
  for (const chunk of chunks) {
    const group = bySource.get(chunk.sourceId);
    if (group) {
      group.push(chunk);
    } else {
      bySource.set(chunk.sourceId, [chunk]);
    }
  }
  return bySource;
}

function getFirstEvidence(catalog: PhoneEvidenceCatalog): PhoneEvidence | null {
  const firstSlug = catalog.options[0]?.slug;
  return firstSlug ? (catalog.evidenceBySlug[firstSlug] ?? null) : null;
}

function formatDate(value: string | null): string {
  if (!value) return 'None';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

function formatMoney(value: number | null): string {
  if (value === null) return 'Unknown';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${Math.round(value * 100)}%`;
}
