import { sql } from 'drizzle-orm';

import { getDb, type AppDb } from '@/services/db/client';
import { classifyTier, type IngestTier } from '@/services/ingest/scheduler/tiers';

export type IngestionStatusCategory =
  | 'complete'
  | 'queued'
  | 'quota_exhausted'
  | 'empty_corpus'
  | 'failed'
  | 'scorecard_missing'
  | 'never_scheduled';

export type IngestionPendingReasonCode =
  | 'in_crawl_queue'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'empty_corpus'
  | 'scorecard_missing'
  | 'spec_embedding_missing'
  | 'ingest_run_failed'
  | 'overdue_refresh'
  | 'never_scheduled';

export interface IngestionPendingReason {
  readonly code: IngestionPendingReasonCode;
  readonly label: string;
  readonly description: string;
  readonly errorDetail?: string | null;
  readonly stage?: string | null;
  readonly retryAfter?: string | null;
}

export interface PhoneIngestionRow {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly launchDate: string | null;
  readonly tier: IngestTier;
  readonly isComplete: boolean;
  readonly statusCategory: IngestionStatusCategory;
  readonly pendingReason: IngestionPendingReason | null;
  readonly sourceCount: number;
  readonly chunkCount: number;
  readonly aspectCount: number;
  readonly hasSpecEmbedding: boolean;
  readonly lastIngestAt: string | null;
  readonly nextIngestAt: string | null;
  readonly isOverdue: boolean;
  readonly queueInfo?: {
    readonly status: string;
    readonly adapter: string;
    readonly scheduledFor: string | null;
    readonly attempts: number;
    readonly lastError: string | null;
  } | null;
  readonly lastErrorDetail?: {
    readonly message: string;
    readonly stage: string | null;
    readonly errorCode: string | null;
    readonly timestamp: string;
  } | null;
}

export interface IngestionPendingReasonCount {
  readonly code: IngestionPendingReasonCode;
  readonly label: string;
  readonly count: number;
  readonly severity: 'info' | 'warning' | 'error';
}

export interface PhoneIngestionSummary {
  readonly totalActivePhones: number;
  readonly completedCount: number;
  readonly pendingCount: number;
  readonly queuedCount: number;
  readonly quotaExhaustedCount: number;
  readonly emptyCorpusCount: number;
  readonly failedCount: number;
  readonly scorecardMissingCount: number;
  readonly overdueCount: number;
  readonly neverScheduledCount: number;
  readonly totalChunks: number;
  readonly totalSources: number;
  readonly avgChunksPerPhone: number;
  readonly completionPercentage: number;
}

export interface PhoneIngestionData {
  readonly summary: PhoneIngestionSummary;
  readonly pendingReasons: readonly IngestionPendingReasonCount[];
  readonly rows: readonly PhoneIngestionRow[];
  readonly brands: readonly string[];
}

export interface IngestionFilterParams {
  readonly reason?: string | null;
  readonly brand?: string | null;
  readonly status?: string | null;
  readonly search?: string | null;
}

interface RawPhoneStatsRow {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly status: string;
  readonly launch_date: Date | string | null;
  readonly last_ingest_at: Date | string | null;
  readonly next_ingest_at: Date | string | null;
  readonly last_ingest_status: string | null;
  readonly has_spec_embedding: boolean | number;
  readonly source_count: number;
  readonly chunk_count: number;
  readonly aspect_count: number;
  readonly queue_status: string | null;
  readonly queue_adapter: string | null;
  readonly queue_scheduled_for: Date | string | null;
  readonly queue_attempts: number | null;
  readonly queue_last_error: string | null;
  readonly last_run_status: string | null;
  readonly last_run_error: string | null;
  readonly last_run_error_code: string | null;
  readonly last_run_stage: string | null;
  readonly last_run_started_at: Date | string | null;
}

export function classifyPhoneIngestion(
  raw: RawPhoneStatsRow,
  now = new Date(),
): {
  readonly isComplete: boolean;
  readonly statusCategory: IngestionStatusCategory;
  readonly pendingReason: IngestionPendingReason | null;
  readonly isOverdue: boolean;
} {
  const chunkCount = Number(raw.chunk_count || 0);
  const sourceCount = Number(raw.source_count || 0);
  const aspectCount = Number(raw.aspect_count || 0);
  const hasSpecEmbedding = Boolean(raw.has_spec_embedding);
  const nextIngestAt = raw.next_ingest_at ? new Date(raw.next_ingest_at) : null;
  const isOverdue = Boolean(nextIngestAt && nextIngestAt.getTime() < now.getTime());

  const hasFailedIngest = raw.last_ingest_status === 'failed' || raw.last_run_status === 'failed';
  const hasQuotaTrip =
    raw.last_ingest_status === 'quota_exhausted' ||
    raw.last_run_error_code === 'quota_exceeded' ||
    raw.last_run_error_code === 'quota_exhausted' ||
    (raw.last_run_error ? /quota/i.test(raw.last_run_error) : false);

  // Complete if chunks >= 5, sources >= 1, aspects >= 5, spec embedding is set, and no active failure
  const isComplete =
    chunkCount >= 5 &&
    sourceCount >= 1 &&
    aspectCount >= 5 &&
    hasSpecEmbedding &&
    !hasFailedIngest &&
    !hasQuotaTrip;

  if (isComplete) {
    if (isOverdue) {
      return {
        isComplete: true,
        statusCategory: 'complete',
        pendingReason: {
          code: 'overdue_refresh',
          label: 'Overdue for Refresh',
          description: `Freshness interval elapsed on ${nextIngestAt?.toISOString().slice(0, 10)}. Eligible for scheduled re-crawl.`,
        },
        isOverdue: true,
      };
    }
    return {
      isComplete: true,
      statusCategory: 'complete',
      pendingReason: null,
      isOverdue: false,
    };
  }

  // Not complete: Determine pending reason by priority
  if (hasQuotaTrip) {
    return {
      isComplete: false,
      statusCategory: 'quota_exhausted',
      pendingReason: {
        code: 'quota_exhausted',
        label: 'Quota Exhausted',
        description:
          'Gemini daily LLM quota or API rate limits reached during curation/scoring. Waiting for quota reset.',
        errorDetail: raw.last_run_error || 'Resource exhausted (429)',
        stage: raw.last_run_stage,
      },
      isOverdue,
    };
  }

  if (hasFailedIngest) {
    return {
      isComplete: false,
      statusCategory: 'failed',
      pendingReason: {
        code: 'ingest_run_failed',
        label: 'Ingestion Run Failed',
        description:
          raw.last_run_error ||
          raw.queue_last_error ||
          'Scraper or curator worker encountered an unhandled exception.',
        errorDetail: raw.last_run_error || raw.queue_last_error,
        stage: raw.last_run_stage,
      },
      isOverdue,
    };
  }

  if (raw.queue_status === 'queued' || raw.queue_status === 'in_progress') {
    return {
      isComplete: false,
      statusCategory: 'queued',
      pendingReason: {
        code: 'in_crawl_queue',
        label: 'Waiting in Crawl Queue',
        description: `Scheduled for ${raw.queue_adapter || 'review'} crawl (${raw.queue_attempts || 0} attempts executed).`,
        stage: raw.queue_status,
      },
      isOverdue,
    };
  }

  if (raw.last_ingest_at && chunkCount === 0) {
    return {
      isComplete: false,
      statusCategory: 'empty_corpus',
      pendingReason: {
        code: 'empty_corpus',
        label: 'Empty Corpus (0 Reviews)',
        description:
          'Scrapers searched online sources, but found zero reviews or transcripts for this device.',
      },
      isOverdue,
    };
  }

  if (chunkCount >= 5 && aspectCount < 5) {
    return {
      isComplete: false,
      statusCategory: 'scorecard_missing',
      pendingReason: {
        code: 'scorecard_missing',
        label: 'Missing Aspect Scorecard',
        description: `Evidence text is stored (${chunkCount} chunks), but the Scorecard Agent has not yet synthesized the 7-aspect score matrix.`,
      },
      isOverdue,
    };
  }

  if (!hasSpecEmbedding) {
    return {
      isComplete: false,
      statusCategory: 'scorecard_missing',
      pendingReason: {
        code: 'spec_embedding_missing',
        label: 'Spec Embedding Missing',
        description:
          'Phone specifications exist, but the 768-dimension semantic vector embedding has not been generated.',
      },
      isOverdue,
    };
  }

  if (!raw.last_ingest_at && !raw.queue_status) {
    return {
      isComplete: false,
      statusCategory: 'never_scheduled',
      pendingReason: {
        code: 'never_scheduled',
        label: 'Never Scheduled',
        description:
          'Promoted to catalog, but not yet scheduled or dispatched by the automated ingestion crawler.',
      },
      isOverdue,
    };
  }

  // Fallback
  return {
    isComplete: false,
    statusCategory: 'queued',
    pendingReason: {
      code: 'in_crawl_queue',
      label: 'Pending Ingestion',
      description: 'Awaiting next scheduled ingestion run.',
    },
    isOverdue,
  };
}

let cachedIngestionData: {
  readonly summary: PhoneIngestionSummary;
  readonly pendingReasons: readonly IngestionPendingReasonCount[];
  readonly rows: readonly PhoneIngestionRow[];
  readonly brands: readonly string[];
  readonly expiresAtMs: number;
} | null = null;

const EMPTY_INGESTION_SUMMARY: PhoneIngestionSummary = {
  totalActivePhones: 0,
  completedCount: 0,
  pendingCount: 0,
  queuedCount: 0,
  quotaExhaustedCount: 0,
  emptyCorpusCount: 0,
  failedCount: 0,
  scorecardMissingCount: 0,
  overdueCount: 0,
  neverScheduledCount: 0,
  totalChunks: 0,
  totalSources: 0,
  avgChunksPerPhone: 0,
  completionPercentage: 0,
};

async function safeQuery<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[phone-ingestion-dashboard] ${label} query timed out after ${timeoutMs}ms`);
        resolve(fallback);
      }, timeoutMs);
    });

    const guarded = promise.catch((error) => {
      console.warn(
        `[phone-ingestion-dashboard] ${label} query failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return fallback;
    });

    return await Promise.race([guarded, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadCommandCenterIngestionSummary(): Promise<PhoneIngestionSummary> {
  const data = await loadPhoneIngestionDashboardData();
  return data.summary;
}

export async function loadPhoneIngestionDashboardData(
  filters: IngestionFilterParams = {},
): Promise<PhoneIngestionData> {
  const now = Date.now();
  if (cachedIngestionData && cachedIngestionData.expiresAtMs > now) {
    return filterIngestionData(cachedIngestionData, filters);
  }

  try {
    const db = getDb();
    const rows = await safeQuery(
      fetchRawPhoneStats(db),
      [] as readonly RawPhoneStatsRow[],
      'fetchRawPhoneStats',
      8000,
    );

    const nowObj = new Date();
    const brandSet = new Set<string>();
    let totalChunks = 0;
    let totalSources = 0;

    const transformedRows: PhoneIngestionRow[] = rows.map((r) => {
      brandSet.add(r.brand);
      const chunks = Number(r.chunk_count || 0);
      const sources = Number(r.source_count || 0);
      totalChunks += chunks;
      totalSources += sources;

      const classification = classifyPhoneIngestion(r, nowObj);
      const tier = classifyTier(r.launch_date);

      return {
        id: r.id,
        slug: r.slug,
        brand: r.brand,
        model: r.model,
        launchDate: r.launch_date ? new Date(r.launch_date).toISOString().slice(0, 10) : null,
        tier,
        isComplete: classification.isComplete,
        statusCategory: classification.statusCategory,
        pendingReason: classification.pendingReason,
        sourceCount: sources,
        chunkCount: chunks,
        aspectCount: Number(r.aspect_count || 0),
        hasSpecEmbedding: Boolean(r.has_spec_embedding),
        lastIngestAt: r.last_ingest_at ? new Date(r.last_ingest_at).toISOString() : null,
        nextIngestAt: r.next_ingest_at ? new Date(r.next_ingest_at).toISOString() : null,
        isOverdue: classification.isOverdue,
        queueInfo: r.queue_status
          ? {
              status: r.queue_status,
              adapter: r.queue_adapter || 'unknown',
              scheduledFor: r.queue_scheduled_for
                ? new Date(r.queue_scheduled_for).toISOString()
                : null,
              attempts: Number(r.queue_attempts || 0),
              lastError: r.queue_last_error,
            }
          : null,
        lastErrorDetail: r.last_run_error
          ? {
              message: r.last_run_error,
              stage: r.last_run_stage,
              errorCode: r.last_run_error_code,
              timestamp: r.last_run_started_at
                ? new Date(r.last_run_started_at).toISOString()
                : new Date().toISOString(),
            }
          : null,
      };
    });

    const totalActivePhones = transformedRows.length;
    const completedCount = transformedRows.filter((r) => r.isComplete).length;
    const pendingCount = totalActivePhones - completedCount;

    let queuedCount = 0;
    let quotaExhaustedCount = 0;
    let emptyCorpusCount = 0;
    let failedCount = 0;
    let scorecardMissingCount = 0;
    let overdueCount = 0;
    let neverScheduledCount = 0;

    for (const r of transformedRows) {
      if (r.pendingReason?.code === 'in_crawl_queue') queuedCount++;
      if (r.pendingReason?.code === 'quota_exhausted') quotaExhaustedCount++;
      if (r.pendingReason?.code === 'empty_corpus') emptyCorpusCount++;
      if (r.pendingReason?.code === 'ingest_run_failed') failedCount++;
      if (
        r.pendingReason?.code === 'scorecard_missing' ||
        r.pendingReason?.code === 'spec_embedding_missing'
      )
        scorecardMissingCount++;
      if (r.pendingReason?.code === 'overdue_refresh') overdueCount++;
      if (r.pendingReason?.code === 'never_scheduled') neverScheduledCount++;
    }

    const summary: PhoneIngestionSummary = {
      totalActivePhones,
      completedCount,
      pendingCount,
      queuedCount,
      quotaExhaustedCount,
      emptyCorpusCount,
      failedCount,
      scorecardMissingCount,
      overdueCount,
      neverScheduledCount,
      totalChunks,
      totalSources,
      avgChunksPerPhone:
        totalActivePhones > 0 ? Math.round((totalChunks / totalActivePhones) * 10) / 10 : 0,
      completionPercentage:
        totalActivePhones > 0 ? Math.round((completedCount / totalActivePhones) * 1000) / 10 : 0,
    };

    const allPendingReasons: IngestionPendingReasonCount[] = [
      {
        code: 'in_crawl_queue',
        label: 'Waiting in Crawl Queue',
        count: queuedCount,
        severity: 'info',
      },
      {
        code: 'quota_exhausted',
        label: 'Quota Exhausted',
        count: quotaExhaustedCount,
        severity: 'warning',
      },
      {
        code: 'empty_corpus',
        label: 'Empty Corpus (0 Reviews)',
        count: emptyCorpusCount,
        severity: 'warning',
      },
      {
        code: 'scorecard_missing',
        label: 'Missing Aspect Scorecard',
        count: scorecardMissingCount,
        severity: 'info',
      },
      {
        code: 'ingest_run_failed',
        label: 'Ingestion Error / Failed',
        count: failedCount,
        severity: 'error',
      },
      {
        code: 'overdue_refresh',
        label: 'Overdue for Freshness Refresh',
        count: overdueCount,
        severity: 'info',
      },
      {
        code: 'never_scheduled',
        label: 'Never Scheduled',
        count: neverScheduledCount,
        severity: 'warning',
      },
    ];

    const pendingReasons = allPendingReasons.filter((pr) => pr.count > 0);

    const brands = Array.from(brandSet).sort();

    cachedIngestionData = {
      summary,
      pendingReasons,
      rows: transformedRows,
      brands,
      expiresAtMs: now + 45_000,
    };

    return filterIngestionData(cachedIngestionData, filters);
  } catch (err) {
    console.warn('[phone-ingestion-dashboard] loadPhoneIngestionDashboardData failed:', err);
    return {
      summary: EMPTY_INGESTION_SUMMARY,
      pendingReasons: [],
      rows: [],
      brands: [],
    };
  }
}

export function filterIngestionData(
  data: {
    readonly summary: PhoneIngestionSummary;
    readonly pendingReasons: readonly IngestionPendingReasonCount[];
    readonly rows: readonly PhoneIngestionRow[];
    readonly brands: readonly string[];
  },
  filters: IngestionFilterParams,
): PhoneIngestionData {
  let filtered = [...data.rows];

  if (filters.brand && filters.brand.toLowerCase() !== 'all') {
    const brandLower = filters.brand.toLowerCase().trim();
    filtered = filtered.filter((r) => r.brand.toLowerCase() === brandLower);
  }

  if (filters.status && filters.status.toLowerCase() !== 'all') {
    const s = filters.status.toLowerCase().trim();
    if (s === 'complete') {
      filtered = filtered.filter((r) => r.isComplete);
    } else if (s === 'pending') {
      filtered = filtered.filter((r) => !r.isComplete);
    } else {
      filtered = filtered.filter((r) => r.statusCategory === s);
    }
  }

  if (filters.reason && filters.reason.toLowerCase() !== 'all') {
    const rCode = filters.reason.toLowerCase().trim();
    filtered = filtered.filter((r) => r.pendingReason?.code.toLowerCase() === rCode);
  }

  if (filters.search && filters.search.trim().length > 0) {
    const query = filters.search.toLowerCase().trim();
    filtered = filtered.filter(
      (r) =>
        r.model.toLowerCase().includes(query) ||
        r.brand.toLowerCase().includes(query) ||
        r.slug.toLowerCase().includes(query) ||
        (r.pendingReason?.label && r.pendingReason.label.toLowerCase().includes(query)),
    );
  }

  return {
    summary: data.summary,
    pendingReasons: data.pendingReasons,
    rows: filtered,
    brands: data.brands,
  };
}

async function fetchRawPhoneStats(db: AppDb): Promise<readonly RawPhoneStatsRow[]> {
  const result = await db.execute(sql`
    WITH phone_stats AS (
      SELECT 
        p.id,
        p.slug,
        p.brand,
        p.model,
        p.status,
        p.launch_date,
        p.last_ingest_at,
        p.next_ingest_at,
        p.last_ingest_status,
        (p.spec_embedding IS NOT NULL) AS has_spec_embedding,
        COALESCE(s.source_count, 0) AS source_count,
        COALESCE(c.chunk_count, 0) AS chunk_count,
        COALESCE(a.aspect_count, 0) AS aspect_count,
        q.status AS queue_status,
        q.adapter AS queue_adapter,
        q.scheduled_for AS queue_scheduled_for,
        q.attempts AS queue_attempts,
        q.last_error AS queue_last_error,
        r.status AS last_run_status,
        r.error AS last_run_error,
        r.error_code AS last_run_error_code,
        r.stage AS last_run_stage,
        r.started_at AS last_run_started_at
      FROM phones p
      LEFT JOIN (
        SELECT phone_id, COUNT(*)::int AS source_count 
        FROM sources 
        GROUP BY phone_id
      ) s ON s.phone_id = p.id
      LEFT JOIN (
        SELECT phone_id, COUNT(*)::int AS chunk_count 
        FROM chunks 
        GROUP BY phone_id
      ) c ON c.phone_id = p.id
      LEFT JOIN (
        SELECT phone_id, COUNT(*)::int AS aspect_count 
        FROM aspects 
        GROUP BY phone_id
      ) a ON a.phone_id = p.id
      LEFT JOIN LATERAL (
        SELECT status, adapter, scheduled_for, attempts, last_error 
        FROM crawl_queue 
        WHERE phone_id = p.id 
        ORDER BY scheduled_for DESC LIMIT 1
      ) q ON true
      LEFT JOIN LATERAL (
        SELECT status, error, error_code, stage, started_at 
        FROM ingest_runs 
        WHERE phone_id = p.id 
        ORDER BY started_at DESC LIMIT 1
      ) r ON true
      WHERE p.status != 'discontinued' OR p.status IS NULL
      ORDER BY p.brand ASC, p.model ASC
    )
    SELECT * FROM phone_stats;
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: RawPhoneStatsRow[] })?.rows ?? []);
  return rows as unknown as RawPhoneStatsRow[];
}
