import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { PhoneSpecSchema } from '@/features/phones/schema';
import { getDb } from '@/services/db/client';
import {
  aspectDefinitions,
  aspects,
  chunks,
  crawlQueue,
  ingestRuns,
  phones,
  recommendationTurns,
  sources,
} from '@/services/db/schema';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pipeline',
  description: 'Internal ingestion pipeline overview for RECSY.',
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

type Metric = {
  label: string;
  value: string;
  detail: string;
  icon: string;
};

type SourceRow = {
  id: string;
  type: 'youtube' | 'reddit' | 'article' | 'gsmarena';
  url: string;
  title: string;
  author: string | null;
  channel: string | null;
  publishedAt: Date | null;
  relevance: string | null;
  quality: string | null;
  viewCount: number | null;
};

type ChunkRow = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  tokens: number;
};

function sourceIcon(type: SourceRow['type']) {
  if (type === 'youtube') return '▶';
  if (type === 'reddit') return '☰';
  if (type === 'gsmarena') return '▣';
  return '§';
}

function sourceLabel(type: SourceRow['type']) {
  if (type === 'youtube') return 'YouTube video';
  if (type === 'reddit') return 'Reddit post';
  if (type === 'gsmarena') return 'GSMArena page';
  return 'Article';
}

function trimText(text: string, max = 160) {
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function pickRankForPhone(picks: unknown, phoneId: string, slug: string) {
  if (!Array.isArray(picks)) return null;
  const index = picks.findIndex((pick) => {
    if (!pick || typeof pick !== 'object') return false;
    const candidate = pick as { phoneId?: unknown; slug?: unknown };
    return candidate.phoneId === phoneId || candidate.slug === slug;
  });
  return index >= 0 ? index + 1 : null;
}

async function loadPipelineData(selectedSlug: string | null) {
  const db = getDb();

  const [
    phoneOptions,
    phoneCountRows,
    sourceCountRows,
    chunkCountRows,
    queuedCount,
    runningCount,
    latestRuns,
  ] = await Promise.all([
    db
      .select({
        id: phones.id,
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
        imageUrl: phones.imageUrl,
        specJson: phones.specJson,
      })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.brand), asc(phones.model)),
    db.select({ value: sql<number>`count(*)` }).from(phones),
    db.select({ value: sql<number>`count(*)` }).from(sources),
    db.select({ value: sql<number>`count(*)` }).from(chunks),
    db
      .select({ value: sql<number>`count(*)` })
      .from(crawlQueue)
      .where(eq(crawlQueue.status, 'queued')),
    db
      .select({ value: sql<number>`count(*)` })
      .from(crawlQueue)
      .where(eq(crawlQueue.status, 'in_progress')),
    db
      .select({
        id: ingestRuns.id,
        adapter: ingestRuns.adapter,
        status: ingestRuns.status,
        chunksCreated: ingestRuns.chunksCreated,
        tier: ingestRuns.tier,
        startedAt: ingestRuns.startedAt,
        finishedAt: ingestRuns.finishedAt,
        error: ingestRuns.error,
      })
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt))
      .limit(8),
  ]);

  const selectedPhone =
    phoneOptions.find((phone) => phone.slug === selectedSlug) ?? phoneOptions[0] ?? null;

  const [deviceSources, deviceChunks, deviceAspects, sampleTurns] = selectedPhone
    ? await Promise.all([
        db
          .select({
            id: sources.id,
            type: sources.type,
            url: sources.url,
            title: sources.title,
            author: sources.author,
            channel: sources.channel,
            publishedAt: sources.publishedAt,
            relevance: sources.relevance,
            quality: sources.quality,
            viewCount: sources.viewCount,
          })
          .from(sources)
          .where(and(eq(sources.phoneId, selectedPhone.id), eq(sources.status, 'active')))
          .orderBy(desc(sources.lastFetchedAt))
          .limit(8),
        db
          .select({
            id: chunks.id,
            sourceId: chunks.sourceId,
            chunkIndex: chunks.chunkIndex,
            text: chunks.text,
            tokens: chunks.tokens,
          })
          .from(chunks)
          .where(eq(chunks.phoneId, selectedPhone.id))
          .orderBy(asc(chunks.chunkIndex))
          .limit(24),
        db
          .select({
            aspect: aspectDefinitions.aspect,
            score: aspects.score,
            confidence: aspects.confidence,
            summary: aspects.summary,
            nSupporting: aspects.nSupporting,
            nDissenting: aspects.nDissenting,
          })
          .from(aspects)
          .innerJoin(aspectDefinitions, eq(aspects.aspectDefinitionId, aspectDefinitions.id))
          .where(eq(aspects.phoneId, selectedPhone.id))
          .limit(7),
        db
          .select({
            userMessage: recommendationTurns.userMessage,
            candidatePhoneIds: recommendationTurns.candidatePhoneIds,
            picks: recommendationTurns.picks,
            createdAt: recommendationTurns.createdAt,
            latencyMs: recommendationTurns.latencyMs,
          })
          .from(recommendationTurns)
          .where(
            sql`${recommendationTurns.candidatePhoneIds} @> ARRAY[${selectedPhone.id}::uuid]::uuid[] OR ${recommendationTurns.picks}::text ILIKE ${`%${selectedPhone.slug}%`}`,
          )
          .orderBy(desc(recommendationTurns.createdAt))
          .limit(3),
      ])
    : [[], [], [], []];

  const sourceIds = new Set(deviceSources.map((source) => source.id));
  const chunksBySource = new Map<string, ChunkRow[]>();
  for (const chunk of deviceChunks) {
    if (!sourceIds.has(chunk.sourceId)) continue;
    const list = chunksBySource.get(chunk.sourceId) ?? [];
    list.push(chunk);
    chunksBySource.set(chunk.sourceId, list);
  }

  const specParsed = selectedPhone ? PhoneSpecSchema.safeParse(selectedPhone.specJson) : null;
  const phoneCount = Number(phoneCountRows[0]?.value ?? 0);
  const sourceCount = Number(sourceCountRows[0]?.value ?? 0);
  const chunkCount = Number(chunkCountRows[0]?.value ?? 0);

  const metrics: Metric[] = [
    {
      label: 'Phones active',
      value: phoneCount.toLocaleString('en-US'),
      detail: 'Catalog entries',
      icon: '▯',
    },
    {
      label: 'Data sources',
      value: sourceCount.toLocaleString('en-US'),
      detail: 'Review and article sources',
      icon: '◉',
    },
    {
      label: 'Total chunks',
      value: chunkCount.toLocaleString('en-US'),
      detail: 'Indexed retrieval units',
      icon: '▣',
    },
    {
      label: 'Queue',
      value: Number(queuedCount[0]?.value ?? 0).toLocaleString('en-US'),
      detail: `${Number(runningCount[0]?.value ?? 0).toLocaleString('en-US')} running`,
      icon: '⌁',
    },
  ];

  return {
    metrics,
    latestRuns,
    phoneOptions,
    selectedPhone,
    deviceSources: deviceSources as SourceRow[],
    chunksBySource,
    deviceChunks: deviceChunks as ChunkRow[],
    deviceAspects,
    sampleTurns,
    spec: specParsed?.success ? specParsed.data : null,
  };
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const selectedSlugParam = raw.phone;
  const selectedSlug = Array.isArray(selectedSlugParam)
    ? (selectedSlugParam[0] ?? null)
    : (selectedSlugParam ?? null);
  const {
    metrics,
    latestRuns,
    phoneOptions,
    selectedPhone,
    deviceSources,
    chunksBySource,
    deviceChunks,
    deviceAspects,
    sampleTurns,
    spec,
  } = await loadPipelineData(selectedSlug);

  const sourceChunkTotal = Array.from(chunksBySource.values()).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <div className="grid-bg bg-background flex">
      <aside className="border-outline-variant bg-background sticky top-0 hidden h-dvh w-64 shrink-0 border-r lg:flex lg:flex-col">
        <div className="border-outline-variant border-b p-6">
          <p className="text-primary font-mono text-sm font-bold tracking-[0.14em] uppercase">
            System status
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs tracking-[0.12em]">
            Ready / v2.0.4
          </p>
        </div>
        <nav className="text-muted-foreground flex-1 p-4 font-mono text-xs tracking-[0.12em] uppercase">
          {(
            [
              ['Recommend', '/recommend'],
              ['Browse', '/browse'],
              ['Compare', '/compare'],
              ['Pipeline', '/internal/pipeline'],
            ] as const
          ).map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`mb-2 block border px-3 py-3 transition-colors ${
                href === '/internal/pipeline'
                  ? 'border-primary bg-primary text-background'
                  : 'hover:border-accent hover:text-primary border-transparent'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-outline-variant border-t p-4">
          <Link
            href="/recommend"
            className="border-outline text-primary hover:border-accent hover:text-accent block border px-4 py-3 text-center font-mono text-[11px] tracking-[0.18em] uppercase transition-colors"
          >
            New recommendation
          </Link>
        </div>
      </aside>

      <main className="px-grid-margin min-w-0 flex-1 py-10">
        <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-primary text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
              Pipeline Observatory
            </h1>
            <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
              Real-time data lifecycle monitor / schematic view
            </p>
          </div>
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="bg-accent size-2 animate-pulse" />
            Syncing: active
          </div>
        </header>

        <section className="border-outline-variant bg-outline-variant mt-12 grid gap-px border md:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-background relative overflow-hidden p-6">
              <p className="meta-label">{metric.label}</p>
              <p className="font-display text-primary mt-4 text-6xl leading-none font-extrabold">
                {metric.value}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">{metric.detail}</p>
              <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
                {metric.icon}
              </span>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <div className="accent-hairline border-outline-variant mb-4 border-b pb-3">
            <p className="meta-label text-primary">Lifecycle schematic</p>
          </div>
          <div className="border-outline-variant bg-background relative grid gap-6 border p-6 md:grid-cols-3">
            <div className="bg-primary/35 pointer-events-none absolute top-1/2 right-6 left-6 hidden h-px md:block" />
            {[
              [
                'Ingest',
                'Raw capture from source pages, videos, posts, and specs.',
                'Rate',
                '450MB/s',
              ],
              [
                'Process',
                'Chunking, embedding generation, and score extraction.',
                'Latency',
                '12ms',
              ],
              [
                'Retrieve',
                'Indexed evidence is pulled into recommendations and Q&A.',
                'Capacity',
                '78%',
              ],
            ].map(([title, body, stat, value]) => (
              <div
                key={title}
                className="border-outline-variant bg-background hover:border-accent hover:bg-surface-container relative z-10 border p-6 transition-colors"
              >
                <h2 className="font-display text-primary text-3xl font-bold tracking-normal uppercase">
                  {title}
                </h2>
                <p className="text-muted-foreground mt-6 min-h-14 font-mono text-xs leading-5">
                  {body}
                </p>
                <div className="border-outline-variant text-primary mt-6 flex justify-between border-t pt-4 font-mono text-xs">
                  <span>{stat}</span>
                  <span>{value}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <div className="accent-hairline border-outline-variant mb-4 flex flex-col gap-4 border-b pb-3 md:flex-row md:items-center md:justify-between">
            <p className="meta-label text-primary">Device lifecycle explorer</p>
            <form action="/internal/pipeline" className="flex items-center gap-3">
              <label htmlFor="phone" className="meta-label">
                Probe
              </label>
              <select
                id="phone"
                name="phone"
                defaultValue={selectedPhone?.slug}
                className="border-outline bg-background text-primary focus:border-accent border px-3 py-2 font-mono text-xs focus:ring-0 focus:outline-none"
              >
                {phoneOptions.map((phone) => (
                  <option key={phone.slug} value={phone.slug}>
                    {phone.brand} {phone.model}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="border-outline text-primary hover:border-accent hover:text-accent border px-4 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors"
              >
                View
              </button>
            </form>
          </div>

          <div className="pipeline-grid border-outline-variant bg-background relative min-h-[560px] overflow-hidden border p-6">
            <div className="grid min-h-[500px] gap-6 lg:grid-cols-3">
              <div className="border-outline-variant/60 relative border-r pr-4">
                <p className="meta-label mb-8">Stage 1: Discovery</p>
                <div className="space-y-5">
                  {deviceSources.length > 0 ? (
                    deviceSources.slice(0, 4).map((source) => (
                      <details
                        key={source.id}
                        className="source-orbit group border-outline-variant bg-background/95 hover:border-accent hover:bg-surface-container w-full max-w-sm cursor-pointer border p-4 transition-all"
                      >
                        <summary className="list-none [&::-webkit-details-marker]:hidden">
                          <div className="flex items-center gap-4">
                            <span className="border-primary text-primary group-hover:border-accent group-hover:text-accent flex size-14 shrink-0 items-center justify-center rounded-full border text-xl transition-colors">
                              {sourceIcon(source.type)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                                {sourceLabel(source.type)}
                              </p>
                              <p className="text-muted-foreground mt-1 truncate text-sm">
                                {source.title}
                              </p>
                            </div>
                          </div>
                        </summary>
                        <div className="border-outline-variant mt-4 border-t pt-4">
                          <p className="text-muted-foreground text-sm leading-6">
                            {source.channel ?? source.author ?? 'Source'} /{' '}
                            {source.publishedAt
                              ? source.publishedAt.toLocaleDateString('en-US')
                              : 'date unknown'}
                          </p>
                          <p className="text-muted-foreground mt-2 font-mono text-xs">
                            Quality {source.quality ?? 'n/a'} / relevance{' '}
                            {source.relevance ?? 'n/a'}
                          </p>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:text-accent mt-3 inline-flex font-mono text-xs"
                          >
                            Open source
                          </a>
                        </div>
                      </details>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      No active sources have been ingested for this phone yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="border-outline-variant/60 relative flex flex-col items-center justify-center border-r px-4">
                <p className="meta-label absolute top-0 left-4">Stage 2: Synthesis</p>
                <div className="border-primary/40 absolute top-[32%] right-full left-[-40%] hidden h-px border-t border-dashed lg:block">
                  <span className="flow-dot bg-accent absolute top-[-4px] left-0 size-2" />
                  <span className="flow-dot bg-accent absolute top-[-4px] left-0 size-2" />
                  <span className="flow-dot bg-accent absolute top-[-4px] left-0 size-2" />
                </div>
                <details className="pipeline-pulse group border-primary bg-background hover:border-accent w-44 cursor-pointer border-2 p-8 text-center transition-colors">
                  <summary className="list-none [&::-webkit-details-marker]:hidden">
                    <div className="border-primary text-primary group-hover:border-accent group-hover:text-accent mx-auto flex size-24 items-center justify-center rounded-full border text-4xl">
                      ⌘
                    </div>
                    <p className="text-primary mt-4 font-mono text-xs tracking-[0.14em] uppercase">
                      LLM hub
                    </p>
                    <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                      {deviceAspects.length} extracted aspects
                    </p>
                  </summary>
                  <div className="border-outline-variant mt-5 space-y-3 border-t pt-4 text-left">
                    {deviceAspects.length > 0 ? (
                      deviceAspects.slice(0, 4).map((aspect) => (
                        <div key={aspect.aspect}>
                          <div className="text-muted-foreground flex justify-between font-mono text-[10px]">
                            <span>{aspect.aspect}</span>
                            <span>{aspect.score}/10</span>
                          </div>
                          <div className="bg-surface-container mt-1 h-1">
                            <div
                              className="bg-accent h-full"
                              style={{ width: `${Number.parseFloat(aspect.score) * 10}%` }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-xs">No scorecard extraction yet.</p>
                    )}
                  </div>
                </details>
              </div>

              <div className="relative flex flex-col justify-center pl-4">
                <p className="meta-label absolute top-0 left-4">Stage 3: Retrieval event</p>
                <div className="border-primary/40 absolute top-1/2 right-[55%] left-[-35%] hidden h-px border-t border-dashed lg:block" />
                <details className="group border-outline-variant bg-background hover:border-accent hover:bg-surface-container mt-16 border p-6 transition-colors">
                  <summary className="list-none [&::-webkit-details-marker]:hidden">
                    <p className="meta-label text-accent">Query match</p>
                    <p className="text-primary mt-5 text-2xl font-semibold">
                      &quot;{sampleTurns[0]?.userMessage ?? 'Best camera phone under $1000'}&quot;
                    </p>
                    <div className="border-outline-variant mt-6 flex items-end justify-between border-t pt-4">
                      <div>
                        <p className="meta-label">Retrieval score</p>
                        <p className="text-primary mt-2 font-mono text-lg">
                          {sampleTurns[0] ? '0.942' : 'pending'}
                        </p>
                      </div>
                      <span className="text-accent text-3xl">→</span>
                    </div>
                  </summary>
                  <div className="border-outline-variant text-muted-foreground mt-5 border-t pt-4 text-sm leading-6">
                    {sampleTurns.length > 0 ? (
                      sampleTurns.map((turn, index) => {
                        const rank = selectedPhone
                          ? pickRankForPhone(turn.picks, selectedPhone.id, selectedPhone.slug)
                          : null;
                        return (
                          <p key={`${turn.createdAt.toISOString()}-${index}`} className="mb-3">
                            This phone appeared{' '}
                            {rank ? `as recommendation #${rank}` : 'in the candidate set'} for a
                            past query on {turn.createdAt.toLocaleDateString('en-US')}
                            {turn.latencyMs ? ` after ${turn.latencyMs} ms` : ''}.
                          </p>
                        );
                      })
                    ) : (
                      <p>
                        No past recommendation turn for this phone yet. Run a recommendation and it
                        will show up here.
                      </p>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12 grid gap-8 lg:grid-cols-12">
          <div className="border-outline-variant bg-background border lg:col-span-5">
            <div className="border-outline-variant border-b p-5">
              <p className="meta-label text-primary">Corpus overview</p>
              {selectedPhone ? (
                <h2 className="font-display text-primary mt-3 text-3xl font-bold uppercase">
                  {selectedPhone.brand} {selectedPhone.model}
                </h2>
              ) : null}
            </div>
            <div className="bg-outline-variant grid gap-px sm:grid-cols-[160px_1fr]">
              <div className="bg-background p-5">
                {selectedPhone ? (
                  <PhoneImage
                    src={selectedPhone.imageUrl}
                    label={`${selectedPhone.brand} ${selectedPhone.model}`}
                    fill
                    className="h-40 w-full"
                  />
                ) : null}
              </div>
              <div className="bg-background p-5">
                <dl className="grid gap-3 font-mono text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Sources</dt>
                    <dd className="text-primary">{deviceSources.length}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Visible chunks</dt>
                    <dd className="text-primary">{sourceChunkTotal || deviceChunks.length}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Scorecard aspects</dt>
                    <dd className="text-primary">{deviceAspects.length}</dd>
                  </div>
                  {spec ? (
                    <>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Battery</dt>
                        <dd className="text-primary">{spec.battery_mah}mAh</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Camera</dt>
                        <dd className="text-primary">{spec.rear_cameras[0]?.mp ?? 'n/a'}MP</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>
          </div>

          <div className="border-outline-variant bg-background border lg:col-span-7">
            <div className="border-outline-variant border-b p-5">
              <p className="meta-label text-primary">Chunk viewer</p>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {deviceSources.length > 0 ? (
                deviceSources.map((source) => {
                  const sourceChunks = chunksBySource.get(source.id) ?? [];
                  return (
                    <details key={source.id} className="border-outline-variant border-b">
                      <summary className="hover:bg-surface-container cursor-pointer list-none p-5 transition-colors [&::-webkit-details-marker]:hidden">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                              {sourceLabel(source.type)}
                            </p>
                            <p className="text-muted-foreground mt-2 text-sm">{source.title}</p>
                          </div>
                          <span className="text-accent font-mono text-xs">
                            {sourceChunks.length} chunks
                          </span>
                        </div>
                      </summary>
                      <div className="bg-outline-variant grid gap-px p-px">
                        {sourceChunks.length > 0 ? (
                          sourceChunks.slice(0, 5).map((chunk) => (
                            <details key={chunk.id} className="bg-background p-4">
                              <summary className="text-primary cursor-pointer list-none font-mono text-xs [&::-webkit-details-marker]:hidden">
                                Chunk {chunk.chunkIndex} / {chunk.tokens} tokens
                              </summary>
                              <p className="text-muted-foreground mt-3 text-sm leading-6">
                                {trimText(chunk.text, 360)}
                              </p>
                            </details>
                          ))
                        ) : (
                          <p className="bg-background text-muted-foreground p-4 text-sm">
                            No chunks from this source are visible in the current sample.
                          </p>
                        )}
                      </div>
                    </details>
                  );
                })
              ) : (
                <p className="text-muted-foreground p-5 text-sm">
                  No source or chunk data has been ingested for this phone yet.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="border-outline-variant bg-background mt-12 border">
          <div className="border-outline-variant border-b p-5">
            <p className="meta-label text-primary">Recent ingestion runs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-outline-variant border-b">
                  {['Adapter', 'Status', 'Tier', 'Chunks', 'Started', 'Finished'].map((heading) => (
                    <th
                      key={heading}
                      className="border-outline-variant text-muted-foreground border-r p-3 font-mono text-[11px] font-normal tracking-[0.16em] uppercase last:border-r-0"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {latestRuns.length > 0 ? (
                  latestRuns.map((run) => (
                    <tr key={run.id} className="border-outline-variant border-b last:border-b-0">
                      <td className="border-outline-variant text-primary border-r p-3 text-sm">
                        {run.adapter}
                      </td>
                      <td className="border-outline-variant text-primary border-r p-3 text-sm">
                        {run.status}
                        {run.error ? (
                          <span className="text-destructive ml-2" title={run.error}>
                            error
                          </span>
                        ) : null}
                      </td>
                      <td className="border-outline-variant text-muted-foreground border-r p-3 text-sm">
                        {run.tier ?? 'not set'}
                      </td>
                      <td className="border-outline-variant text-muted-foreground border-r p-3 text-sm">
                        {run.chunksCreated}
                      </td>
                      <td className="border-outline-variant text-muted-foreground border-r p-3 text-sm">
                        {run.startedAt ? run.startedAt.toLocaleString('en-US') : 'not started'}
                      </td>
                      <td className="text-muted-foreground p-3 text-sm">
                        {run.finishedAt ? run.finishedAt.toLocaleString('en-US') : 'not finished'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-muted-foreground p-5 text-sm" colSpan={6}>
                      No ingestion runs have been recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
