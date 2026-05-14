import { BrainCircuit, Filter, Trophy } from 'lucide-react';

import type { RecommendationDemo } from '@/services/internal/recommend-explain';

import { RequirementsViewer } from './requirements-viewer';
import { ScoreBreakdown } from './score-breakdown';

export function RecommendSection({ demo }: { readonly demo: RecommendationDemo }) {
  const maxFunnel = Math.max(...demo.funnel.map((step) => step.count), 1);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.15fr)]">
      <div className="grid gap-4">
        <article className="border-border/60 bg-card/45 rounded-lg border p-4 backdrop-blur-xl">
          <p className="text-muted-foreground font-mono text-[11px] tracking-[0.2em] uppercase">
            Recommendation turn replay
          </p>
          <h3 className="text-foreground mt-1 text-xl font-semibold">{demo.userMessage}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <ReplayStat label="intent" value={demo.intent} />
            <ReplayStat label="latency" value={`${demo.latencyMs}ms`} />
            <ReplayStat label="picks" value={demo.picks.length.toString()} />
          </div>
        </article>
        <RequirementsViewer requirements={demo.requirements} />
        <article className="border-border/60 bg-card/45 rounded-lg border p-4 backdrop-blur-xl">
          <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Filter className="text-primary size-4" aria-hidden />
            Candidate Funnel
          </h3>
          <div className="mt-3 space-y-2">
            {demo.funnel.map((step, index) => (
              <div
                key={step.label}
                className="border-border/50 bg-background/70 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground text-sm">{step.label}</span>
                  <span className="font-mono text-sm">{step.count}</span>
                </div>
                <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, (step.count / maxFunnel) * 100)}%`,
                      background:
                        index === demo.funnel.length - 1 ? 'var(--primary)' : 'var(--chart-3)',
                    }}
                  />
                </div>
                <p className="text-muted-foreground mt-2 text-xs">{step.detail}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="border-border/60 bg-card/45 rounded-lg border p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
              <BrainCircuit className="text-primary size-4" aria-hidden />
              Ranked Picks
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Score contributions show why each stored candidate survives the final ranker.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {demo.picks.map((pick) => (
            <article
              key={pick.phoneSlug}
              className="border-border/50 bg-background/70 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-md font-mono text-xs">
                      {pick.rank}
                    </span>
                    <h4 className="text-foreground font-semibold">{pick.label}</h4>
                    {pick.rank === 1 ? (
                      <Trophy className="text-warning size-4" aria-hidden />
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
                    {pick.explanation}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-foreground font-mono text-2xl font-semibold">{pick.score}</p>
                  <p className="text-muted-foreground text-xs">{formatMoney(pick.priceUsd)}</p>
                </div>
              </div>
              <div className="mt-3">
                <ScoreBreakdown pick={pick} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pick.citations.map((citation) => (
                  <span
                    key={citation}
                    className="border-border/60 bg-card/65 text-muted-foreground rounded-md border px-2 py-1 text-[11px]"
                  >
                    {citation}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </article>
    </div>
  );
}

function ReplayStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="bg-background/70 border-border/50 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[11px] uppercase">{label}</p>
      <p className="text-foreground mt-1 font-mono text-sm">{value}</p>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
