import { FileSearch, Timer, Waves, type LucideIcon } from 'lucide-react';

import type { RetrievalDemo } from '@/services/internal/retrieval-explain';

import { RetrievalFunnel } from './retrieval-funnel';

export function RetrievalSection({ demo }: { readonly demo: RetrievalDemo }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <article className="border-border/60 bg-card/45 rounded-lg border p-4 backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase">
              Precomputed replay
            </p>
            <h3 className="text-foreground mt-1 text-xl font-semibold">{demo.question}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              A deterministic view of how phone-scoped hybrid retrieval narrows stored chunks into
              answer-ready citations.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <MiniReplayStat icon={Timer} label="latency" value={`${demo.latencyMs}ms`} />
            <MiniReplayStat
              icon={FileSearch}
              label="citations"
              value={demo.finalChunks.length.toString()}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {demo.sourceMix.map((source) => (
            <div
              key={source.type}
              className="bg-background/70 border-border/50 rounded-md border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground text-sm capitalize">{source.type}</span>
                <span className="font-mono text-sm">{source.count}</span>
              </div>
              <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${source.count * 18}%`, background: source.color }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="border-border/50 bg-background/70 mt-4 rounded-lg border p-3">
          <h4 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Waves className="text-primary size-4" aria-hidden />
            Final cited chunks
          </h4>
          <div className="mt-3 space-y-2">
            {demo.finalChunks.map((chunk) => (
              <article
                key={chunk.rank}
                className="border-border/50 bg-card/55 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-primary text-primary-foreground inline-flex size-6 items-center justify-center rounded-md font-mono text-xs">
                    {chunk.rank}
                  </span>
                  <span className="text-foreground text-sm font-medium">{chunk.sourceTitle}</span>
                  <span className="text-muted-foreground font-mono text-[11px] uppercase">
                    {chunk.sourceType}
                  </span>
                  <span className="text-muted-foreground ml-auto font-mono text-xs">
                    {Math.round(chunk.score * 100)}%
                  </span>
                </div>
                <p className="text-foreground/90 mt-2 text-sm leading-relaxed">{chunk.excerpt}</p>
                <p className="text-muted-foreground mt-2 text-xs">{chunk.reason}</p>
              </article>
            ))}
          </div>
        </div>
      </article>

      <article className="border-border/60 bg-card/45 rounded-lg border p-4 backdrop-blur-xl">
        <div className="mb-3">
          <h3 className="text-foreground text-sm font-semibold">Retrieval Funnel</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            The same logical stages used by the user-facing Q and A path.
          </p>
        </div>
        <RetrievalFunnel stages={demo.stages} />
      </article>
    </div>
  );
}

function MiniReplayStat({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="bg-background/70 border-border/50 rounded-md border p-2">
      <p className="text-muted-foreground flex items-center justify-end gap-1 text-[11px] uppercase">
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      <p className="text-foreground mt-1 font-mono text-sm">{value}</p>
    </div>
  );
}
