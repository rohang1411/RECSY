import { desc, sql } from 'drizzle-orm';

import { env } from '@/env';
import { getDb } from '@/services/db/client';
import { llmCache, llmUsageEvents } from '@/services/db/schema';

import {
  fetchGeminiQuotaFromGoogle,
  getConfiguredGeminiKeyCount,
  getConfiguredGeminiQuotaProjects,
  startOfPacificDay,
  type GeminiQuotaFetchResult,
} from './google-gemini-quota';

export type LocalKeyQuotaBreakdown = {
  readonly apiKeyIndex: number;
  readonly callsToday: number;
  readonly tokensToday: number;
  readonly remainingCalls: number;
  readonly limit: number;
};

export type LocalQuotaSummary = {
  readonly callsToday: number;
  readonly inputTokensToday: number;
  readonly outputTokensToday: number;
  readonly dailyLimitPerKey: number;
  readonly totalDailyLimit: number;
  readonly remainingCallsToday: number;
  readonly keysBreakdown: readonly LocalKeyQuotaBreakdown[];
};

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
  readonly localQuota: LocalQuotaSummary;
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

type KeyUsageAggRow = {
  readonly api_key_index: number | null;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
};

let cachedLlmData: {
  readonly data: LlmUsageMonitorData;
  readonly expiresAtMs: number;
} | null = null;

export async function loadLlmUsageMonitorData(): Promise<LlmUsageMonitorData> {
  const nowMs = Date.now();
  if (cachedLlmData && nowMs < cachedLlmData.expiresAtMs) {
    return cachedLlmData.data;
  }

  const db = getDb();
  const now = new Date();
  const [googleQuota, keyUsageRows, topAreas, recentEvents, modelMix, totals, cacheStats] =
    await Promise.all([
      timedQuery(fetchGeminiQuotaFromGoogle(), googleQuotaTimeoutFallback(now), 3000),
      optionalQuery(
        timedQuery(
          db.execute(sql`
          select
            api_key_index,
            count(*)::int as calls,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens
          from llm_usage_events
          where created_at >= ${startOfPacificDay(now).toISOString()}
          group by api_key_index
        `) as Promise<KeyUsageAggRow[]>,
          [],
          5000,
        ),
        [],
      ),
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
  const configuredKeyCount = Math.max(1, getConfiguredGeminiKeyCount());
  const dailyLimitPerKey = env.GEMINI_FREE_RPD ?? 20;
  const totalDailyLimit = configuredKeyCount * dailyLimitPerKey;

  const keyUsageMap = new Map<number, { calls: number; tokens: number }>();
  let callsToday = 0;
  let inputTokensToday = 0;
  let outputTokensToday = 0;

  for (const row of keyUsageRows) {
    const kIndex = row.api_key_index ?? 0;
    const c = Number(row.calls ?? 0);
    const inTok = Number(row.input_tokens ?? 0);
    const outTok = Number(row.output_tokens ?? 0);
    callsToday += c;
    inputTokensToday += inTok;
    outputTokensToday += outTok;
    const prev = keyUsageMap.get(kIndex) ?? { calls: 0, tokens: 0 };
    keyUsageMap.set(kIndex, { calls: prev.calls + c, tokens: prev.tokens + inTok + outTok });
  }

  const keysBreakdown = Array.from({ length: configuredKeyCount }, (_, idx) => {
    const stats = keyUsageMap.get(idx) ?? { calls: 0, tokens: 0 };
    return {
      apiKeyIndex: idx,
      callsToday: stats.calls,
      tokensToday: stats.tokens,
      remainingCalls: Math.max(0, dailyLimitPerKey - stats.calls),
      limit: dailyLimitPerKey,
    };
  });

  const localQuota: LocalQuotaSummary = {
    callsToday,
    inputTokensToday,
    outputTokensToday,
    dailyLimitPerKey,
    totalDailyLimit,
    remainingCallsToday: Math.max(0, totalDailyLimit - callsToday),
    keysBreakdown,
  };

  const result: LlmUsageMonitorData = {
    googleQuota,
    localQuota,
    configuredKeyCount,
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

  cachedLlmData = { data: result, expiresAtMs: nowMs + 45_000 };
  return result;
}

async function optionalQuery<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error('llm usage monitor query failed:', error);
    return fallback;
  }
}

async function timedQuery<T>(promise: Promise<T>, fallback: T, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safePromise = promise.catch((err) => {
    console.warn(
      'timedQuery query failed or timed out:',
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  });
  try {
    return await Promise.race([
      safePromise,
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
