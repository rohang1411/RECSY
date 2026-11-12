import { logger } from '@/services/logger';
import { getCacheStats as getAbuseCacheStats } from '@/services/auth/abuse-cache';
import { getCacheStats as getPlatformCacheStats } from '@/services/metering/platform';
import { getCacheStats as getCatalogCacheStats } from '@/services/recommender/catalog-cache';
import { getCacheStats as getVectorCacheStats } from '@/services/retrieval/vector-cache';
import { getCacheStats as getRetrieverCacheStats } from '@/services/retrieval/retriever';
import { getCacheStats as getBrowseBrandsCacheStats } from '@/app/browse/brands-cache';
import type {
  ChargeSource,
  MeteredRequestCacheSummary,
  MeteredRequestOutcome,
  MeteredRequestSummary,
} from './types';

const log = logger.child({ component: 'metered-request' });

let lastCacheStatsLoggedAt = 0;

export interface EmitMeteredRequestSummaryInput {
  readonly traceId: string;
  readonly route: string;
  readonly quotaMode: 'off' | 'shadow' | 'enforce';
  readonly byok: boolean;
  readonly userId?: string | null;
  readonly deviceId?: string | null;
  readonly chargeSource?: ChargeSource | null;
  readonly outcome: MeteredRequestOutcome;
  readonly denial?: string | null;
  readonly reserveMs: number;
  readonly settleMs: number;
  readonly totalMs: number;
  readonly model?: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly costMicros?: number | null;
  readonly cacheHit?: boolean | null;
  readonly httpStatus: number;
  readonly stages?: Readonly<Record<string, number>>;
  readonly ttfbMs?: number;
  readonly ttfvtMs?: number;
  readonly cache?: MeteredRequestCacheSummary;
}

export function buildMeteredRequestSummary(
  input: EmitMeteredRequestSummaryInput,
): MeteredRequestSummary {
  let subjectKind: 'user' | 'device' | 'ip' | 'byok' = 'device';
  if (input.byok) {
    subjectKind = 'byok';
  } else if (input.userId) {
    subjectKind = 'user';
  } else if (input.deviceId && input.deviceId.startsWith('nocookie:')) {
    subjectKind = 'ip';
  } else {
    subjectKind = 'device';
  }

  const userRef = input.userId ? input.userId.slice(0, 8) : null;
  const deviceRef = input.deviceId ? input.deviceId.slice(0, 8) : 'unknown';

  const summary: MeteredRequestSummary = {
    event: 'metered_request',
    traceId: input.traceId,
    route: input.route,
    quotaMode: input.quotaMode,
    subjectKind,
    userRef,
    deviceRef,
    chargeSource: input.chargeSource ?? 'none',
    outcome: input.outcome,
    denial: input.denial ?? null,
    reserveMs: Math.round(input.reserveMs),
    settleMs: Math.round(input.settleMs),
    totalMs: Math.round(input.totalMs),
    model: input.model ?? null,
    tokensIn: Math.max(0, input.tokensIn ?? 0),
    tokensOut: Math.max(0, input.tokensOut ?? 0),
    costMicros: Math.max(0, input.costMicros ?? 0),
    cacheHit: Boolean(input.cacheHit),
    httpStatus: input.httpStatus,
    ...(input.stages ? { stages: input.stages } : {}),
    ...(input.ttfbMs !== undefined ? { ttfbMs: Math.round(input.ttfbMs) } : {}),
    ...(input.ttfvtMs !== undefined ? { ttfvtMs: Math.round(input.ttfvtMs) } : {}),
    ...(input.cache ? { cache: input.cache } : {}),
  };

  return summary;
}

/**
 * Emits exactly one info log line with event=metered_request.
 * Normative reference: Section 13.2 of plan 25; Plan 26 WP-00.
 */
export function emitMeteredRequestSummary(
  input: EmitMeteredRequestSummaryInput,
): MeteredRequestSummary {
  const summary = buildMeteredRequestSummary(input);
  log.info(summary, 'metered_request');

  const now = Date.now();
  if (now - lastCacheStatsLoggedAt >= 60_000) {
    lastCacheStatsLoggedAt = now;
    log.info(
      {
        event: 'cache_stats_snapshot',
        abuse: getAbuseCacheStats(),
        platform: getPlatformCacheStats(),
        catalog: getCatalogCacheStats(),
        vector: getVectorCacheStats(),
        retriever: getRetrieverCacheStats(),
        browseBrands: getBrowseBrandsCacheStats(),
      },
      'cache_stats_snapshot',
    );
  }

  return summary;
}
