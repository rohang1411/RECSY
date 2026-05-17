'use client';

import { Cpu } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getSourceThumbnail } from '@/lib/source-thumbnail';
import { cn } from '@/lib/utils';

type SourceType = 'youtube' | 'reddit' | 'article' | 'gsmarena';

export type LifecycleSource = {
  id: string;
  type: SourceType;
  url: string;
  title: string;
  author: string | null;
  channel: string | null;
  publishedAt: string | null;
  relevance: string | null;
  quality: string | null;
  viewCount: number | null;
  chunkCount: number;
};

export type LifecycleAspect = {
  aspect: string;
  score: string;
  confidence: string;
  summary: string | null;
  nSupporting: number | null;
  nDissenting: number | null;
};

export type LifecycleTurn = {
  userMessage: string;
  createdAt: string;
  latencyMs: number | null;
  rank: number | null;
};

type LifecycleExplorerProps = {
  readonly sources: readonly LifecycleSource[];
  readonly aspects: readonly LifecycleAspect[];
  readonly turns: readonly LifecycleTurn[];
  readonly chunkCount: number;
  readonly sourceMixLabel: string;
  readonly selectedPhoneLabel: string;
  readonly evidenceReasons: readonly string[];
};

const SOURCE_LABELS: Record<SourceType, string> = {
  youtube: 'YouTube video',
  reddit: 'Reddit post',
  article: 'Article',
  gsmarena: 'GSMArena page',
};

const SOURCE_MARKS: Record<SourceType, string> = {
  youtube: 'YT',
  reddit: 'RD',
  article: 'AR',
  gsmarena: 'GS',
};

const STAGES = [
  {
    id: 'ingest',
    title: 'Ingest',
    body: 'Raw capture from source pages, videos, posts, and specs.',
    stat: 'Source mix',
  },
  {
    id: 'process',
    title: 'Process',
    body: 'Chunking, embedding generation, and score extraction.',
    stat: 'Synthesis',
  },
  {
    id: 'retrieve',
    title: 'Retrieve',
    body: 'Indexed evidence is pulled into recommendations and Q&A.',
    stat: 'Query match',
  },
] as const;

type StageId = (typeof STAGES)[number]['id'];

function formatScore(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : value;
}

function formatDate(value: string | null) {
  if (!value) return 'date unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'date unknown'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sourceSite(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function formatViews(value: number | null) {
  if (!value) return 'views n/a';
  return `${value.toLocaleString('en-US')} views`;
}

function sampleQuery(selectedPhoneLabel: string) {
  return `Best camera phone under $1000 where ${selectedPhoneLabel} is a strong candidate`;
}

export function LifecycleExplorer({
  sources,
  aspects,
  turns,
  chunkCount,
  sourceMixLabel,
  selectedPhoneLabel,
  evidenceReasons,
}: LifecycleExplorerProps) {
  const [activeStage, setActiveStage] = useState<StageId>('ingest');
  const [selectedAspectName, setSelectedAspectName] = useState<string | null>(null);
  const [llmOpen, setLlmOpen] = useState(true);
  const selectedAspect =
    aspects.find((aspect) => aspect.aspect === selectedAspectName) ?? aspects[0] ?? null;
  const latestRecommendedTurn = turns.find((turn) => turn.rank != null) ?? null;
  const retrievalQuery = latestRecommendedTurn?.userMessage ?? sampleQuery(selectedPhoneLabel);

  const stageDetail = useMemo(() => {
    if (activeStage === 'ingest') {
      return {
        title: 'Capture profile',
        rows: [
          ['Sources visible', String(sources.length)],
          ['Source mix', sourceMixLabel || 'No active sources'],
          ['Latest source', sources[0]?.title ?? 'Waiting for ingestion'],
        ],
      };
    }
    if (activeStage === 'process') {
      return {
        title: 'Synthesis profile',
        rows: [
          ['Visible chunks', String(chunkCount)],
          ['Extracted aspects', String(aspects.length)],
          [
            'Strongest signal',
            selectedAspect ? `${selectedAspect.aspect} ${selectedAspect.score}/10` : 'Pending',
          ],
        ],
      };
    }
    return {
      title: 'Retrieval profile',
      rows: [
        ['Query shown', latestRecommendedTurn ? 'Last recommendation match' : 'Sample query'],
        [
          'Candidate rank',
          latestRecommendedTurn?.rank ? `#${latestRecommendedTurn.rank}` : 'Candidate-ready',
        ],
        ['Why it surfaced', evidenceReasons[0] ?? 'Evidence is indexed for retrieval'],
      ],
    };
  }, [
    activeStage,
    aspects.length,
    chunkCount,
    evidenceReasons,
    latestRecommendedTurn,
    selectedAspect,
    sourceMixLabel,
    sources,
  ]);

  return (
    <section className="mt-12">
      <div className="accent-hairline border-outline-variant mb-4 border-b pb-3">
        <p className="meta-label text-primary">Lifecycle schematic</p>
      </div>

      <div className="border-outline-variant bg-background relative grid gap-6 border p-6 md:grid-cols-3">
        <div className="bg-primary/35 pointer-events-none absolute top-1/2 right-6 left-6 hidden h-px md:block" />
        {STAGES.map((stage) => (
          <button
            key={stage.id}
            type="button"
            onClick={() => setActiveStage(stage.id)}
            aria-pressed={activeStage === stage.id}
            className={cn(
              'interactive-panel relative z-10 p-6 text-left',
              activeStage === stage.id && 'border-accent bg-surface-container',
            )}
          >
            <h2 className="font-display text-gradient-steel text-3xl font-bold tracking-normal uppercase">
              {stage.title}
            </h2>
            <p className="text-muted-foreground mt-6 min-h-14 font-mono text-xs leading-5">
              {stage.body}
            </p>
            <div className="border-outline-variant text-primary mt-6 flex justify-between border-t pt-4 font-mono text-xs">
              <span>{stage.stat}</span>
              <span>{activeStage === stage.id ? 'open' : 'select'}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="interactive-panel mt-1 grid gap-6 p-5 lg:grid-cols-[1fr_2fr]">
        <div>
          <p className="meta-label text-accent">{stageDetail.title}</p>
          <dl className="mt-4 grid gap-3 font-mono text-xs">
            {stageDetail.rows.map(([label, value]) => (
              <div
                key={label}
                className="border-outline-variant flex justify-between gap-4 border-b pb-3"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-primary max-w-[280px] text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="pipeline-grid border-outline-variant relative min-h-40 overflow-hidden border p-4">
          <div className="border-primary/35 absolute inset-x-8 top-1/2 border-t border-dashed" />
          {['Capture', 'Normalize', 'Embed', 'Retrieve'].map((label, index) => (
            <div
              key={label}
              className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-2"
              style={{ left: `${8 + index * 29}%` }}
            >
              <span
                className="status-dot text-accent"
                data-state={index === 2 ? 'running' : 'queued'}
              />
              <span className="bg-background text-muted-foreground px-2 font-mono text-[10px] tracking-[0.14em] uppercase">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <div className="accent-hairline border-outline-variant mb-4 flex flex-col gap-4 border-b pb-3 md:flex-row md:items-center md:justify-between">
          <p className="meta-label text-primary">Device lifecycle explorer</p>
          <p className="meta-label text-accent">{selectedPhoneLabel}</p>
        </div>

        <div className="pipeline-grid border-outline-variant bg-background relative overflow-hidden border p-6">
          <div className="grid min-h-[560px] gap-6 lg:grid-cols-[1fr_1.25fr_1fr]">
            <div className="border-outline-variant/60 relative border-r pr-4">
              <p className="meta-label mb-8">Stage 1: Discovery</p>
              <div className="space-y-5">
                {sources.length > 0 ? (
                  sources.map((source) => {
                    const thumbnail = getSourceThumbnail(source);
                    const site = sourceSite(source.url);
                    return (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-orbit interactive-panel group group/source block overflow-hidden focus-visible:outline-none"
                      >
                        <div className="grid min-h-28 grid-cols-[104px_1fr] transition-all duration-300 group-hover/source:min-h-40 group-hover/source:grid-cols-[144px_1fr] group-focus-visible/source:min-h-40 group-focus-visible/source:grid-cols-[144px_1fr]">
                          <div className="border-outline-variant bg-surface-container relative border-r">
                            {thumbnail.kind === 'image' ? (
                              // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail or favicon.
                              <img
                                src={thumbnail.src}
                                alt=""
                                loading="lazy"
                                className={cn(
                                  'image-reveal h-full w-full',
                                  source.type === 'youtube' ? 'object-cover' : 'object-contain p-8',
                                )}
                              />
                            ) : (
                              <div className="flex h-full flex-col justify-between p-3">
                                <span className="text-primary font-mono text-lg">
                                  {SOURCE_MARKS[source.type]}
                                </span>
                                <span className="text-muted-foreground truncate font-mono text-[10px] uppercase">
                                  {thumbnail.detail}
                                </span>
                              </div>
                            )}
                            <div className="from-background/65 absolute inset-0 bg-gradient-to-t to-transparent" />
                          </div>
                          <div className="p-4">
                            <p className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                              {SOURCE_LABELS[source.type]}
                            </p>
                            <p className="text-muted-foreground group-hover/source:text-primary group-focus-visible/source:text-primary mt-2 line-clamp-2 text-sm leading-5">
                              {source.title}
                            </p>
                            <div className="text-muted-foreground mt-3 flex flex-wrap gap-2 font-mono text-[10px] tracking-[0.12em] uppercase">
                              <span>{source.chunkCount} chunks</span>
                              <span>quality {source.quality ?? 'n/a'}</span>
                            </div>
                            <div className="grid max-h-0 gap-1 overflow-hidden pt-0 font-mono text-[10px] tracking-[0.11em] uppercase opacity-0 transition-all duration-300 group-hover/source:max-h-28 group-hover/source:pt-4 group-hover/source:opacity-100 group-focus-visible/source:max-h-28 group-focus-visible/source:pt-4 group-focus-visible/source:opacity-100">
                              <span className="text-primary">
                                {source.channel ?? source.author ?? site}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDate(source.publishedAt)}
                              </span>
                              <span className="text-muted-foreground">{site}</span>
                              <span className="text-muted-foreground">
                                {formatViews(source.viewCount)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </a>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No active sources have been ingested for this phone yet.
                  </p>
                )}
              </div>
            </div>

            <div className="border-outline-variant/60 relative border-r px-4">
              <p className="meta-label absolute top-0 left-4">Stage 2: Synthesis</p>
              <div className="grid min-h-[560px] content-center gap-5 pt-10">
                <div className="relative mx-auto flex h-[340px] w-full max-w-md items-center justify-center overflow-hidden">
                  <div className="border-primary/25 pointer-events-none absolute inset-8 border border-dashed" />
                  <div className="llm-agent-ring border-accent/30 pointer-events-none absolute size-64 border" />
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className="flow-dot bg-accent absolute top-1/2 block size-2"
                      style={{ left: `${18 + index * 18}%` }}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setLlmOpen((current) => !current)}
                    aria-expanded={llmOpen}
                    className="pipeline-pulse border-primary bg-background hover:border-accent focus-visible:border-accent z-10 flex size-36 flex-col items-center justify-center border-2 text-center transition-colors focus-visible:outline-none"
                  >
                    <Cpu className="text-accent mb-2 size-5" aria-hidden />
                    <p className="text-gradient-accent-edge font-display text-3xl font-bold uppercase">
                      LLM
                    </p>
                    <p className="text-muted-foreground mt-2 font-mono text-[10px] tracking-[0.14em] uppercase">
                      {aspects.length} aspects
                    </p>
                  </button>
                  {aspects.slice(0, 7).map((aspect, index) => {
                    const angle = (Math.PI * 2 * index) / Math.max(aspects.slice(0, 7).length, 1);
                    const x = Math.cos(angle) * 42;
                    const y = Math.sin(angle) * 35;
                    const isSelected = selectedAspect?.aspect === aspect.aspect;
                    return (
                      <button
                        key={aspect.aspect}
                        type="button"
                        onClick={() => {
                          setSelectedAspectName(aspect.aspect);
                          setLlmOpen(true);
                        }}
                        aria-pressed={isSelected}
                        className={cn(
                          'synthesis-bubble interactive-panel group/aspect absolute w-28 p-3 text-left',
                          isSelected && 'border-accent bg-surface-container',
                        )}
                        style={{
                          left: `calc(50% + ${x}% - 56px)`,
                          top: `calc(50% + ${y}% - 42px)`,
                        }}
                      >
                        <span className="meta-label text-accent">{aspect.aspect}</span>
                        <span className="text-primary mt-1 block font-mono text-base">
                          {formatScore(aspect.score)}/10
                        </span>
                        <span className="text-muted-foreground mt-1 block overflow-hidden font-mono text-[10px] whitespace-nowrap opacity-70 transition-opacity group-hover/aspect:opacity-100">
                          confidence {aspect.confidence}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="interactive-panel bg-background/90 min-h-44 p-5">
                  {llmOpen && selectedAspect ? (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="meta-label text-accent">Extracted aspect</p>
                          <h3 className="text-gradient-steel font-display mt-2 text-3xl font-bold uppercase">
                            {selectedAspect.aspect}
                          </h3>
                        </div>
                        <p className="text-primary font-mono text-xl">
                          {formatScore(selectedAspect.score)}/10
                        </p>
                      </div>
                      <p className="text-muted-foreground mt-4 text-sm leading-6">
                        {selectedAspect.summary ??
                          'No summary has been generated for this aspect yet.'}
                      </p>
                      <div className="mt-4 grid gap-2 font-mono text-[10px] tracking-[0.12em] uppercase sm:grid-cols-3">
                        <span className="border-outline-variant text-primary border p-2">
                          confidence {selectedAspect.confidence}
                        </span>
                        <span className="border-outline-variant text-muted-foreground border p-2">
                          supporting {selectedAspect.nSupporting ?? 0}
                        </span>
                        <span className="border-outline-variant text-muted-foreground border p-2">
                          dissenting {selectedAspect.nDissenting ?? 0}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="meta-label text-accent">Agent activity</p>
                      <div className="mt-4 grid gap-3">
                        {[
                          'Read chunks',
                          'Extract claims',
                          'Resolve conflicts',
                          'Score aspects',
                        ].map((step, index) => (
                          <div key={step} className="flex items-center gap-3">
                            <span
                              className="status-dot text-accent"
                              data-state={index === 1 ? 'running' : 'success'}
                            />
                            <span className="text-primary font-mono text-xs tracking-[0.12em] uppercase">
                              {step}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="relative flex flex-col justify-center pl-4">
              <p className="meta-label absolute top-0 left-4">Stage 3: Retrieval event</p>
              <details className="interactive-panel group mt-16 p-6" open>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <p className="meta-label text-accent">
                    {latestRecommendedTurn ? 'Last query match' : 'Sample query'}
                  </p>
                  <p className="text-primary mt-5 text-2xl font-semibold">
                    &quot;{retrievalQuery}&quot;
                  </p>
                  <div className="border-outline-variant mt-6 flex items-end justify-between border-t pt-4">
                    <div>
                      <p className="meta-label">Candidate rank</p>
                      <p className="text-primary mt-2 font-mono text-lg">
                        {latestRecommendedTurn?.rank ? `#${latestRecommendedTurn.rank}` : 'ready'}
                      </p>
                    </div>
                    <span className="text-accent text-3xl">-&gt;</span>
                  </div>
                </summary>
                <div className="border-outline-variant mt-5 border-t pt-4">
                  <p className="text-muted-foreground text-sm leading-6">
                    {selectedPhoneLabel} surfaced because stored evidence matches these retrieval
                    signals:
                  </p>
                  <div className="mt-4 grid gap-2">
                    {evidenceReasons.map((reason) => (
                      <div
                        key={reason}
                        className="border-outline-variant flex items-center gap-3 border p-3"
                      >
                        <span className="status-dot text-accent" data-state="running" />
                        <span className="text-primary font-mono text-xs tracking-[0.12em] uppercase">
                          {reason}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="border-outline-variant mt-4 grid gap-3 border p-3 font-mono text-[10px] tracking-[0.12em] uppercase">
                    <span className="text-muted-foreground">
                      Retrieval source:{' '}
                      {latestRecommendedTurn ? 'recommendation history' : 'sample scenario'}
                    </span>
                    <span className="text-primary">
                      Latency: {latestRecommendedTurn?.latencyMs ?? 'n/a'} ms
                    </span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
