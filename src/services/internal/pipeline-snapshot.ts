import { sql } from 'drizzle-orm';

import { getDb, type AppDb } from '@/services/db/client';
import { sourceTypeEnum } from '@/services/db/schema';

export interface PipelineSnapshot {
  readonly generatedAt: Date;
  readonly phones: {
    readonly total: number;
    readonly withEvidence: number;
    readonly withScorecard: number;
    readonly withSpecEmbedding: number;
  };
  readonly sources: {
    readonly total: number;
    readonly byType: Record<string, number>;
  };
  readonly chunks: {
    readonly total: number;
    readonly avgPerPhone: number;
  };
  readonly aspects: {
    readonly total: number;
    readonly phonesWithAspects: number;
  };
  readonly ingestRuns: {
    readonly total: number;
    readonly byStatus: Record<string, number>;
  };
  readonly chatQueries: {
    readonly total: number;
  };
  readonly recommendationTurns: {
    readonly total: number;
  };
  readonly llmCache: {
    readonly total: number;
    readonly totalHits: number;
  };
  readonly freshness: {
    readonly newestIngest: Date | null;
    readonly oldestIngest: Date | null;
    readonly overduePhones: number;
  };
  readonly tableGroups: readonly TableGroup[];
}

export interface TableGroup {
  readonly name: string;
  readonly description: string;
  readonly accent: string;
  readonly tables: readonly {
    readonly name: string;
    readonly rowCount: number;
    readonly purpose: string;
    readonly writtenBy: string;
    readonly readBy: string;
  }[];
}

interface TableDefinition {
  readonly name: string;
  readonly purpose: string;
  readonly writtenBy: string;
  readonly readBy: string;
}

interface TableGroupDefinition {
  readonly name: string;
  readonly description: string;
  readonly accent: string;
  readonly tables: readonly TableDefinition[];
}

const TABLE_GROUP_DEFINITIONS: readonly TableGroupDefinition[] = [
  {
    name: 'Catalog',
    description: 'The phone universe RECSY can browse, compare, retrieve against, and rank.',
    accent: 'var(--chart-1)',
    tables: [
      {
        name: 'phones',
        purpose: 'Canonical phone catalog, specs, images, ingestion freshness, and spec vectors.',
        writtenBy: 'Seeds, setup scripts, spec embedding backfill, ingestion scheduler',
        readBy: 'Browse, phone pages, recommender, ingestion, dashboard',
      },
      {
        name: 'phone_aliases',
        purpose: 'Alternate names used to match creator titles and comparison sources to phones.',
        writtenBy: 'Seed scripts',
        readBy: 'Ingestion alias matcher and disambiguator',
      },
    ],
  },
  {
    name: 'Corpus',
    description: 'Stored review evidence: source records, retrievable chunks, and phone links.',
    accent: 'var(--chart-3)',
    tables: [
      {
        name: 'sources',
        purpose: 'Fetched review artifacts with curator metadata, hashes, and source URLs.',
        writtenBy: 'Ingestion writer',
        readBy: 'Retrieval, scorecard, phone pages, dashboard',
      },
      {
        name: 'chunks',
        purpose: 'Embedded evidence excerpts used by hybrid retrieval and citation rendering.',
        writtenBy: 'Ingestion writer',
        readBy: 'Vector search, FTS search, scorecard, Q and A',
      },
      {
        name: 'source_phone_links',
        purpose: 'Primary and secondary phone associations for multi-phone sources.',
        writtenBy: 'Ingestion writer and disambiguator',
        readBy: 'Phone evidence views and future source surfacing',
      },
    ],
  },
  {
    name: 'Scorecard',
    description: 'Aspect methodology and generated consensus scores for each phone.',
    accent: 'var(--chart-4)',
    tables: [
      {
        name: 'aspect_definitions',
        purpose: 'Seven-axis methodology, prompts, versions, and default ranking weights.',
        writtenBy: 'Seed scripts',
        readBy: 'Scorecard agent and recommender',
      },
      {
        name: 'aspects',
        purpose: 'Per-phone aspect scores, confidence, summaries, and evidence quote references.',
        writtenBy: 'Scorecard agent',
        readBy: 'Phone pages and recommender ranking',
      },
    ],
  },
  {
    name: 'Ingestion Ops',
    description: 'Scheduling, telemetry, profiles, queue state, and polite crawling controls.',
    accent: 'var(--chart-2)',
    tables: [
      {
        name: 'ingest_runs',
        purpose:
          'Per-source ingestion telemetry: status, chunks written, tier, and rejection reason.',
        writtenBy: 'Ingestion orchestrator and writer',
        readBy: 'Ingest report and dashboard',
      },
      {
        name: 'crawl_queue',
        purpose: 'Scheduled work queue for automated ingestion.',
        writtenBy: 'Creator watch and scheduler',
        readBy: 'Automated ingestion runner',
      },
      {
        name: 'creator_profiles',
        purpose: 'Trusted creator allowlist for channel polling.',
        writtenBy: 'Seed scripts',
        readBy: 'Creator watch and YouTube channel adapter',
      },
      {
        name: 'subreddit_profiles',
        purpose: 'Subreddit allowlist and score thresholds.',
        writtenBy: 'Seed scripts',
        readBy: 'Reddit adapter',
      },
      {
        name: 'domain_profiles',
        purpose: 'Domain trust, robots cache, and host-specific crawl pacing.',
        writtenBy: 'Seed scripts and polite HTTP',
        readBy: 'Article, GSMArena, and polite HTTP layers',
      },
      {
        name: 'rate_limit_state',
        purpose: 'Persisted host token-bucket state for cooperative crawling.',
        writtenBy: 'Polite HTTP',
        readBy: 'Polite HTTP',
      },
    ],
  },
  {
    name: 'Product Usage',
    description: 'Question answering, recommendation sessions, turns, and feedback hooks.',
    accent: 'var(--accent)',
    tables: [
      {
        name: 'chat_queries',
        purpose: 'Persisted phone Q and A prompts, answers, citations, tokens, and latency.',
        writtenBy: 'POST /api/ask',
        readBy: 'Analytics, evaluation, and dashboard',
      },
      {
        name: 'recommendation_sessions',
        purpose: 'Anonymous recommender sessions keyed by a cookie.',
        writtenBy: 'POST /api/recommend',
        readBy: 'Recommender session logic',
      },
      {
        name: 'recommendation_turns',
        purpose: 'Structured requirements, candidate ids, picks, and latency per recommender turn.',
        writtenBy: 'POST /api/recommend',
        readBy: 'Recommender refinement and dashboard',
      },
      {
        name: 'recommendation_feedback',
        purpose: 'Future feedback loop events for picks.',
        writtenBy: 'Feedback UI (planned)',
        readBy: 'Future evaluation and learning loop',
      },
    ],
  },
  {
    name: 'Infrastructure',
    description: 'Cost controls and request-level rate limiting.',
    accent: 'var(--primary)',
    tables: [
      {
        name: 'llm_cache',
        purpose: 'Cached structured/chat LLM responses and hit counts.',
        writtenBy: 'Cached LLM provider',
        readBy: 'LLM provider',
      },
      {
        name: 'rate_limits',
        purpose: 'Public API rate-limit buckets keyed by hashed request identity.',
        writtenBy: 'Rate-limit middleware',
        readBy: 'Ask and recommend API routes',
      },
    ],
  },
];

export async function getPipelineSnapshot(): Promise<PipelineSnapshot> {
  const db = getDb();

  const [coreStats, sourceByTypeRows, ingestRunsByStatusRows, tableCounts] = await Promise.all([
    getCoreStats(db),
    getSourceTypeCounts(db),
    getIngestStatusCounts(db),
    getTableCounts(db),
  ]);

  return {
    generatedAt: new Date(),
    phones: {
      total: coreStats.phonesTotal,
      withEvidence: coreStats.phonesWithEvidence,
      withScorecard: coreStats.phonesWithScorecard,
      withSpecEmbedding: coreStats.phonesWithSpecEmbedding,
    },
    sources: {
      total: coreStats.sourcesTotal,
      byType: normalizeSourceTypeCounts(sourceByTypeRows),
    },
    chunks: {
      total: coreStats.chunksTotal,
      avgPerPhone:
        coreStats.phonesTotal > 0 ? roundOne(coreStats.chunksTotal / coreStats.phonesTotal) : 0,
    },
    aspects: {
      total: coreStats.aspectsTotal,
      phonesWithAspects: coreStats.phonesWithAspects,
    },
    ingestRuns: {
      total: coreStats.ingestRunsTotal,
      byStatus: Object.fromEntries(
        ingestRunsByStatusRows.map((row) => [row.status, Number(row.count)]),
      ),
    },
    chatQueries: {
      total: coreStats.chatQueriesTotal,
    },
    recommendationTurns: {
      total: coreStats.recommendationTurnsTotal,
    },
    llmCache: {
      total: coreStats.llmCacheTotal,
      totalHits: coreStats.llmCacheHits,
    },
    freshness: {
      newestIngest: coreStats.newestIngest,
      oldestIngest: coreStats.oldestIngest,
      overduePhones: coreStats.overduePhones,
    },
    tableGroups: getTableGroups(tableCounts),
  };
}

interface CoreStatsRow {
  readonly phones_total: number;
  readonly phones_with_evidence: number;
  readonly phones_with_scorecard: number;
  readonly phones_with_spec_embedding: number;
  readonly sources_total: number;
  readonly chunks_total: number;
  readonly aspects_total: number;
  readonly phones_with_aspects: number;
  readonly ingest_runs_total: number;
  readonly chat_queries_total: number;
  readonly recommendation_turns_total: number;
  readonly llm_cache_total: number;
  readonly llm_cache_hits: number;
  readonly newest_ingest: Date | string | null;
  readonly oldest_ingest: Date | string | null;
  readonly overdue_phones: number;
}

interface CountRow {
  readonly name: string;
  readonly count: number;
}

interface SourceTypeCountRow {
  readonly type: string;
  readonly count: number;
}

interface IngestStatusCountRow {
  readonly status: string;
  readonly count: number;
}

async function getCoreStats(db: AppDb): Promise<{
  readonly phonesTotal: number;
  readonly phonesWithEvidence: number;
  readonly phonesWithScorecard: number;
  readonly phonesWithSpecEmbedding: number;
  readonly sourcesTotal: number;
  readonly chunksTotal: number;
  readonly aspectsTotal: number;
  readonly phonesWithAspects: number;
  readonly ingestRunsTotal: number;
  readonly chatQueriesTotal: number;
  readonly recommendationTurnsTotal: number;
  readonly llmCacheTotal: number;
  readonly llmCacheHits: number;
  readonly newestIngest: Date | null;
  readonly oldestIngest: Date | null;
  readonly overduePhones: number;
}> {
  const rows = (await db.execute(sql`
    select
      (select count(*)::int from phones) as phones_total,
      (select count(distinct phone_id)::int from sources) as phones_with_evidence,
      (select count(distinct phone_id)::int from aspects) as phones_with_scorecard,
      (select count(*)::int from phones where spec_embedding is not null) as phones_with_spec_embedding,
      (select count(*)::int from sources) as sources_total,
      (select count(*)::int from chunks) as chunks_total,
      (select count(*)::int from aspects) as aspects_total,
      (select count(distinct phone_id)::int from aspects) as phones_with_aspects,
      (select count(*)::int from ingest_runs) as ingest_runs_total,
      (select count(*)::int from chat_queries) as chat_queries_total,
      (select count(*)::int from recommendation_turns) as recommendation_turns_total,
      (select count(*)::int from llm_cache) as llm_cache_total,
      (select coalesce(sum(hits), 0)::int from llm_cache) as llm_cache_hits,
      (select max(last_ingest_at) from phones) as newest_ingest,
      (select min(last_ingest_at) from phones) as oldest_ingest,
      (
        select count(*)::int
        from phones
        where status = 'active'
          and next_ingest_at is not null
          and next_ingest_at < now()
      ) as overdue_phones
  `)) as unknown as CoreStatsRow[];
  const row = rows[0];

  return {
    phonesTotal: Number(row?.phones_total ?? 0),
    phonesWithEvidence: Number(row?.phones_with_evidence ?? 0),
    phonesWithScorecard: Number(row?.phones_with_scorecard ?? 0),
    phonesWithSpecEmbedding: Number(row?.phones_with_spec_embedding ?? 0),
    sourcesTotal: Number(row?.sources_total ?? 0),
    chunksTotal: Number(row?.chunks_total ?? 0),
    aspectsTotal: Number(row?.aspects_total ?? 0),
    phonesWithAspects: Number(row?.phones_with_aspects ?? 0),
    ingestRunsTotal: Number(row?.ingest_runs_total ?? 0),
    chatQueriesTotal: Number(row?.chat_queries_total ?? 0),
    recommendationTurnsTotal: Number(row?.recommendation_turns_total ?? 0),
    llmCacheTotal: Number(row?.llm_cache_total ?? 0),
    llmCacheHits: Number(row?.llm_cache_hits ?? 0),
    newestIngest: toDateOrNull(row?.newest_ingest),
    oldestIngest: toDateOrNull(row?.oldest_ingest),
    overduePhones: Number(row?.overdue_phones ?? 0),
  };
}

async function getSourceTypeCounts(db: AppDb): Promise<readonly SourceTypeCountRow[]> {
  return (await db.execute(sql`
    select type::text, count(*)::int
    from sources
    group by type
  `)) as unknown as SourceTypeCountRow[];
}

async function getIngestStatusCounts(db: AppDb): Promise<readonly IngestStatusCountRow[]> {
  return (await db.execute(sql`
    select status::text, count(*)::int
    from ingest_runs
    group by status
  `)) as unknown as IngestStatusCountRow[];
}

async function getTableCounts(db: AppDb): Promise<ReadonlyMap<string, number>> {
  const rows = (await db.execute(sql`
    select 'phones' as name, count(*)::int as count from phones
    union all select 'phone_aliases', count(*)::int from phone_aliases
    union all select 'sources', count(*)::int from sources
    union all select 'chunks', count(*)::int from chunks
    union all select 'source_phone_links', count(*)::int from source_phone_links
    union all select 'aspect_definitions', count(*)::int from aspect_definitions
    union all select 'aspects', count(*)::int from aspects
    union all select 'ingest_runs', count(*)::int from ingest_runs
    union all select 'crawl_queue', count(*)::int from crawl_queue
    union all select 'creator_profiles', count(*)::int from creator_profiles
    union all select 'subreddit_profiles', count(*)::int from subreddit_profiles
    union all select 'domain_profiles', count(*)::int from domain_profiles
    union all select 'rate_limit_state', count(*)::int from rate_limit_state
    union all select 'chat_queries', count(*)::int from chat_queries
    union all select 'recommendation_sessions', count(*)::int from recommendation_sessions
    union all select 'recommendation_turns', count(*)::int from recommendation_turns
    union all select 'recommendation_feedback', count(*)::int from recommendation_feedback
    union all select 'llm_cache', count(*)::int from llm_cache
    union all select 'rate_limits', count(*)::int from rate_limits
  `)) as unknown as CountRow[];

  return new Map(rows.map((row) => [row.name, Number(row.count)]));
}

function getTableGroups(countByTable: ReadonlyMap<string, number>): readonly TableGroup[] {
  return TABLE_GROUP_DEFINITIONS.map((group) => ({
    name: group.name,
    description: group.description,
    accent: group.accent,
    tables: group.tables.map((definition) => ({
      name: definition.name,
      purpose: definition.purpose,
      writtenBy: definition.writtenBy,
      readBy: definition.readBy,
      rowCount: countByTable.get(definition.name) ?? 0,
    })),
  }));
}

function normalizeSourceTypeCounts(
  rows: readonly { type: string; count: number }[],
): Record<string, number> {
  const counts = Object.fromEntries(sourceTypeEnum.enumValues.map((type) => [type, 0]));
  for (const row of rows) {
    counts[row.type] = Number(row.count);
  }
  return counts;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
