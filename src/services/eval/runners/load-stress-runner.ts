/**
 * Bounded component load probe. It runs concurrent DB retrieval with a selected
 * embedder or in-memory ranking. It is not an HTTP, pool, or service-capacity test.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { inArray } from 'drizzle-orm';
import { ASPECT_NAMES } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
import { chunks } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { DeterministicLlmProvider } from '../stub/deterministic-llm';
import { loadRecommendationCatalog } from '@/services/recommender/catalog';
import { rankCandidates } from '@/services/recommender/match';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { computeLatencyPercentiles, computeThroughputQps } from '../metrics/latency-profiler';
import type { LoadStressResult } from '../types';

export interface LoadStressOptions {
  readonly db: AppDb;
  readonly targetComponent: 'data-plane-retrieval' | 'data-plane-recsys';
  readonly concurrencyVus: number; // 1, 5, 10, 25, 50, 100
  readonly totalRequests: number;
  readonly llm?: LlmProvider;
  readonly phoneId?: string;
  readonly onProgress?: (completed: number, total: number, curQps: number) => void;
}

export async function runLoadStressBenchmark(
  options: LoadStressOptions,
): Promise<LoadStressResult> {
  const { db, targetComponent, concurrencyVus, totalRequests, onProgress } = options;
  if (!Number.isInteger(concurrencyVus) || concurrencyVus < 1 || concurrencyVus > 100)
    throw new Error('load configuration: concurrencyVus must be 1..100');
  if (!Number.isInteger(totalRequests) || totalRequests < 1 || totalRequests > 10000)
    throw new Error('load configuration: totalRequests must be 1..10000');

  const latenciesMs: number[] = [];
  const errorCounts: Record<string, number> = {};
  const errorSamples: string[] = [];
  const stageLatencies: Record<string, number[]> = {
    embedding: [],
    vector: [],
    fts: [],
    rrf: [],
    mmr: [],
  };
  let successfulRequests = 0;
  let failedRequests = 0;

  // Setup is deliberately excluded from measured request time.
  const catalog = await loadRecommendationCatalog(db);
  if (catalog.length === 0) throw new Error('load preflight: active catalog is empty');
  const retriever =
    targetComponent === 'data-plane-retrieval'
      ? createHybridRetriever({ llm: options.llm ?? new DeterministicLlmProvider() })
      : null;
  const defaultWeights = new Map(ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]));

  const dummyReqs = {
    confidence: 1.0,
    clarifying_question: undefined,
    budget_usd: { max: 800 },
    priorities: [
      { aspect: 'camera' as const, weight: 0.4 },
      { aspect: 'battery' as const, weight: 0.3 },
      { aspect: 'performance' as const, weight: 0.3 },
    ],
    use_cases: ['daily driver'],
    must_haves: [],
    deal_breakers: [],
    brand_preference: { liked: [], disliked: [] },
  };

  // Test queries for realistic variation
  const testQueries = [
    'battery life screen on time',
    'camera zoom portrait quality',
    'gaming thermals 120hz display',
    'fast charging speed heat',
    'build quality titanium drop resistance',
  ];

  const chunkRows =
    targetComponent === 'data-plane-retrieval'
      ? await db
          .select({ phoneId: chunks.phoneId })
          .from(chunks)
          .where(
            inArray(
              chunks.phoneId,
              catalog.map((p) => p.phoneId),
            ),
          )
      : [];
  const chunkCounts = new Map<string, number>();
  for (const row of chunkRows)
    chunkCounts.set(row.phoneId, (chunkCounts.get(row.phoneId) ?? 0) + 1);
  const chosenPhoneId = options.phoneId ?? [...chunkCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const targetChunkCount = chosenPhoneId ? (chunkCounts.get(chosenPhoneId) ?? 0) : 0;
  if (targetComponent === 'data-plane-retrieval' && targetChunkCount === 0)
    throw new Error(
      'load preflight: no chunks for selected active phone; refusing no-op retrieval benchmark',
    );
  const eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
  eventLoopHistogram.enable();
  const startTime = performance.now();
  let issuedCount = 0;
  let finishedCount = 0;

  // Worker loop for each Virtual User
  const runWorker = async () => {
    while (true) {
      if (issuedCount >= totalRequests) {
        break;
      }

      issuedCount++;
      const queryIdx = issuedCount % testQueries.length;
      const query = testQueries[queryIdx] ?? 'battery life';

      const t0 = performance.now();
      try {
        if (targetComponent === 'data-plane-recsys') {
          // Stress the full in-memory ranker across all active catalog devices
          const ranked = rankCandidates(catalog, dummyReqs, defaultWeights);
          if (ranked.picks.length === 0) throw new Error('ranker returned zero picks');
        } else {
          // Stress database hybrid search (pgvector HNSW + FTS + RRF)
          if (chosenPhoneId && retriever) {
            const result = await retriever.search({
              phoneId: chosenPhoneId,
              query,
              options: {
                kPerRetriever: 10,
                targetResults: 5,
                minDistinctSources: 1,
              },
            });
            if (result.chunks.length === 0) throw new Error('retriever returned zero chunks');
            if (result.debug.vector.error || result.debug.fts.error)
              throw new Error(
                `retrieval stage failed: vector=${result.debug.vector.error ?? 'ok'}; fts=${result.debug.fts.error ?? 'ok'}`,
              );
            stageLatencies.embedding?.push(result.debug.embedding?.ms ?? 0);
            stageLatencies.vector?.push(result.debug.vector.ms);
            stageLatencies.fts?.push(result.debug.fts.ms);
            stageLatencies.rrf?.push(result.debug.rrf.ms);
            stageLatencies.mmr?.push(result.debug.mmr.ms);
          }
        }

        const elapsed = performance.now() - t0;
        latenciesMs.push(elapsed);
        successfulRequests++;
      } catch (error) {
        const elapsed = performance.now() - t0;
        latenciesMs.push(elapsed);
        failedRequests++;
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        errorCounts[message] = (errorCounts[message] ?? 0) + 1;
        if (errorSamples.length < 10) errorSamples.push(message);
      }
      finishedCount++;
      if (finishedCount % 5 === 0 || finishedCount === totalRequests) {
        const curDuration = performance.now() - startTime;
        const curQps = computeThroughputQps(successfulRequests, curDuration);
        onProgress?.(finishedCount, totalRequests, curQps);
      }
    }
  };

  // Launch concurrent virtual user workers
  const workers = Array.from({ length: concurrencyVus }, () => runWorker());
  await Promise.all(workers);

  const totalDurationMs = performance.now() - startTime;
  eventLoopHistogram.disable();

  const maxEventLoopLagMs = Math.round(eventLoopHistogram.max / 1e6); // nanoseconds -> ms
  const latencies = computeLatencyPercentiles(latenciesMs);
  const qps = computeThroughputQps(totalRequests, totalDurationMs);
  const goodputQps = computeThroughputQps(successfulRequests, totalDurationMs);
  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
  const stageP95Ms = Object.fromEntries(
    Object.entries(stageLatencies)
      .filter(([, values]) => values.length > 0)
      .map(([name, values]) => [name, computeLatencyPercentiles(values).p95]),
  );

  return {
    targetComponent,
    catalogCount: catalog.length,
    targetChunkCount,
    totalRequests,
    successfulRequests,
    failedRequests,
    errorRate: Math.round(errorRate * 100) / 100,
    concurrencyVus,
    durationMs: Math.round(totalDurationMs),
    qps,
    goodputQps,
    stageP95Ms,
    latency: latencies,
    eventLoopLagMs: maxEventLoopLagMs,
    errorCounts,
    errorSamples,
  };
}
