'use client';

import {
  BrainCircuit,
  Database,
  FileText,
  Gauge,
  MessageSquareText,
  RadioTower,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

const STAGES = [
  {
    id: 'catalog',
    label: 'Catalog',
    countKey: 'phones',
    icon: Smartphone,
    color: 'var(--chart-1)',
  },
  {
    id: 'ingest',
    label: 'Ingest',
    countKey: 'ingestRuns',
    icon: RadioTower,
    color: 'var(--chart-2)',
  },
  {
    id: 'sources',
    label: 'Sources',
    countKey: 'sources',
    icon: Database,
    color: 'var(--chart-3)',
  },
  {
    id: 'chunks',
    label: 'Chunks',
    countKey: 'chunks',
    icon: FileText,
    color: 'var(--success)',
  },
  {
    id: 'scorecard',
    label: 'Scorecard',
    countKey: 'aspects',
    icon: Gauge,
    color: 'var(--chart-4)',
  },
  {
    id: 'retrieval',
    label: 'Retrieval',
    countKey: 'chatQueries',
    icon: MessageSquareText,
    color: 'var(--accent)',
  },
  {
    id: 'recommend',
    label: 'Recommend',
    countKey: 'recommendationTurns',
    icon: BrainCircuit,
    color: 'var(--primary)',
  },
] satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly countKey: keyof PipelineHeroCounts;
  readonly icon: LucideIcon;
  readonly color: string;
}[];

export interface PipelineHeroCounts {
  readonly phones: number;
  readonly ingestRuns: number;
  readonly sources: number;
  readonly chunks: number;
  readonly aspects: number;
  readonly chatQueries: number;
  readonly recommendationTurns: number;
}

export function PipelineHero({ counts }: { readonly counts: PipelineHeroCounts }) {
  return (
    <section className="border-border/60 bg-card/40 relative overflow-hidden rounded-lg border px-4 py-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-5">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(120deg,color-mix(in_oklch,var(--primary)_8%,transparent),transparent_36%,color-mix(in_oklch,var(--accent)_10%,transparent))]"
      />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.22em] uppercase">
              Live data lifecycle
            </p>
            <h2 className="text-foreground mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              From phone catalog to grounded recommendations
            </h2>
          </div>
          <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
            Each node is backed by the current database. Counts are live; replay details come in
            later phases.
          </p>
        </div>

        <div className="relative">
          <svg
            className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-20 -translate-y-1/2 md:block"
            viewBox="0 0 1200 120"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d="M70 60 C220 12 300 108 450 60 S670 12 820 60 S980 108 1130 60"
              fill="none"
              stroke="color-mix(in oklch, var(--accent) 55%, transparent)"
              strokeWidth="2"
              strokeDasharray="8 12"
              className="pipeline-flow-line"
            />
          </svg>

          <div className="grid gap-3 md:grid-cols-7">
            {STAGES.map((stage, index) => (
              <PipelineNode
                key={stage.id}
                label={stage.label}
                count={counts[stage.countKey]}
                icon={stage.icon}
                color={stage.color}
                index={index}
                active={index === 0 || counts[stage.countKey] > 0}
                onClick={() => scrollToStage(stage.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PipelineNode({
  label,
  count,
  icon: Icon,
  color,
  index,
  active,
  onClick,
}: {
  readonly label: string;
  readonly count: number;
  readonly icon: LucideIcon;
  readonly color: string;
  readonly index: number;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
      onClick={onClick}
      className={cn(
        'border-border/60 bg-background/80 group relative flex min-h-32 flex-col items-start justify-between rounded-lg border p-3 text-left shadow-xl shadow-black/15 backdrop-blur-xl transition',
        active ? 'opacity-100' : 'opacity-60',
      )}
      style={{
        boxShadow: active
          ? `0 0 0 1px color-mix(in oklch, ${color} 24%, transparent), 0 18px 42px rgba(0,0,0,0.24)`
          : undefined,
      }}
      aria-label={`Scroll to ${label} pipeline section`}
    >
      <span
        className="pipeline-pulse absolute top-3 right-3 size-2 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span
        className="border-border/60 bg-card/70 inline-flex size-9 items-center justify-center rounded-md border"
        style={{ color }}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span>
        <span className="text-muted-foreground block text-xs">{label}</span>
        <span className="text-foreground mt-1 block font-mono text-xl font-semibold tabular-nums">
          {count.toLocaleString('en-US')}
        </span>
      </span>
      <span
        className="absolute inset-x-3 bottom-0 h-0.5 opacity-80 transition-opacity group-hover:opacity-100"
        style={{ background: color }}
        aria-hidden
      />
    </motion.button>
  );
}

function scrollToStage(id: string) {
  const targetId =
    id === 'catalog' || id === 'ingest' || id === 'sources' || id === 'chunks'
      ? 'corpus-overview'
      : id === 'scorecard'
        ? 'database-map'
        : id === 'retrieval' || id === 'recommend'
          ? 'database-map'
          : 'corpus-overview';
  document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
