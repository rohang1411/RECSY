/**
 * Master Evaluation & Benchmark Orchestrator.
 *
 * Coordinates execution across Recommender, RAG, and Concurrency Load suites,
 * saving results to the database and yielding live SSE/NDJSON progress events.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppDb } from '@/services/db/client';
import type { LlmProvider } from '@/services/llm/types';
import { DeterministicLlmProvider } from './stub/deterministic-llm';
import { runRecsysOfflineBenchmark } from './runners/recsys-runner';
import { runRagAlceBenchmark } from './runners/rag-runner';
import { runLoadStressBenchmark } from './runners/load-stress-runner';
import { runMultiTurnCrsBenchmark } from './runners/multi-turn-runner';
import {
  createBenchmarkRun,
  updateBenchmarkRunProgress,
  persistBenchmarkResults,
  getBenchmarkRunById,
} from './storage/benchmark-repository';
import type {
  BenchmarkRunRecord,
  BenchmarkTier,
  GoldenBenchmarkDataset,
  MultiTurnTrajectoryFixture,
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
} from './types';

export interface ExecuteBenchmarkOptions {
  readonly db: AppDb;
  readonly llm?: LlmProvider;
  readonly suite: 'recsys' | 'rag' | 'load-stress' | 'multi-turn' | 'all';
  readonly tier?: BenchmarkTier;
  readonly concurrencyVus?: number;
  readonly sampleScale?: 'quick' | 'full';
  readonly onProgress?: (payload: {
    readonly currentStep: number;
    readonly totalSteps: number;
    readonly activeTest: string;
    readonly status: 'running' | 'completed' | 'error';
    readonly interimQps?: number;
  }) => void;
}

export async function loadGoldenBenchmarkDataset(): Promise<GoldenBenchmarkDataset> {
  const filePath = resolve(process.cwd(), 'fixtures', 'eval', 'golden-benchmark-dataset.json');
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as GoldenBenchmarkDataset;
}

export async function loadMultiTurnTrajectories(): Promise<MultiTurnTrajectoryFixture[]> {
  const filePath = resolve(process.cwd(), 'fixtures', 'eval', 'multi-turn-trajectories.json');
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return (parsed.trajectories ?? []) as MultiTurnTrajectoryFixture[];
}

export async function executeBenchmarkSuite(
  options: ExecuteBenchmarkOptions,
): Promise<BenchmarkRunRecord> {
  const {
    db,
    llm = new DeterministicLlmProvider(),
    suite,
    tier = 'OFFLINE_RECSYS',
    concurrencyVus = 1,
    sampleScale = 'full',
    onProgress,
  } = options;

  const dataset = await loadGoldenBenchmarkDataset();
  const startTime = performance.now();

  const runId = await createBenchmarkRun(db, {
    suiteName: `Benchmark: ${suite.toUpperCase()} (${sampleScale.toUpperCase()})`,
    tier,
    concurrencyVus,
    config: { suite, tier, concurrencyVus, sampleScale },
  });

  const allResults: BenchmarkResultItem[] = [];
  let summaryMetrics: BenchmarkRunMetricsSummary = {};

  try {
    if (suite === 'recsys' || suite === 'all') {
      const personas =
        sampleScale === 'quick'
          ? dataset.recommenderPersonas.slice(0, 5)
          : dataset.recommenderPersonas;

      const recsysOutput = await runRecsysOfflineBenchmark({
        db,
        fixtures: personas,
        onProgress: (step, total, item) => {
          onProgress?.({
            currentStep: step,
            totalSteps: total,
            activeTest: `RecSys: ${item}`,
            status: 'running',
          });
        },
      });

      allResults.push(...recsysOutput.results);
      summaryMetrics = { ...summaryMetrics, ...recsysOutput.summary };
    }

    if (suite === 'rag' || suite === 'all') {
      const queries =
        sampleScale === 'quick'
          ? dataset.attributedQaQueries.slice(0, 5)
          : dataset.attributedQaQueries;

      const ragOutput = await runRagAlceBenchmark({
        db,
        llm,
        fixtures: queries,
        onProgress: (step, total, item) => {
          onProgress?.({
            currentStep: step,
            totalSteps: total,
            activeTest: `RAG: ${item}`,
            status: 'running',
          });
        },
      });

      allResults.push(...ragOutput.results);
      summaryMetrics = { ...summaryMetrics, ...ragOutput.summary };
    }

    if (suite === 'load-stress') {
      const totalReqs = sampleScale === 'quick' ? 25 : 100;
      const stressOutput = await runLoadStressBenchmark({
        db,
        targetComponent: 'data-plane-retrieval',
        concurrencyVus,
        totalRequests: totalReqs,
        onProgress: (done, total, curQps) => {
          onProgress?.({
            currentStep: done,
            totalSteps: total,
            activeTest: `Stress: ${done}/${total} (QPS: ${curQps})`,
            status: 'running',
            interimQps: curQps,
          });
        },
      });

      summaryMetrics = {
        ...summaryMetrics,
        latencyP50: stressOutput.latency.p50,
        latencyP90: stressOutput.latency.p90,
        latencyP95: stressOutput.latency.p95,
        latencyP99: stressOutput.latency.p99,
        peakQps: stressOutput.qps,
        totalTests: totalReqs,
        passedTests: stressOutput.successfulRequests,
        failedTests: stressOutput.failedRequests,
      };
    }

    if (suite === 'multi-turn' || suite === 'all') {
      const trajectories = await loadMultiTurnTrajectories();
      const selected = sampleScale === 'quick' ? trajectories.slice(0, 3) : trajectories;

      const crsOutput = await runMultiTurnCrsBenchmark({
        db,
        llm,
        fixtures: selected,
        onProgress: (step, total, item) => {
          onProgress?.({
            currentStep: step,
            totalSteps: total,
            activeTest: `Multi-Turn CRS: ${item}`,
            status: 'running',
          });
        },
      });

      allResults.push(...crsOutput.results);
      summaryMetrics = { ...summaryMetrics, ...crsOutput.summary };
    }

    const durationMs = Math.round(performance.now() - startTime);
    const passed = allResults.filter((r) => r.status === 'pass').length;
    const failed = allResults.filter((r) => r.status === 'fail').length;

    // Persist test results
    await persistBenchmarkResults(db, runId, allResults);

    // Finalize run
    await updateBenchmarkRunProgress(db, runId, {
      totalTests: allResults.length || summaryMetrics.totalTests || 0,
      passedTests: passed || summaryMetrics.passedTests || 0,
      failedTests: failed || summaryMetrics.failedTests || 0,
      durationMs,
      status: 'success',
      metricsSummary: summaryMetrics,
    });

    onProgress?.({
      currentStep: 100,
      totalSteps: 100,
      activeTest: 'Completed',
      status: 'completed',
    });

    const fullRecord = await getBenchmarkRunById(db, runId);
    if (!fullRecord) {
      throw new Error(`Failed to retrieve finalized run ${runId}`);
    }

    return fullRecord;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateBenchmarkRunProgress(db, runId, {
      status: 'failed',
      durationMs: Math.round(performance.now() - startTime),
    });

    onProgress?.({
      currentStep: 0,
      totalSteps: 0,
      activeTest: `Error: ${errorMsg}`,
      status: 'error',
    });

    throw err;
  }
}
