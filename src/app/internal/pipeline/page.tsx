import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ChunkWorkbench } from '@/app/internal/pipeline/_components/chunk-workbench';
import { LifecycleExplorer } from '@/app/internal/pipeline/_components/lifecycle-explorer';
import { WorkflowTables } from '@/app/internal/pipeline/_components/workflow-tables';
import { PhoneImage } from '@/components/phone/PhoneImage';
import { PhoneSpecSchema } from '@/features/phones/schema';
import { getDb } from '@/services/db/client';
import {
  aspectDefinitions,
  aspects,
  catalogCandidates,
  catalogRuns,
  chunks,
  crawlQueue,
  ingestRuns,
  phones,
  recommendationTurns,
  scorecardRuns,
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

type SourceType = 'youtube' | 'reddit' | 'article' | 'gsmarena';

type SourceRow = {
  id: string;
  type: SourceType;
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

const WORKFLOWS = [
  {
    id: 'ci',
    name: 'CI',
    trigger: 'push / pull request',
    purpose: 'Runs format, lint, typecheck, tests, and build verification.',
    status: 'ready',
  },
  {
    id: 'creator-watch',
    name: 'Creator watch',
    trigger: 'scheduled',
    purpose: 'Watches creator feeds and queues fresh mobile review sources.',
    status: 'ready',
  },
  {
    id: 'ingest-on-new-phone',
    name: 'Ingest on new phone',
    trigger: 'catalog change',
    purpose: 'Starts discovery when a new catalog phone appears.',
    status: 'ready',
  },
  {
    id: 'ingest-resume',
    name: 'Resume ingestion',
    trigger: 'scheduled / manual',
    purpose: 'Retries incomplete or quota-limited ingestion work.',
    status: 'ready',
  },
  {
    id: 'ingest-tiered',
    name: 'Tiered ingest',
    trigger: 'daily schedule',
    purpose: 'Refreshes hot, warm, and cold device corpora by freshness tier.',
    status: 'ready',
  },
  {
    id: 'scorecard-auto',
    name: 'Scorecard auto',
    trigger: 'after ingest',
    purpose: 'Regenerates aspect scorecards from newly embedded evidence.',
    status: 'ready',
  },
] as const;

function sourceLabel(type: SourceType) {
  if (type === 'youtube') return 'YouTube video';
  if (type === 'reddit') return 'Reddit post';
  if (type === 'gsmarena') return 'GSMArena page';
  return 'Article';
}

function formatDate(value: Date | null | undefined) {
  return value ? value.toLocaleString('en-US') : null;
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

async function optionalQuery<T>(promise: Promise<T>, fallback: T, timeoutMs = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error('optionalQuery error/timeout:', error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function groupChunksBySource(chunksList: readonly ChunkRow[]) {
  const map = new Map<string, ChunkRow[]>();
  for (const chunk of chunksList) {
    const list = map.get(chunk.sourceId) ?? [];
    list.push(chunk);
    map.set(chunk.sourceId, list);
  }
  return map;
}

function selectLifecycleSources(
  sourcesList: readonly SourceRow[],
  chunksBySource: Map<string, ChunkRow[]>,
) {
  const chosen: SourceRow[] = [];
  const seen = new Set<string>();

  for (const type of ['youtube', 'reddit', 'article', 'gsmarena'] as const) {
    const source = sourcesList.find((item) => item.type === type);
    if (!source) continue;
    chosen.push(source);
    seen.add(source.id);
  }

  for (const source of sourcesList) {
    if (chosen.length >= 6) break;
    if (seen.has(source.id)) continue;
    chosen.push(source);
  }

  return chosen.map((source) => ({
    ...source,
    publishedAt: source.publishedAt?.toISOString() ?? null,
    chunkCount: chunksBySource.get(source.id)?.length ?? 0,
  }));
}

async function loadPipelineData(selectedSlug: string | null) {
  const db = getDb();

  const phoneOptions = await optionalQuery(
    db
      .select({
        id: phones.id,
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
        imageUrl: phones.imageUrl,
        specJson: phones.specJson,
        lastScorecardAt: phones.lastScorecardAt,
      })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.brand), asc(phones.model)),
    [],
    3500,
  );

  const selectedPhone =
    phoneOptions.find((phone) => phone.slug === selectedSlug) ?? phoneOptions[0] ?? null;

  const [
    deviceSources,
    deviceChunks,
    deviceAspects,
    sampleTurns,
    latestRuns,
    scoreRuns,
    resumeRows,
    catalogRefreshRuns,
  ] = await Promise.all([
    selectedPhone
      ? optionalQuery(
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
            .limit(12),
          [],
        )
      : [],
    selectedPhone
      ? optionalQuery(
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
            .limit(32),
          [],
        )
      : [],
    selectedPhone
      ? optionalQuery(
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
          [],
        )
      : [],
    selectedPhone
      ? optionalQuery(
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
              sql`${recommendationTurns.candidatePhoneIds} @> ARRAY[${selectedPhone.id}]::uuid[]`,
            )
            .orderBy(desc(recommendationTurns.createdAt))
            .limit(3),
          [],
          2500,
        )
      : [],
    optionalQuery(
      db
        .select({
          id: ingestRuns.id,
          adapter: ingestRuns.adapter,
          status: ingestRuns.status,
          chunksCreated: ingestRuns.chunksCreated,
          tier: ingestRuns.tier,
          stage: ingestRuns.stage,
          errorCode: ingestRuns.errorCode,
          sourceUrl: ingestRuns.sourceUrl,
          startedAt: ingestRuns.startedAt,
          finishedAt: ingestRuns.finishedAt,
          error: ingestRuns.error,
        })
        .from(ingestRuns)
        .orderBy(desc(ingestRuns.startedAt))
        .limit(8),
      [],
      2500,
    ),
    optionalQuery(
      db
        .select({
          id: scorecardRuns.id,
          aspect: scorecardRuns.aspect,
          status: scorecardRuns.status,
          nSources: scorecardRuns.nSources,
          durationMs: scorecardRuns.durationMs,
          startedAt: scorecardRuns.startedAt,
          finishedAt: scorecardRuns.finishedAt,
          error: scorecardRuns.error,
        })
        .from(scorecardRuns)
        .orderBy(desc(scorecardRuns.startedAt))
        .limit(8),
      [],
      2500,
    ),
    optionalQuery(
      db
        .select({
          id: crawlQueue.id,
          adapter: crawlQueue.adapter,
          status: crawlQueue.status,
          tier: crawlQueue.tier,
          attempts: crawlQueue.attempts,
          scheduledFor: crawlQueue.scheduledFor,
          lastError: crawlQueue.lastError,
        })
        .from(crawlQueue)
        .orderBy(asc(crawlQueue.scheduledFor))
        .limit(8),
      [],
      2500,
    ),
    optionalQuery(
      db
        .select({
          id: catalogRuns.id,
          status: catalogRuns.status,
          stage: catalogRuns.stage,
          kind: catalogRuns.kind,
          error: catalogRuns.error,
          startedAt: catalogRuns.startedAt,
          finishedAt: catalogRuns.finishedAt,
        })
        .from(catalogRuns)
        .orderBy(desc(catalogRuns.startedAt))
        .limit(8),
      [],
      2500,
    ),
  ]);

  const chunksBySource = groupChunksBySource(deviceChunks as ChunkRow[]);
  const specParsed = selectedPhone ? PhoneSpecSchema.safeParse(selectedPhone.specJson) : null;
  const runningCount = resumeRows.filter((row) => row.status === 'in_progress').length;

  const metrics: Metric[] = [
    {
      label: 'Phones active',
      value: phoneOptions.length.toLocaleString('en-US'),
      detail: 'Catalog entries',
      icon: '[]',
    },
    {
      label: 'Device sources',
      value: deviceSources.length.toLocaleString('en-US'),
      detail: 'Visible for selected phone',
      icon: '()',
    },
    {
      label: 'Scorecards generated',
      value: phoneOptions.filter((p) => p.lastScorecardAt !== null).length.toLocaleString('en-US'),
      detail: `Out of ${phoneOptions.length.toLocaleString('en-US')} phones`,
      icon: '##',
    },
    {
      label: 'Queue',
      value: resumeRows.length.toLocaleString('en-US'),
      detail: `${runningCount.toLocaleString('en-US')} running`,
      icon: '>',
    },
  ];

  return {
    metrics,
    latestRuns,
    scoreRuns,
    resumeRows,
    catalogRefreshRuns,
    phoneOptions,
    selectedPhone,
    deviceSources: deviceSources as SourceRow[],
    chunksBySource,
    deviceChunks: deviceChunks as ChunkRow[],
    deviceAspects,
    sampleTurns,
    spec: specParsed?.success ? specParsed.data : null,
    runCandidateAggregates: [], // We'll fetch this below
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
    scoreRuns,
    resumeRows,
    catalogRefreshRuns,
    phoneOptions,
    selectedPhone,
    deviceSources,
    chunksBySource,
    deviceChunks,
    deviceAspects,
    sampleTurns,
    spec,
  } = await loadPipelineData(selectedSlug);

  const db = getDb();
  const runIds = catalogRefreshRuns.map((r) => r.id);
  const runCandidateAggregates =
    runIds.length > 0
      ? await optionalQuery(
          db
            .select({
              runId: catalogCandidates.lastRunId,
              decision: catalogCandidates.decision,
              status: catalogCandidates.status,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(catalogCandidates)
            .where(inArray(catalogCandidates.lastRunId, runIds))
            .groupBy(
              catalogCandidates.lastRunId,
              catalogCandidates.decision,
              catalogCandidates.status,
            ),
          [],
          2500,
        )
      : [];

  const sourceMix = deviceSources.reduce<Record<string, number>>((acc, source) => {
    acc[source.type] = (acc[source.type] ?? 0) + 1;
    return acc;
  }, {});
  const sourceMixLabel =
    Object.entries(sourceMix)
      .map(([type, count]) => `${type} ${count}`)
      .join(' / ') || 'none';
  const topAspect = deviceAspects
    .slice()
    .sort((a, b) => Number.parseFloat(String(b.score)) - Number.parseFloat(String(a.score)))[0];
  const latestSourceDate = deviceSources
    .map((source) => source.publishedAt)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const evidenceDensity =
    deviceSources.length > 0 ? Math.round(deviceChunks.length / deviceSources.length) : 0;
  const sourceDiversity = Object.keys(sourceMix).length;
  const extractionCoverage =
    deviceChunks.length > 0
      ? Math.min(100, Math.round((deviceAspects.length / Math.min(deviceChunks.length, 12)) * 100))
      : 0;
  const recommendedTurns = selectedPhone
    ? sampleTurns
        .map((turn) => ({
          userMessage: turn.userMessage,
          createdAt: turn.createdAt.toISOString(),
          latencyMs: turn.latencyMs,
          rank: pickRankForPhone(turn.picks, selectedPhone.id, selectedPhone.slug),
        }))
        .filter((turn) => turn.rank != null)
    : [];
  const retrievalState =
    recommendedTurns.length > 0
      ? 'Matched in past query'
      : deviceChunks.length > 0
        ? 'Ready'
        : 'Warming up';
  const selectedPhoneLabel = selectedPhone
    ? `${selectedPhone.brand} ${selectedPhone.model}`
    : 'No phone selected';
  const evidenceReasons = [
    topAspect ? `Strong ${topAspect.aspect} signal` : null,
    deviceSources.some((source) => source.type === 'youtube') ? 'Video evidence available' : null,
    deviceChunks.length > 0 ? `${deviceChunks.length} chunks indexed` : null,
    recommendedTurns[0] ? 'Matched a past recommendation turn' : null,
  ].filter((value): value is string => Boolean(value));

  const lifecycleSourceRows = selectLifecycleSources(deviceSources, chunksBySource);
  const serializedSources = deviceSources.map((source) => ({
    id: source.id,
    type: sourceLabel(source.type),
    title: source.title,
    url: source.url,
  }));
  const serializedChunks = deviceChunks.map((chunk) => ({ ...chunk }));
  const serializedAspects = deviceAspects.map((aspect) => ({
    aspect: String(aspect.aspect),
    score: String(aspect.score),
    confidence: String(aspect.confidence),
    summary: aspect.summary,
    nSupporting: aspect.nSupporting,
    nDissenting: aspect.nDissenting,
  }));
  const serializedTurns = recommendedTurns;

  const ingestionRows = latestRuns.map((run) => ({
    id: run.id,
    label: `${run.adapter}${run.stage ? ` / ${run.stage}` : ''}`,
    status: run.status,
    detail: run.error ?? run.errorCode ?? `${run.chunksCreated} chunks / ${run.tier ?? 'no tier'}`,
    startedAt: formatDate(run.startedAt),
    finishedAt: formatDate(run.finishedAt),
  }));
  const scorecardRows = scoreRuns.map((run) => ({
    id: run.id,
    label: run.aspect,
    status: run.status,
    detail: run.error ?? `${run.nSources ?? 0} sources / ${run.durationMs ?? 0} ms`,
    startedAt: formatDate(run.startedAt),
    finishedAt: formatDate(run.finishedAt),
  }));
  const resumeRunRows = resumeRows.map((row) => ({
    id: row.id,
    label: `${row.adapter} / ${row.tier}`,
    status: row.status,
    detail: row.lastError ?? `${row.attempts} attempts`,
    startedAt: formatDate(row.scheduledFor),
    finishedAt: null,
  }));
  const catalogRunRows = catalogRefreshRuns.map((run) => {
    const aggregates = runCandidateAggregates.filter((a) => a.runId === run.id);
    let added = 0;
    let pending = 0;
    let approved = 0;
    let failed = 0;

    for (const agg of aggregates) {
      added += agg.count;
      if (agg.decision === 'pending_review') {
        pending += agg.count;
      } else if (agg.status === 'promoted' || agg.decision === 'promote') {
        approved += agg.count;
      } else {
        failed += agg.count;
      }
    }

    let detailStr = run.error ?? (run.stage ? `Stage: ${run.stage}` : 'Completed');
    if (added > 0) {
      detailStr = `Added: ${added} (Pending: ${pending}, Approved: ${approved}, Failed/Other: ${failed})`;
    }

    return {
      id: run.id,
      label: `Catalog Refresh / ${run.kind}`,
      status: run.status,
      detail: detailStr,
      startedAt: formatDate(run.startedAt),
      finishedAt: formatDate(run.finishedAt),
    };
  });

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
      </aside>

      <main className="px-grid-margin min-w-0 flex-1 py-10">
        <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="heading-scanline font-display text-gradient-accent-edge text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
              Pipeline Observatory
            </h1>
            <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
              Real-time data lifecycle monitor / schematic view
            </p>
          </div>
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="status-dot text-accent" data-state="running" />
            Syncing: active
          </div>
        </header>

        <section className="border-outline-variant bg-outline-variant mt-12 grid gap-px border md:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-background relative overflow-hidden p-6">
              <p className="meta-label">{metric.label}</p>
              <p className="font-display text-gradient-steel mt-4 text-6xl leading-none font-extrabold">
                {metric.value}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">{metric.detail}</p>
              <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
                {metric.icon}
              </span>
            </div>
          ))}
        </section>

        <div className="accent-hairline border-outline-variant mt-12 flex flex-col gap-4 border-b pb-3 md:flex-row md:items-center md:justify-between">
          <p className="meta-label text-primary">Device probe</p>
          <form action="/internal/pipeline" className="flex items-center gap-3">
            <label htmlFor="phone" className="meta-label">
              Phone
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

        <LifecycleExplorer
          sources={lifecycleSourceRows}
          aspects={serializedAspects}
          turns={serializedTurns}
          chunkCount={deviceChunks.length}
          sourceMixLabel={sourceMixLabel}
          selectedPhoneLabel={selectedPhoneLabel}
          evidenceReasons={
            evidenceReasons.length > 0 ? evidenceReasons : ['Evidence profile pending']
          }
        />

        <section className="mt-12 grid gap-8 lg:grid-cols-12">
          <div className="border-outline-variant bg-background border lg:col-span-5">
            <div className="border-outline-variant border-b p-5">
              <p className="meta-label text-primary">Corpus overview</p>
              {selectedPhone ? (
                <h2 className="text-gradient-steel font-display mt-3 text-3xl font-bold uppercase">
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
                  {[
                    ['Sources', String(deviceSources.length)],
                    ['Visible chunks', String(deviceChunks.length)],
                    ['Scorecard aspects', String(deviceAspects.length)],
                    ['Source mix', sourceMixLabel],
                    [
                      'Strongest signal',
                      topAspect ? `${topAspect.aspect} ${topAspect.score}/10` : 'pending',
                    ],
                    [
                      'Newest source',
                      latestSourceDate ? latestSourceDate.toLocaleDateString('en-US') : 'unknown',
                    ],
                    ['Evidence density', `${evidenceDensity} chunks/source`],
                    ['Source diversity', `${sourceDiversity} source types`],
                    ['Extraction coverage', `${extractionCoverage}%`],
                    ['Retrieval state', retrievalState],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-primary max-w-[220px] text-right">{value}</dd>
                    </div>
                  ))}
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

          <ChunkWorkbench
            sources={serializedSources}
            chunks={serializedChunks}
            aspectLabels={serializedAspects.map((aspect) => aspect.aspect)}
          />
        </section>

        <WorkflowTables
          ingestionRuns={ingestionRows}
          scorecardRuns={scorecardRows}
          resumeRows={resumeRunRows}
          catalogRefreshRuns={catalogRunRows}
          workflows={WORKFLOWS}
        />
      </main>
    </div>
  );
}
