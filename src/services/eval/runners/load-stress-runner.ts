/**
 * Multi-Concurrency Data-Plane & Infrastructure Stress Runner.
 *
 * Implements high-throughput load benchmarking across 1→100 Virtual Users (VUs)
 * without incurring external SaaS LLM costs or hitting third-party rate limits.
 *
 * Stresses:
 *   - Supabase Postgres 17 connection pool
 *   - pgvector HNSW concurrent vector cosine distance (<=>)
 *   - In-memory RRF fusion and MMR matrix computation
 *   - Node.js event loop lag and heap memory allocation
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { ASPECT_NAMES } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
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
  readonly onProgress?: (completed: number, total: number, curQps: number) => void;
}

export async function runLoadStressBenchmark(
  options: LoadStressOptions,
): Promise<LoadStressResult> {
  const { db, targetComponent, concurrencyVus, totalRequests, onProgress } = options;

  const latenciesMs: number[] = [];
  const statusCodes: Record<number, number> = { 200: 0, 429: 0, 500: 0 };
  let successfulRequests = 0;
  let failedRequests = 0;

  // Setup performance hooks
  const eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
  eventLoopHistogram.enable();

  const startTime = performance.now();
  let completedCount = 0;

  // Pre-load components to ensure fair throughput benchmarking
  const catalog = await loadRecommendationCatalog(db);
  const retriever = createHybridRetriever();
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

  const firstPhoneId = catalog[0]?.phoneId;

  // Worker loop for each Virtual User
  const runWorker = async () => {
    while (true) {
      if (completedCount >= totalRequests) {
        break;
      }

      completedCount++;
      const queryIdx = completedCount % testQueries.length;
      const query = testQueries[queryIdx] ?? 'battery life';

      const t0 = performance.now();
      try {
        if (targetComponent === 'data-plane-recsys') {
          // Stress the full in-memory ranker across all active catalog devices
          rankCandidates(catalog, dummyReqs, defaultWeights);
        } else {
          // Stress database hybrid search (pgvector HNSW + FTS + RRF)
          if (firstPhoneId) {
            await retriever.search({
              phoneId: firstPhoneId,
              query,
              options: {
                kPerRetriever: 10,
                targetResults: 5,
                minDistinctSources: 1,
              },
            });
          }
        }

        const elapsed = performance.now() - t0;
        latenciesMs.push(elapsed);
        statusCodes[200] = (statusCodes[200] ?? 0) + 1;
        successfulRequests++;
      } catch {
        const elapsed = performance.now() - t0;
        latenciesMs.push(elapsed);
        statusCodes[500] = (statusCodes[500] ?? 0) + 1;
        failedRequests++;
      }

      if (completedCount % 5 === 0 || completedCount === totalRequests) {
        const curDuration = performance.now() - startTime;
        const curQps = computeThroughputQps(completedCount, curDuration);
        onProgress?.(completedCount, totalRequests, curQps);
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
  const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;

  // Approximate pool saturation (concurrency vs max connections of 20)
  const poolSaturationPercent = Math.min(100, Math.round((concurrencyVus / 20) * 100));

  return {
    totalRequests,
    successfulRequests,
    failedRequests,
    errorRate: Math.round(errorRate * 100) / 100,
    concurrencyVus,
    durationMs: Math.round(totalDurationMs),
    qps,
    latency: latencies,
    poolSaturationPercent,
    eventLoopLagMs: maxEventLoopLagMs,
    statusCodes,
  };
}
