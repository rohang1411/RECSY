import { desc, sql } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { llmCache, llmUsageEvents } from '@/services/db/schema';

import {
  fetchGeminiQuotaFromGoogle,
  getConfiguredGeminiKeyCount,
  getConfiguredGeminiQuotaProjects,
  type GeminiQuotaFetchResult,
} from './google-gemini-quota';

export type LlmUsageAreaRow = {
  readonly area: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly lastUsedAt: string | null;
};

export type LlmUsageEventRow = {
  readonly id: string;
  readonly area: string;
  readonly feature: string | null;
  readonly operation: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly apiKeyIndex: number | null;
  readonly latencyMs: number | null;
  readonly createdAt: string;
};

export type LlmModelRow = {
  readonly model: string;
  readonly calls: number;
  readonly tokens: number;
};

export type LlmUsageMonitorData = {
  readonly googleQuota: GeminiQuotaFetchResult;
  readonly configuredKeyCount: number;
  readonly topAreas: readonly LlmUsageAreaRow[];
  readonly recentEvents: readonly LlmUsageEventRow[];
  readonly modelMix: readonly LlmModelRow[];
  readonly totals: {
    readonly calls7d: number;
    readonly inputTokens7d: number;
    readonly outputTokens7d: number;
    readonly cacheEntries: number;
    readonly cacheHits: number;
  };
};

type AreaAggRow = {
  readonly area: string;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly last_used_at: Date | string | null;
};

type ModelAggRow = {
  readonly model: string;
  readonly calls: number;
  readonly tokens: number;
};

type TotalRow = {
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
};

export async function loadLlmUsageMonitorData(): Promise<LlmUsageMonitorData> {
  const db = getDb();
  const now = new Date();
  const [googleQuota, topAreas, recentEvents, modelMix, totals, cacheStats] = await Promise.all([
    timedQuery(fetchGeminiQuotaFromGoogle(), googleQuotaTimeoutFallback(now), 2500),
    optionalQuery(
      timedQuery(
        db.execute(sql`
        select
          usage_area as area,
          count(*)::int as calls,
          coalesce(sum(input_tokens), 0)::int as input_tokens,
          coalesce(sum(output_tokens), 0)::int as output_tokens,
          max(created_at) as last_used_at
        from llm_usage_events
        where created_at >= now() - interval '7 days'
        group by usage_area
        order by calls desc, (coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0)) desc
        limit 6
      `) as Promise<AreaAggRow[]>,
        [],
      ),
      [],
    ),
    optionalQuery(
      timedQuery(
        db
          .select({
            id: llmUsageEvents.id,
            area: llmUsageEvents.usageArea,
            feature: llmUsageEvents.usageFeature,
            operation: llmUsageEvents.operation,
            model: llmUsageEvents.model,
            inputTokens: llmUsageEvents.inputTokens,
            outputTokens: llmUsageEvents.outputTokens,
            apiKeyIndex: llmUsageEvents.apiKeyIndex,
            latencyMs: llmUsageEvents.latencyMs,
            createdAt: llmUsageEvents.createdAt,
          })
          .from(llmUsageEvents)
          .orderBy(desc(llmUsageEvents.createdAt))
          .limit(10),
        [],
      ),
      [],
    ),
    optionalQuery(
      timedQuery(
        db.execute(sql`
        select
          model,
          count(*)::int as calls,
          coalesce(sum(input_tokens + output_tokens), 0)::int as tokens
        from llm_usage_events
        where created_at >= now() - interval '7 days'
        group by model
        order by tokens desc
        limit 5
      `) as Promise<ModelAggRow[]>,
        [],
      ),
      [],
    ),
    optionalQuery(
      timedQuery(
        db.execute(sql`
        select
          count(*)::int as calls,
          coalesce(sum(input_tokens), 0)::int as input_tokens,
          coalesce(sum(output_tokens), 0)::int as output_tokens
        from llm_usage_events
        where created_at >= now() - interval '7 days'
      `) as Promise<TotalRow[]>,
        [],
      ),
      [],
    ),
    optionalQuery(
      timedQuery(
        db
          .select({
            entries: sql<number>`count(*)::int`.mapWith(Number),
            hits: sql<number>`coalesce(sum(${llmCache.hits}), 0)::int`.mapWith(Number),
          })
          .from(llmCache),
        [{ entries: 0, hits: 0 }],
      ),
      [{ entries: 0, hits: 0 }],
    ),
  ]);

  const total = totals[0];
  const cache = cacheStats[0] ?? { entries: 0, hits: 0 };

  return {
    googleQuota,
    configuredKeyCount: getConfiguredGeminiKeyCount(),
    topAreas: topAreas.map((row) => ({
      area: row.area,
      calls: Number(row.calls),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    })),
    recentEvents: recentEvents.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    modelMix: modelMix.map((row) => ({
      model: row.model,
      calls: Number(row.calls),
      tokens: Number(row.tokens),
    })),
    totals: {
      calls7d: Number(total?.calls ?? 0),
      inputTokens7d: Number(total?.input_tokens ?? 0),
      outputTokens7d: Number(total?.output_tokens ?? 0),
      cacheEntries: cache.entries,
      cacheHits: cache.hits,
    },
  };
}

async function optionalQuery<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error('llm usage monitor query failed:', error);
    return fallback;
  }
}

async function timedQuery<T>(promise: Promise<T>, fallback: T, timeoutMs = 1200): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function googleQuotaTimeoutFallback(now: Date): GeminiQuotaFetchResult {
  const resetAt = new Date(now);
  resetAt.setUTCHours(24, 0, 0, 0);
  return {
    status: 'error',
    fetchedAt: now.toISOString(),
    resetAt: resetAt.toISOString(),
    projects: getConfiguredGeminiQuotaProjects(),
    message: 'Google quota fetch timed out while rendering the dashboard.',
    rows: [],
  };
}
