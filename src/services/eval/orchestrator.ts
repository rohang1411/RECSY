/**
 * Master Evaluation & Benchmark Orchestrator.
 *
 * Coordinates execution across Recommender, RAG, and Concurrency Load suites,
 * saving results to the database and yielding live SSE/NDJSON progress events.
 */
import { execFileSync } from 'node:child_process';
import type { AppDb } from '@/services/db/client';
import type { LlmProvider } from '@/services/llm/types';
import { GeminiProvider } from '@/services/llm/gemini';
import { CachedLlmProvider } from '@/services/llm/cache';
import { env } from '@/env';
import { DeterministicLlmProvider } from './stub/deterministic-llm';
import { diagnoseEvaluationError } from './errors';
import {
  checkEvaluationReadiness,
  loadEvaluationFixtures,
  type EvaluationSuite,
  type ProviderTrack,
} from './preflight';
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
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
} from './types';

export interface ExecuteBenchmarkOptions {
  readonly db: AppDb;
  readonly llm?: LlmProvider;
  readonly suite: EvaluationSuite;
  readonly providerTrack: ProviderTrack;
  readonly tier?: BenchmarkTier;
  readonly concurrencyVus?: number;
  readonly totalRequests?: number;
  readonly sampleScale?: 'quick' | 'full';
  readonly onProgress?: (payload: {
    readonly currentStep: number;
    readonly totalSteps: number;
    readonly activeTest: string;
    readonly status: 'running' | 'completed' | 'error';
    readonly interimQps?: number;
  }) => void;
}

function currentCodeState(): { commitHash: string | null; workingTreeDirty: boolean | null } {
  try {
    const commitHash =
      env.NEXT_PUBLIC_COMMIT_SHA !== 'dev'
        ? env.NEXT_PUBLIC_COMMIT_SHA
        : execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 1500,
          }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1500,
    }).trim();
    return { commitHash, workingTreeDirty: status.length > 0 };
  } catch {
    return {
      commitHash: env.NEXT_PUBLIC_COMMIT_SHA !== 'dev' ? env.NEXT_PUBLIC_COMMIT_SHA : null,
      workingTreeDirty: null,
    };
  }
}

export async function executeBenchmarkSuite(
  options: ExecuteBenchmarkOptions,
): Promise<BenchmarkRunRecord> {
  const {
    db,
    llm,
    suite,
    providerTrack,
    concurrencyVus = 1,
    totalRequests,
    sampleScale = 'full',
    onProgress,
  } = options;
  if (!Number.isInteger(concurrencyVus) || concurrencyVus < 1 || concurrencyVus > 100)
    throw new Error('configuration: concurrencyVus must be an integer from 1 to 100');
  if (
    totalRequests != null &&
    (!Number.isInteger(totalRequests) || totalRequests < 1 || totalRequests > 10000)
  )
    throw new Error('configuration: totalRequests must be an integer from 1 to 10000');
  if ((suite === 'recsys' || suite === 'load-stress') && providerTrack === 'live')
    throw new Error(
      `configuration: ${suite} has no live model stage; select the stub/component track`,
    );
  const fixtures = await loadEvaluationFixtures();
  const preflight = await checkEvaluationReadiness(db, suite, sampleScale, fixtures);
  if (providerTrack === 'live' && env.LLM_PROVIDER !== 'gemini')
    throw new Error(
      'provider: live evaluation requires Gemini; controlled providers are not live evidence',
    );
  const evaluationGemini =
    providerTrack === 'live' && !llm
      ? new GeminiProvider({
          budget: { maxGenerationRequests: 20, maxEmbeddingRequests: 40, stopOnQuota: true },
          maxKeys: 2,
          maxRetries: 0,
        })
      : null;
  const selectedLlm =
    llm ??
    (evaluationGemini
      ? new CachedLlmProvider(evaluationGemini, env.LLM_CACHE_ENABLED)
      : new DeterministicLlmProvider());
  if (providerTrack === 'live' && selectedLlm.name === 'deterministic-mock-llm')
    throw new Error('provider: live track cannot use the deterministic mock');
  if (providerTrack === 'stub' && selectedLlm.name !== 'deterministic-mock-llm')
    throw new Error('provider: stub track cannot use a live provider');
  const dataset = fixtures.golden;
  const effectiveTier: BenchmarkTier =
    suite === 'rag'
      ? 'RAG_ALCE'
      : suite === 'multi-turn'
        ? 'MULTI_TURN_CRS'
        : suite === 'load-stress'
          ? 'L1_DATA_PLANE'
          : suite === 'recsys'
            ? 'OFFLINE_RECSYS'
            : 'L3_MACRO_LLM';
  const codeState = currentCodeState();
  const startTime = performance.now();

  const runId = await createBenchmarkRun(db, {
    suiteName: `Benchmark: ${suite.toUpperCase()} (${sampleScale.toUpperCase()})`,
    tier: effectiveTier,
    concurrencyVus,
    commitHash: codeState.commitHash,
    config: {
      suite,
      tier: effectiveTier,
      concurrencyVus,
      totalRequests:
        suite === 'load-stress' ? (totalRequests ?? (sampleScale === 'quick' ? 25 : 100)) : null,
      sampleScale,
      regionCode: 'US',
      providerTrack,
      provider: suite === 'recsys' ? 'none' : selectedLlm.name,
      chatModel:
        suite === 'recsys' || suite === 'load-stress'
          ? null
          : providerTrack === 'live'
            ? env.LLM_CHAT_MODEL
            : 'deterministic-mock',
      embeddingModel:
        suite === 'recsys'
          ? null
          : suite === 'load-stress'
            ? 'deterministic-mock'
            : providerTrack === 'live'
              ? env.LLM_EMBEDDING_MODEL
              : 'deterministic-mock',
      cacheEnabled: providerTrack === 'live' ? env.LLM_CACHE_ENABLED : false,
      evaluationTransportLimits: evaluationGemini
        ? {
            generationRequests: 20,
            embeddingRequests: 40,
            maxKeys: 2,
            sdkRetries: 0,
            stopOnQuota: true,
          }
        : null,
      nodeEnv: env.NODE_ENV,
      nodeVersion: process.version,
      workingTreeDirty: codeState.workingTreeDirty,
      measurementBoundary:
        suite === 'load-stress'
          ? 'DB retrieval with selected embedder; no HTTP or answer generation'
          : suite === 'recsys'
            ? 'in-memory ranker with production DB catalog'
            : 'pipeline with selected provider',
      labels: {
        ndcg3: 'ranker-derived MAUT agreement',
        citePrec: 'lexical citation support proxy',
      },
      preflight,
    },
  });

  const allResults: BenchmarkResultItem[] = [];
  let summaryMetrics: BenchmarkRunMetricsSummary = {};
  let resultsPersisted = false;

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
        llm: selectedLlm,
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
      const totalReqs = totalRequests ?? (sampleScale === 'quick' ? 25 : 100);
      const stressOutput = await runLoadStressBenchmark({
        db,
        targetComponent: 'data-plane-retrieval',
        llm: new DeterministicLlmProvider(),
        phoneId: preflight.loadTargetPhoneId ?? undefined,
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

      allResults.push({
        id: `stress-${runId}`,
        runId: '',
        testCaseId: 'retrieval-component-load',
        category: 'stress',
        inputQuery: `${totalReqs} completed attempts at ${concurrencyVus} workers; ${stressOutput.catalogCount} active phones; ${stressOutput.targetChunkCount} target chunks`,
        status: stressOutput.failedRequests === 0 ? 'pass' : 'fail',
        latencyMs: stressOutput.durationMs,
        scores: {
          successfulRequests: stressOutput.successfulRequests,
          failedRequests: stressOutput.failedRequests,
          goodputQps: stressOutput.goodputQps,
          latencyP95: stressOutput.latency.p95,
        },
        tracePayload: {
          loadStress: {
            targetComponent: stressOutput.targetComponent,
            catalogCount: stressOutput.catalogCount,
            targetChunkCount: stressOutput.targetChunkCount,
            errorCounts: stressOutput.errorCounts,
            stageP95Ms: stressOutput.stageP95Ms,
            eventLoopLagMs: stressOutput.eventLoopLagMs,
            errorRate: stressOutput.errorRate,
          },
        },
        errorDetails: stressOutput.errorSamples.length
          ? stressOutput.errorSamples.join(' | ')
          : null,
        createdAt: new Date(),
      });

      summaryMetrics = {
        ...summaryMetrics,
        latencyP50: stressOutput.latency.p50,
        latencyP90: stressOutput.latency.p90,
        latencyP95: stressOutput.latency.p95,
        latencyP99: stressOutput.latency.p99,
        goodputQps: stressOutput.goodputQps,
        stageP95Ms: stressOutput.stageP95Ms,
        totalTests: totalReqs,
        passedTests: stressOutput.successfulRequests,
        failedTests: stressOutput.failedRequests,
      };
    }

    if (suite === 'multi-turn' || suite === 'all') {
      const trajectories = fixtures.trajectories;
      const selected = sampleScale === 'quick' ? trajectories.slice(0, 3) : trajectories;

      const crsOutput = await runMultiTurnCrsBenchmark({
        db,
        llm: selectedLlm,
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

    if (evaluationGemini)
      summaryMetrics = {
        ...summaryMetrics,
        providerTransportBudget: evaluationGemini.evaluationBudget!.snapshot(),
      };
    const durationMs = Math.round(performance.now() - startTime);
    const passed = allResults.filter((r) => r.status === 'pass').length;
    const failed = allResults.filter((r) => r.status !== 'pass').length;

    // Persist test results
    await persistBenchmarkResults(db, runId, allResults);
    resultsPersisted = true;

    // Finalize run
    await updateBenchmarkRunProgress(db, runId, {
      totalTests: suite === 'load-stress' ? (summaryMetrics.totalTests ?? 0) : allResults.length,
      passedTests: suite === 'load-stress' ? (summaryMetrics.passedTests ?? 0) : passed,
      failedTests: suite === 'load-stress' ? (summaryMetrics.failedTests ?? 0) : failed,
      durationMs,
      status:
        failed > 0 || (allResults.length === 0 && (summaryMetrics.failedTests ?? 0) > 0)
          ? 'failed'
          : 'success',
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
    if (evaluationGemini)
      summaryMetrics = {
        ...summaryMetrics,
        providerTransportBudget: evaluationGemini.evaluationBudget!.snapshot(),
      };
    const errorMsg = diagnoseEvaluationError(err);
    if (!resultsPersisted && allResults.length > 0) {
      try {
        await persistBenchmarkResults(db, runId, allResults);
      } catch {
        /* Preserve the original failure as the primary diagnostic. */
      }
    }
    try {
      await updateBenchmarkRunProgress(db, runId, {
        status: 'failed',
        totalTests: allResults.length,
        passedTests: allResults.filter((result) => result.status === 'pass').length,
        failedTests: allResults.filter((result) => result.status !== 'pass').length,
        durationMs: Math.round(performance.now() - startTime),
        metricsSummary: { ...summaryMetrics, executionError: errorMsg },
      });
    } catch {
      /* The streamed error still reports the original cause if persistence is unavailable. */
    }

    onProgress?.({
      currentStep: 0,
      totalSteps: 0,
      activeTest: `Error: ${errorMsg}`,
      status: 'error',
    });

    throw err;
  }
}
