import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ChunkWorkbench } from '@/app/internal/pipeline/_components/chunk-workbench';
import { LifecycleExplorer } from '@/app/internal/pipeline/_components/lifecycle-explorer';
import { SectionHint } from '@/app/internal/pipeline/_components/section-hint';
import { PhoneImage } from '@/components/phone/PhoneImage';
import { PhoneSpecSchema } from '@/features/phones/schema';
import { getDb } from '@/services/db/client';
import {
  aspectDefinitions,
  aspects,
  chunks,
  phones,
  recommendationTurns,
  sources,
} from '@/services/db/schema';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Lifecycle Explorer | RECSY Command Center',
  description:
    'Interactive per-device data lifecycle probe: Ingestion, Chunking, Extraction, and Recommendation Retrieval.',
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

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

type PhoneOptionRow = {
  id: string;
  slug: string;
  brand: string;
  model: string;
  imageUrl: string | null;
  lastScorecardAt: Date | null;
};

type SelectedPhoneRow = PhoneOptionRow & {
  specJson: Record<string, unknown>;
};

function sourceLabel(type: SourceType) {
  if (type === 'youtube') return 'YouTube video';
  if (type === 'reddit') return 'Reddit post';
  if (type === 'gsmarena') return 'GSMArena page';
  return 'Article';
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
  const guardedPromise = promise.catch((error) => {
    console.error('optionalQuery error:', error);
    return fallback;
  });

  try {
    return await Promise.race([
      guardedPromise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error('optionalQuery unexpected failure:', error);
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

async function loadLifecycleDeviceData(selectedSlug: string | null) {
  const db = getDb();

  const phoneOptions = await optionalQuery(
    db
      .select({
        id: phones.id,
        slug: phones.slug,
        brand: phones.brand,
        model: phones.model,
        imageUrl: phones.imageUrl,
        lastScorecardAt: phones.lastScorecardAt,
      })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.brand), asc(phones.model))
      .limit(100),
    [],
    8000,
  );

  const selectedPhoneOption =
    phoneOptions.find((phone) => phone.slug === selectedSlug) ?? phoneOptions[0] ?? null;

  const selectedPhoneRows = selectedPhoneOption
    ? await optionalQuery(
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
          .where(eq(phones.id, selectedPhoneOption.id))
          .limit(1),
        [],
        6000,
      )
    : [];

  const selectedPhone =
    (selectedPhoneRows[0] as SelectedPhoneRow | undefined) ??
    (selectedPhoneOption
      ? ({ ...selectedPhoneOption, specJson: {} } satisfies SelectedPhoneRow)
      : null);

  const [deviceSources, deviceChunks, deviceAspects, sampleTurns] = await Promise.all([
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
            .limit(16),
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
            .limit(48),
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
  ]);

  const chunksBySource = groupChunksBySource(deviceChunks as ChunkRow[]);
  const specParsed = selectedPhone ? PhoneSpecSchema.safeParse(selectedPhone.specJson) : null;

  return {
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

export default async function LifecycleExplorerPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const selectedSlugParam = raw.phone;
  const selectedSlug = Array.isArray(selectedSlugParam)
    ? (selectedSlugParam[0] ?? null)
    : (selectedSlugParam ?? null);

  const {
    phoneOptions,
    selectedPhone,
    deviceSources,
    chunksBySource,
    deviceChunks,
    deviceAspects,
    sampleTurns,
    spec,
  } = await loadLifecycleDeviceData(selectedSlug);

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

  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/internal/command-center"
              className="text-muted-foreground hover:text-accent font-mono text-xs tracking-[0.14em] uppercase transition-colors"
            >
              ← Command Center
            </Link>
            <span className="text-muted-foreground/40 font-mono text-xs">/</span>
            <span className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
              Device Lifecycle Probe
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Lifecycle Explorer
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Interactive device schematics, evidence chunks, aspect radar, and retrieval matching
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="status-dot text-accent" data-state="running" />
          <span className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
            Probe Active: {selectedPhoneLabel}
          </span>
        </div>
      </header>

      {/* Device Probe Form */}
      <div className="accent-hairline border-outline-variant mt-10 flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
        <SectionHint label="Device probe selector">
          Selects the phone whose raw sources, chunks, scorecards, and recommendation history drive
          the live schematic views below.
        </SectionHint>
        <form action="/internal/lifecycle" className="flex items-center gap-3">
          <label htmlFor="phone" className="meta-label">
            Probe Phone
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
            Inspect
          </button>
        </form>
      </div>

      {/* 3-Stage Lifecycle Explorer */}
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

      {/* Corpus Overview & Chunk Workbench */}
      <section className="mt-12 grid gap-8 lg:grid-cols-12">
        <div className="border-outline-variant bg-background border lg:col-span-5">
          <div className="border-outline-variant border-b p-5">
            <SectionHint label="Corpus overview">
              Summarizes the selected phone&apos;s stored evidence coverage, scorecard readiness,
              source diversity, and retrieval state.
            </SectionHint>
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
                      <dd className="text-primary">{spec.rear_cameras?.[0]?.mp ?? 'n/a'}MP</dd>
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
    </main>
  );
}
