#!/usr/bin/env tsx
/**
 * Benchmark script measuring per-stage retrieval latency and p50, p90, p95, p99 metrics.
 *
 * Verifies Resume Claim:
 * "Instrumenting per-stage retrieval tracing to prevent conversational context drift
 *  and maintain sub-50ms p95 retrieval latency"
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/benchmark-retrieval-latency.ts
 */
import { eq } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { chunks, phones } from '@/services/db/schema';
import { createHybridRetriever } from '@/services/retrieval/factory';
import type { RetrievalResult } from '@/services/retrieval/types';

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

async function main(): Promise<void> {
  const db = getDb();

  // Pick an active phone with chunks
  const [sample] = await db.select({ phoneId: chunks.phoneId }).from(chunks).limit(1);

  if (!sample) {
    console.error('[benchmark-retrieval-latency] No chunks in database.');
    process.exit(1);
  }

  const [phone] = await db
    .select({ id: phones.id, slug: phones.slug })
    .from(phones)
    .where(eq(phones.id, sample.phoneId))
    .limit(1);

  if (!phone) {
    console.error('[benchmark-retrieval-latency] Phone not found.');
    process.exit(1);
  }

  console.log(`[benchmark-retrieval-latency] Benchmarking retrieval on phone: ${phone.slug}`);

  const retriever = createHybridRetriever();

  const benchmarkQueries = [
    'battery life and endurance',
    'display brightness outdoors in sunlight',
    'primary camera low light performance',
    'ultrawide lens distortion and detail',
    'gaming thermal throttling and fps stability',
    'software update support and clean ui',
    'charging speed and heat dissipation',
    'build quality and drop durability',
    'speaker clarity and haptic feedback',
    'value for money vs competitors',
  ];

  // Warm-up run (3 queries)
  console.log('[benchmark-retrieval-latency] Running warm-up queries...');
  for (let i = 0; i < 3; i++) {
    await retriever.search({
      phoneId: phone.id,
      query: benchmarkQueries[i % benchmarkQueries.length]!,
      options: { kPerRetriever: 30, targetResults: 8 },
    });
  }

  console.log('[benchmark-retrieval-latency] Running 50 benchmark queries...');
  const vectorLatencies: number[] = [];
  const ftsLatencies: number[] = [];
  const rrfLatencies: number[] = [];
  const mmrLatencies: number[] = [];
  const dbRetrievalLatencies: number[] = []; // (vector + fts parallel + rrf + mmr)
  const warmTotalLatencies: number[] = [];

  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    const q = benchmarkQueries[i % benchmarkQueries.length]!;
    const res: RetrievalResult = await retriever.search({
      phoneId: phone.id,
      query: q,
      options: { kPerRetriever: 30, targetResults: 8 },
    });

    const vMs = res.debug.vector.ms;
    const fMs = res.debug.fts.ms;
    const rrfMs = res.debug.rrf.ms;
    const mmrMs = res.debug.mmr.ms;

    // Parallel DB search execution time = max(vector, fts) + rrf + mmr
    const pureRetrievalMs = Math.max(vMs, fMs) + rrfMs + mmrMs;

    vectorLatencies.push(vMs);
    ftsLatencies.push(fMs);
    rrfLatencies.push(rrfMs);
    mmrLatencies.push(mmrMs);
    dbRetrievalLatencies.push(pureRetrievalMs);
    warmTotalLatencies.push(res.debug.totalMs);
  }

  const p50Vector = computePercentile(vectorLatencies, 50);
  const p95Vector = computePercentile(vectorLatencies, 95);
  const p50Fts = computePercentile(ftsLatencies, 50);
  const p95Fts = computePercentile(ftsLatencies, 95);
  const p50Rrf = computePercentile(rrfLatencies, 50);
  const p95Rrf = computePercentile(rrfLatencies, 95);
  const p50Mmr = computePercentile(mmrLatencies, 50);
  const p95Mmr = computePercentile(mmrLatencies, 95);

  const p50Retrieval = computePercentile(dbRetrievalLatencies, 50);
  const p90Retrieval = computePercentile(dbRetrievalLatencies, 90);
  const p95Retrieval = computePercentile(dbRetrievalLatencies, 95);
  const p99Retrieval = computePercentile(dbRetrievalLatencies, 99);

  const p50Warm = computePercentile(warmTotalLatencies, 50);
  const p95Warm = computePercentile(warmTotalLatencies, 95);

  console.log('\n======================================================');
  console.log('RECSY HYBRID RAG RETRIEVAL LATENCY BENCHMARK RESULTS');
  console.log('======================================================');
  console.log(`Evaluated Sample Size: ${iterations} queries`);
  console.log(`Candidate Fusion: 30 Vector + 30 FTS = 60 candidates -> 8 chunks via RRF`);
  console.log('------------------------------------------------------');
  console.log('Per-Stage Latency Breakdown:');
  console.log(
    `  - Vector Search (pgvector HNSW) : p50 = ${p50Vector.toFixed(2)}ms | p95 = ${p95Vector.toFixed(2)}ms`,
  );
  console.log(
    `  - Keyword Search (Postgres FTS) : p50 = ${p50Fts.toFixed(2)}ms | p95 = ${p95Fts.toFixed(2)}ms`,
  );
  console.log(
    `  - Reciprocal Rank Fusion (RRF) : p50 = ${p50Rrf.toFixed(2)}ms | p95 = ${p95Rrf.toFixed(2)}ms`,
  );
  console.log(
    `  - MMR Diversity Rerank        : p50 = ${p50Mmr.toFixed(2)}ms | p95 = ${p95Mmr.toFixed(2)}ms`,
  );
  console.log('------------------------------------------------------');
  console.log('Pure Database Retrieval Pipeline Latency:');
  console.log(`  - p50: ${p50Retrieval.toFixed(2)}ms`);
  console.log(`  - p90: ${p90Retrieval.toFixed(2)}ms`);
  console.log(
    `  - p95: ${p95Retrieval.toFixed(2)}ms  <--- ${p95Retrieval < 50 ? 'SUB-50MS CONFIRMED' : 'OVER 50MS'}`,
  );
  console.log(`  - p99: ${p99Retrieval.toFixed(2)}ms`);
  console.log('------------------------------------------------------');
  console.log(`End-to-End Warm Latency (with WeakMap query embedding cache):`);
  console.log(`  - p50: ${p50Warm.toFixed(2)}ms`);
  console.log(`  - p95: ${p95Warm.toFixed(2)}ms`);
  console.log('======================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('[benchmark-retrieval-latency] Error:', err);
  process.exit(1);
});
