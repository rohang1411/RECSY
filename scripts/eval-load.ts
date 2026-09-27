#!/usr/bin/env tsx
/**
 * CLI Concurrency & Data-Plane Load Stress Profiler: `pnpm eval:load`.
 *
 * Stresses Postgres 17 connection pool, pgvector HNSW search, and Node.js
 * event loop across configurable Virtual Users (VUs) without external API costs.
 */
import { getDb } from '@/services/db/client';
import { runLoadStressBenchmark } from '@/services/eval/runners/load-stress-runner';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const vuArg = args.find((a) => a.startsWith('--vus='));
  const totalArg = args.find((a) => a.startsWith('--total='));

  const concurrencyVus = vuArg ? Number.parseInt(vuArg.split('=')[1] ?? '10', 10) : 10;
  const totalRequests = totalArg ? Number.parseInt(totalArg.split('=')[1] ?? '50', 10) : 50;

  console.log('\n======================================================');
  console.log(`RECSY v2 — Data-Plane Concurrency Stress Profiler`);
  console.log(`Target: Hybrid Retrieval & In-Memory Ranker`);
  console.log(`Concurrency: ${concurrencyVus} Virtual Users | Total Requests: ${totalRequests}`);
  console.log('======================================================\n');

  const db = getDb();

  const result = await runLoadStressBenchmark({
    db,
    targetComponent: 'data-plane-retrieval',
    concurrencyVus,
    totalRequests,
    onProgress: (done, total, curQps) => {
      process.stdout.write(
        `\r[eval:load] Progress: ${done}/${total} requests | Current Throughput: ${curQps} QPS`,
      );
    },
  });

  console.log('\n\n------------------------------------------------------');
  console.log('LATENCY PERCENTILE LADDER:');
  console.log('------------------------------------------------------');
  console.log(`Median (p50):        ${result.latency.p50} ms`);
  console.log(`90th Percentile:     ${result.latency.p90} ms`);
  console.log(`95th Percentile:     ${result.latency.p95} ms (SLO Boundary)`);
  console.log(`99th Percentile:     ${result.latency.p99} ms (Tail Contention)`);
  console.log(`Min / Max Latency:   ${result.latency.min} ms / ${result.latency.max} ms`);
  console.log(`Jitter:              ${result.latency.jitter} ms`);
  console.log('------------------------------------------------------');
  console.log('THROUGHPUT & CAPACITY:');
  console.log('------------------------------------------------------');
  console.log(`Peak Throughput:     ${result.qps} QPS`);
  console.log(
    `Success Rate:        ${result.successfulRequests}/${result.totalRequests} (${(100 - result.errorRate).toFixed(1)}%)`,
  );
  console.log(`Pool Saturation:     ${result.poolSaturationPercent}% (Max Connections: 20)`);
  console.log(`Max Event Loop Lag:  ${result.eventLoopLagMs} ms (Target: < 15ms)`);
  console.log(`Duration:            ${(result.durationMs / 1000).toFixed(2)}s\n`);

  process.exit(result.failedRequests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n[eval:load] Stress test failed with error:', err);
  process.exit(1);
});
