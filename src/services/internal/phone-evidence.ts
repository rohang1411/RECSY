import { sql } from 'drizzle-orm';

import { getDb } from '@/services/db/client';

export interface PhoneEvidenceCatalog {
  readonly generatedAt: string;
  readonly defaultSlug: string | null;
  readonly options: readonly PhoneOption[];
  readonly evidenceBySlug: Record<string, PhoneEvidence>;
}

export interface PhoneOption {
  readonly slug: string;
  readonly label: string;
  readonly brand: string;
  readonly model: string;
  readonly sourceCount: number;
  readonly chunkCount: number;
  readonly aspectCount: number;
  readonly ingestRunCount: number;
  readonly hasSpecEmbedding: boolean;
}

export interface PhoneEvidence {
  readonly phone: {
    readonly id: string;
    readonly slug: string;
    readonly brand: string;
    readonly model: string;
    readonly imageUrl: string | null;
    readonly msrpUsd: number | null;
    readonly launchDate: string | null;
    readonly lastIngestAt: string | null;
    readonly nextIngestAt: string | null;
    readonly hasSpecEmbedding: boolean;
    readonly specHighlights: readonly SpecHighlight[];
  };
  readonly summary: {
    readonly sourceCount: number;
    readonly chunkCount: number;
    readonly aspectCount: number;
    readonly ingestRunCount: number;
    readonly averageQuality: number | null;
    readonly averageRelevance: number | null;
  };
  readonly sources: readonly EvidenceSource[];
  readonly chunks: readonly EvidenceChunk[];
  readonly aspects: readonly EvidenceAspect[];
  readonly ingestRuns: readonly EvidenceIngestRun[];
}

export interface SpecHighlight {
  readonly label: string;
  readonly value: string;
}

export interface EvidenceSource {
  readonly id: string;
  readonly phoneId: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly author: string | null;
  readonly channel: string | null;
  readonly language: string;
  readonly publishedAt: string | null;
  readonly lastFetchedAt: string | null;
  readonly contentHash: string;
  readonly status: string;
  readonly relevance: number | null;
  readonly quality: number | null;
  readonly sentimentSummary: string | null;
  readonly aspectsCovered: readonly string[];
  readonly viewCount: number | null;
  readonly engagementScore: number | null;
  readonly chunkCount: number;
}

export interface EvidenceChunk {
  readonly id: string;
  readonly phoneId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourceType: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly startTs: number | null;
  readonly endTs: number | null;
  readonly anchor: string | null;
  readonly tokens: number;
  readonly embeddingModel: string;
  readonly createdAt: string | null;
}

export interface EvidenceAspect {
  readonly aspect: string;
  readonly score: number;
  readonly rawScore: number;
  readonly confidence: number;
  readonly nSources: number;
  readonly nSupporting: number;
  readonly nDissenting: number;
  readonly summary: string;
  readonly updatedAt: string | null;
}

export interface EvidenceIngestRun {
  readonly id: string;
  readonly adapter: string;
  readonly sourceUrl: string | null;
  readonly status: string;
  readonly chunksCreated: number;
  readonly error: string | null;
  readonly tier: string | null;
  readonly discoveryStrategy: string | null;
  readonly rejectedReason: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
}

interface PhoneRow {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly image_url: string | null;
  readonly msrp_usd: string | number | null;
  readonly launch_date: Date | string | null;
  readonly spec_json: unknown;
  readonly has_spec_embedding: boolean;
  readonly last_ingest_at: Date | string | null;
  readonly next_ingest_at: Date | string | null;
}

interface SourceRow {
  readonly id: string;
  readonly phone_id: string;
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly author: string | null;
  readonly channel: string | null;
  readonly language: string;
  readonly published_at: Date | string | null;
  readonly last_fetched_at: Date | string | null;
  readonly content_hash: string;
  readonly status: string;
  readonly relevance: string | number | null;
  readonly quality: string | number | null;
  readonly sentiment_summary: string | null;
  readonly aspects_covered: string[] | null;
  readonly view_count: number | null;
  readonly engagement_score: string | number | null;
  readonly chunk_count: number;
}

interface ChunkRow {
  readonly id: string;
  readonly phone_id: string;
  readonly source_id: string;
  readonly source_title: string;
  readonly source_type: string;
  readonly chunk_index: number;
  readonly text: string;
  readonly start_ts: number | null;
  readonly end_ts: number | null;
  readonly anchor: string | null;
  readonly tokens: number;
  readonly embedding_model: string;
  readonly created_at: Date | string | null;
}

interface AspectRow {
  readonly phone_id: string;
  readonly aspect: string;
  readonly score: string | number;
  readonly raw_score: string | number;
  readonly confidence: string | number;
  readonly n_sources: number;
  readonly n_supporting: number;
  readonly n_dissenting: number;
  readonly summary: string;
  readonly updated_at: Date | string | null;
}

interface IngestRunRow {
  readonly id: string;
  readonly phone_id: string | null;
  readonly adapter: string;
  readonly source_url: string | null;
  readonly status: string;
  readonly chunks_created: number;
  readonly error: string | null;
  readonly tier: string | null;
  readonly discovery_strategy: string | null;
  readonly rejected_reason: string | null;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
  readonly duration_ms: number | null;
}

interface MutableEvidence {
  readonly phone: PhoneEvidence['phone'];
  readonly sources: EvidenceSource[];
  readonly chunks: EvidenceChunk[];
  readonly aspects: EvidenceAspect[];
  readonly ingestRuns: EvidenceIngestRun[];
}

export async function getPhoneEvidenceCatalog(): Promise<PhoneEvidenceCatalog> {
  const db = getDb();

  const phoneRows = (await db.execute(sql`
    select
      id,
      slug,
      brand,
      model,
      image_url,
      msrp_usd,
      launch_date,
      spec_json,
      spec_embedding is not null as has_spec_embedding,
      last_ingest_at,
      next_ingest_at
    from phones
    where status = 'active'
    order by brand, model
  `)) as unknown as PhoneRow[];

  const sourceRows = (await db.execute(sql`
    select
      s.id,
      s.phone_id,
      s.type::text,
      s.url,
      s.title,
      s.author,
      s.channel,
      s.language,
      s.published_at,
      s.last_fetched_at,
      s.content_hash,
      s.status::text,
      s.relevance,
      s.quality,
      s.sentiment_summary::text,
      s.aspects_covered,
      s.view_count,
      s.engagement_score,
      count(c.id)::int as chunk_count
    from sources s
    inner join phones p on p.id = s.phone_id
    left join chunks c on c.source_id = s.id
    where p.status = 'active'
    group by s.id
    order by s.last_fetched_at desc, s.title
  `)) as unknown as SourceRow[];

  const chunkRows = (await db.execute(sql`
    select *
    from (
      select
        c.id,
        c.phone_id,
        c.source_id,
        s.title as source_title,
        s.type::text as source_type,
        c.chunk_index,
        c.text,
        c.start_ts,
        c.end_ts,
        c.anchor,
        c.tokens,
        c.embedding_model,
        c.created_at,
        row_number() over (
          partition by c.phone_id
          order by s.last_fetched_at desc, s.title, c.chunk_index
        ) as phone_chunk_rank
      from chunks c
      inner join sources s on s.id = c.source_id
      inner join phones p on p.id = c.phone_id
      where p.status = 'active'
    ) ranked_chunks
    where phone_chunk_rank <= 80
    order by phone_id, source_title, chunk_index
  `)) as unknown as ChunkRow[];

  const aspectRows = (await db.execute(sql`
    select
      a.phone_id,
      ad.aspect::text as aspect,
      a.score,
      a.raw_score,
      a.confidence,
      a.n_sources,
      a.n_supporting,
      a.n_dissenting,
      a.summary,
      a.updated_at
    from aspects a
    inner join aspect_definitions ad on ad.id = a.aspect_definition_id
    inner join phones p on p.id = a.phone_id
    where p.status = 'active'
    order by a.phone_id, ad.aspect
  `)) as unknown as AspectRow[];

  const ingestRunRows = (await db.execute(sql`
    select *
    from (
      select
        ir.id,
        ir.phone_id,
        ir.adapter,
        ir.source_url,
        ir.status::text,
        ir.chunks_created,
        ir.error,
        ir.tier::text,
        ir.discovery_strategy,
        ir.rejected_reason,
        ir.started_at,
        ir.finished_at,
        ir.duration_ms,
        row_number() over (
          partition by ir.phone_id
          order by ir.started_at desc
        ) as phone_run_rank
      from ingest_runs ir
      inner join phones p on p.id = ir.phone_id
      where p.status = 'active'
    ) ranked_runs
    where phone_run_rank <= 16
    order by phone_id, started_at desc
  `)) as unknown as IngestRunRow[];

  const byPhoneId = new Map<string, MutableEvidence>();

  for (const row of phoneRows) {
    byPhoneId.set(row.id, {
      phone: {
        id: row.id,
        slug: row.slug,
        brand: row.brand,
        model: row.model,
        imageUrl: row.image_url,
        msrpUsd: toNumberOrNull(row.msrp_usd),
        launchDate: toIsoStringOrNull(row.launch_date),
        lastIngestAt: toIsoStringOrNull(row.last_ingest_at),
        nextIngestAt: toIsoStringOrNull(row.next_ingest_at),
        hasSpecEmbedding: Boolean(row.has_spec_embedding),
        specHighlights: getSpecHighlights(row.spec_json),
      },
      sources: [],
      chunks: [],
      aspects: [],
      ingestRuns: [],
    });
  }

  for (const row of sourceRows) {
    byPhoneId.get(row.phone_id)?.sources.push({
      id: row.id,
      phoneId: row.phone_id,
      type: row.type,
      url: row.url,
      title: row.title,
      author: row.author,
      channel: row.channel,
      language: row.language,
      publishedAt: toIsoStringOrNull(row.published_at),
      lastFetchedAt: toIsoStringOrNull(row.last_fetched_at),
      contentHash: row.content_hash,
      status: row.status,
      relevance: toNumberOrNull(row.relevance),
      quality: toNumberOrNull(row.quality),
      sentimentSummary: row.sentiment_summary,
      aspectsCovered: row.aspects_covered ?? [],
      viewCount: row.view_count,
      engagementScore: toNumberOrNull(row.engagement_score),
      chunkCount: Number(row.chunk_count ?? 0),
    });
  }

  for (const row of chunkRows) {
    byPhoneId.get(row.phone_id)?.chunks.push({
      id: row.id,
      phoneId: row.phone_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      sourceType: row.source_type,
      chunkIndex: Number(row.chunk_index),
      text: row.text,
      startTs: row.start_ts,
      endTs: row.end_ts,
      anchor: row.anchor,
      tokens: Number(row.tokens),
      embeddingModel: row.embedding_model,
      createdAt: toIsoStringOrNull(row.created_at),
    });
  }

  for (const row of aspectRows) {
    byPhoneId.get(row.phone_id)?.aspects.push({
      aspect: row.aspect,
      score: toNumber(row.score),
      rawScore: toNumber(row.raw_score),
      confidence: toNumber(row.confidence),
      nSources: Number(row.n_sources ?? 0),
      nSupporting: Number(row.n_supporting ?? 0),
      nDissenting: Number(row.n_dissenting ?? 0),
      summary: row.summary,
      updatedAt: toIsoStringOrNull(row.updated_at),
    });
  }

  for (const row of ingestRunRows) {
    if (!row.phone_id) continue;
    byPhoneId.get(row.phone_id)?.ingestRuns.push({
      id: row.id,
      adapter: row.adapter,
      sourceUrl: row.source_url,
      status: row.status,
      chunksCreated: Number(row.chunks_created ?? 0),
      error: row.error,
      tier: row.tier,
      discoveryStrategy: row.discovery_strategy,
      rejectedReason: row.rejected_reason,
      startedAt: toIsoStringOrNull(row.started_at),
      finishedAt: toIsoStringOrNull(row.finished_at),
      durationMs: row.duration_ms,
    });
  }

  const evidence = Array.from(byPhoneId.values()).map(toPhoneEvidence);
  const sortedEvidence = [...evidence].sort((a, b) => {
    const evidenceDelta = b.summary.chunkCount - a.summary.chunkCount;
    if (evidenceDelta !== 0) return evidenceDelta;
    return `${a.phone.brand} ${a.phone.model}`.localeCompare(`${b.phone.brand} ${b.phone.model}`);
  });
  const defaultSlug =
    sortedEvidence.find((item) => item.phone.slug === 'google-pixel-9-pro-xl')?.phone.slug ??
    sortedEvidence[0]?.phone.slug ??
    null;

  return {
    generatedAt: new Date().toISOString(),
    defaultSlug,
    options: sortedEvidence.map((item) => ({
      slug: item.phone.slug,
      label: `${item.phone.brand} ${item.phone.model}`,
      brand: item.phone.brand,
      model: item.phone.model,
      sourceCount: item.summary.sourceCount,
      chunkCount: item.summary.chunkCount,
      aspectCount: item.summary.aspectCount,
      ingestRunCount: item.summary.ingestRunCount,
      hasSpecEmbedding: item.phone.hasSpecEmbedding,
    })),
    evidenceBySlug: Object.fromEntries(sortedEvidence.map((item) => [item.phone.slug, item])),
  };
}

function toPhoneEvidence(item: MutableEvidence): PhoneEvidence {
  return {
    phone: item.phone,
    summary: {
      sourceCount: item.sources.length,
      chunkCount: item.chunks.length,
      aspectCount: item.aspects.length,
      ingestRunCount: item.ingestRuns.length,
      averageQuality: average(item.sources.map((source) => source.quality)),
      averageRelevance: average(item.sources.map((source) => source.relevance)),
    },
    sources: item.sources,
    chunks: item.chunks,
    aspects: item.aspects,
    ingestRuns: item.ingestRuns,
  };
}

function getSpecHighlights(value: unknown): readonly SpecHighlight[] {
  if (!isRecord(value)) return [];

  const preferredPaths: readonly (readonly string[])[] = [
    ['display', 'size'],
    ['display', 'type'],
    ['battery', 'capacityMah'],
    ['battery', 'chargingWatts'],
    ['camera', 'rear'],
    ['camera', 'main'],
    ['chipset'],
    ['processor'],
    ['memory', 'ram'],
    ['storage'],
    ['os'],
  ];

  const highlights: SpecHighlight[] = [];
  for (const path of preferredPaths) {
    const pathValue = getPath(value, path);
    if (pathValue === undefined) continue;
    highlights.push({
      label: prettifyLabel(path.at(-1) ?? path[0] ?? 'spec'),
      value: stringifySpecValue(pathValue),
    });
    if (highlights.length >= 6) return highlights;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue === null || typeof entryValue === 'object') continue;
    highlights.push({ label: prettifyLabel(key), value: stringifySpecValue(entryValue) });
    if (highlights.length >= 6) break;
  }

  return highlights;
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringifySpecValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringifySpecValue).filter(Boolean).slice(0, 3).join(', ');
  }
  if (isRecord(value)) {
    return Object.values(value).map(stringifySpecValue).filter(Boolean).slice(0, 3).join(', ');
  }
  if (typeof value === 'number') return value.toLocaleString('en-US');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return '';
}

function prettifyLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function average(values: readonly (number | null)[]): number | null {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 100) / 100;
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
