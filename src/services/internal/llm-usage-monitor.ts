import { desc, sql } from 'drizzle-orm';

import { env } from '@/env';
import { getDb } from '@/services/db/client';
import { llmCache, llmUsageEvents } from '@/services/db/schema';

import {
  clearGeminiQuotaCache,
  fetchGeminiQuotaFromGoogle,
  getConfiguredGeminiKeyCount,
  getConfiguredGeminiQuotaProjects,
  startOfPacificDay,
  type GeminiQuotaFetchResult,
} from './google-gemini-quota';
import { getConfiguredGeminiKeys } from '@/services/llm/gemini-keys';

export type LocalKeyQuotaBreakdown = {
  readonly apiKeyIndex: number;
  readonly keyName?: string;
  readonly projectId?: string | null;
  readonly callsToday: number;
  readonly tokensToday: number;
  readonly remainingCalls: number | null;
  readonly limit: number | null;
};

export type LocalQuotaSummary = {
  readonly callsToday: number;
  readonly inputTokensToday: number;
  readonly outputTokensToday: number;
  readonly dailyLimitPerKey: number | null;
  readonly totalDailyLimit: number | null;
  readonly remainingCallsToday: number | null;
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

let inFlightLlmDataPromise: Promise<{
  readonly data: LlmUsageMonitorData;
  readonly expiresAtMs: number;
}> | null = null;

export async function loadLlmUsageMonitorData(
  options: { forceRefresh?: boolean } = {},
): Promise<LlmUsageMonitorData> {
  const nowMs = Date.now();
  if (options.forceRefresh) {
    cachedLlmData = null;
    clearGeminiQuotaCache();
  } else if (cachedLlmData && nowMs < cachedLlmData.expiresAtMs) {
    return cachedLlmData.data;
  }

  if (!inFlightLlmDataPromise) {
    inFlightLlmDataPromise = fetchLlmUsageDataInternal().finally(() => {
      inFlightLlmDataPromise = null;
    });
  }

  const fresh = await inFlightLlmDataPromise;
  cachedLlmData = fresh;
  return fresh.data;
}

type SevenDayAggRow = {
  readonly area: string;
  readonly model: string;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly last_used_at: Date | string | null;
};

async function fetchLlmUsageDataInternal(): Promise<{
  readonly data: LlmUsageMonitorData;
  readonly expiresAtMs: number;
}> {
  const nowMs = Date.now();
  const db = getDb();
  const now = new Date();
  const [googleQuota, keyUsageRows, sevenDayRows, recentEvents, cacheStats] = await Promise.all([
    timedQuery(fetchGeminiQuotaFromGoogle(), googleQuotaTimeoutFallback(now), 8000),
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
            model,
            count(*)::int as calls,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            max(created_at) as last_used_at
          from llm_usage_events
          where created_at >= now() - interval '7 days'
          group by usage_area, model
        `) as Promise<SevenDayAggRow[]>,
        [],
        5000,
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

  let calls7d = 0;
  let inputTokens7d = 0;
  let outputTokens7d = 0;
  const areaMap = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number; lastUsedAt: Date | string | null }
  >();
  const modelMap = new Map<string, { calls: number; tokens: number }>();

  for (const row of sevenDayRows) {
    const calls = Number(row.calls ?? 0);
    const inTok = Number(row.input_tokens ?? 0);
    const outTok = Number(row.output_tokens ?? 0);
    calls7d += calls;
    inputTokens7d += inTok;
    outputTokens7d += outTok;

    const curArea = areaMap.get(row.area) ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastUsedAt: null,
    };
    const rowTime = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    const curTime = curArea.lastUsedAt ? new Date(curArea.lastUsedAt).getTime() : 0;
    areaMap.set(row.area, {
      calls: curArea.calls + calls,
      inputTokens: curArea.inputTokens + inTok,
      outputTokens: curArea.outputTokens + outTok,
      lastUsedAt: rowTime > curTime ? row.last_used_at : curArea.lastUsedAt,
    });

    const curModel = modelMap.get(row.model) ?? { calls: 0, tokens: 0 };
    modelMap.set(row.model, {
      calls: curModel.calls + calls,
      tokens: curModel.tokens + inTok + outTok,
    });
  }

  const topAreas = Array.from(areaMap.entries())
    .map(([area, data]) => ({
      area,
      calls: data.calls,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      lastUsedAt: data.lastUsedAt ? new Date(data.lastUsedAt).toISOString() : null,
    }))
    .sort(
      (a, b) =>
        b.calls - a.calls || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
    )
    .slice(0, 6);

  const modelMix = Array.from(modelMap.entries())
    .map(([model, data]) => ({
      model,
      calls: data.calls,
      tokens: data.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  const cache = cacheStats[0] ?? { entries: 0, hits: 0 };
  const configuredKeyCount = Math.max(1, getConfiguredGeminiKeyCount());
  const dailyLimitPerKey =
    env.GEMINI_RATE_LIMIT_PROFILE === 'google_ai_studio_free' ? env.GEMINI_FREE_RPD : null;
  const totalDailyLimit = dailyLimitPerKey === null ? null : configuredKeyCount * dailyLimitPerKey;

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

  const configuredKeys = getConfiguredGeminiKeys(env);
  const keysBreakdown = Array.from({ length: configuredKeyCount }, (_, idx) => {
    const stats = keyUsageMap.get(idx) ?? { calls: 0, tokens: 0 };
    const keyConfig = configuredKeys[idx];
    const keyLimit = dailyLimitPerKey;
    const remainingCalls = keyLimit !== null ? Math.max(0, keyLimit - stats.calls) : null;
    return {
      apiKeyIndex: idx,
      keyName: keyConfig?.name ?? `GEMINI_KEY_${idx + 1}`,
      projectId: keyConfig?.projectId ?? null,
      callsToday: stats.calls,
      tokensToday: stats.tokens,
      remainingCalls,
      limit: keyLimit,
    };
  });

  const remainingCallsToday =
    totalDailyLimit !== null ? Math.max(0, totalDailyLimit - callsToday) : null;

  const localQuota: LocalQuotaSummary = {
    callsToday,
    inputTokensToday,
    outputTokensToday,
    dailyLimitPerKey,
    totalDailyLimit,
    remainingCallsToday,
    keysBreakdown,
  };

  const result: LlmUsageMonitorData = {
    googleQuota,
    localQuota,
    configuredKeyCount,
    topAreas,
    recentEvents: recentEvents.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    modelMix,
    totals: {
      calls7d,
      inputTokens7d,
      outputTokens7d,
      cacheEntries: cache.entries,
      cacheHits: cache.hits,
    },
  };

  return { data: result, expiresAtMs: nowMs + 300_000 };
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
