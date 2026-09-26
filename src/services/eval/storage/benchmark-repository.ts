/**
 * Benchmark Runs & Granular Results Database Repository.
 *
 * Provides CRUD persistence for historical benchmark runs and individual test traces.
 */
import { desc, eq } from 'drizzle-orm';
import type { AppDb } from '@/services/db/client';
import { benchmarkRuns, benchmarkResults } from '@/services/db/schema';
import type {
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
  BenchmarkRunRecord,
  BenchmarkStatus,
  BenchmarkTier,
  TestCaseCategory,
  TestCaseStatus,
} from '../types';

export interface CreateBenchmarkRunInput {
  readonly suiteName: string;
  readonly tier: BenchmarkTier;
  readonly triggerSource?: string;
  readonly commitHash?: string | null;
  readonly concurrencyVus?: number;
  readonly config?: Record<string, unknown>;
}

export async function createBenchmarkRun(
  db: AppDb,
  input: CreateBenchmarkRunInput,
): Promise<string> {
  const [row] = await db
    .insert(benchmarkRuns)
    .values({
      suiteName: input.suiteName,
      tier: input.tier,
      triggerSource: input.triggerSource ?? 'manual',
      commitHash: input.commitHash ?? null,
      status: 'running',
      concurrencyVus: input.concurrencyVus ?? 1,
      config: input.config ?? {},
    })
    .returning({ id: benchmarkRuns.id });

  if (!row) {
    throw new Error('Failed to create benchmark run record');
  }

  return row.id;
}

export async function updateBenchmarkRunProgress(
  db: AppDb,
  runId: string,
  update: {
    readonly totalTests?: number;
    readonly passedTests?: number;
    readonly failedTests?: number;
    readonly durationMs?: number;
    readonly status?: BenchmarkStatus;
    readonly metricsSummary?: BenchmarkRunMetricsSummary;
  },
): Promise<void> {
  await db
    .update(benchmarkRuns)
    .set({
      ...(update.totalTests != null ? { totalTests: update.totalTests } : {}),
      ...(update.passedTests != null ? { passedTests: update.passedTests } : {}),
      ...(update.failedTests != null ? { failedTests: update.failedTests } : {}),
      ...(update.durationMs != null ? { durationMs: update.durationMs } : {}),
      ...(update.status != null ? { status: update.status } : {}),
      ...(update.metricsSummary != null
        ? { metricsSummary: update.metricsSummary as Record<string, unknown> }
        : {}),
    })
    .where(eq(benchmarkRuns.id, runId));
}

export async function persistBenchmarkResults(
  db: AppDb,
  runId: string,
  results: readonly BenchmarkResultItem[],
): Promise<void> {
  if (results.length === 0) return;

  const rows = results.map((r) => ({
    runId,
    testCaseId: r.testCaseId,
    category: r.category,
    inputQuery: r.inputQuery,
    status: r.status,
    latencyMs: r.latencyMs,
    scores: r.scores,
    tracePayload: (r.tracePayload ?? null) as Record<string, unknown> | null,
    errorDetails: r.errorDetails ?? null,
  }));

  await db.insert(benchmarkResults).values(rows);
}

export async function listBenchmarkRuns(db: AppDb, limit = 25): Promise<BenchmarkRunRecord[]> {
  const rows = await db
    .select()
    .from(benchmarkRuns)
    .orderBy(desc(benchmarkRuns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    suiteName: r.suiteName,
    tier: r.tier as BenchmarkTier,
    triggerSource: r.triggerSource,
    commitHash: r.commitHash,
    status: r.status as BenchmarkStatus,
    totalTests: r.totalTests,
    passedTests: r.passedTests,
    failedTests: r.failedTests,
    durationMs: r.durationMs,
    concurrencyVus: r.concurrencyVus,
    metricsSummary: r.metricsSummary as BenchmarkRunMetricsSummary | null,
    config: r.config as Record<string, unknown> | null,
    createdAt: r.createdAt,
  }));
}

export async function getBenchmarkRunById(
  db: AppDb,
  runId: string,
): Promise<BenchmarkRunRecord | null> {
  const [row] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, runId)).limit(1);

  if (!row) return null;

  const testResults = await db
    .select()
    .from(benchmarkResults)
    .where(eq(benchmarkResults.runId, runId))
    .orderBy(benchmarkResults.createdAt);

  return {
    id: row.id,
    suiteName: row.suiteName,
    tier: row.tier as BenchmarkTier,
    triggerSource: row.triggerSource,
    commitHash: row.commitHash,
    status: row.status as BenchmarkStatus,
    totalTests: row.totalTests,
    passedTests: row.passedTests,
    failedTests: row.failedTests,
    durationMs: row.durationMs,
    concurrencyVus: row.concurrencyVus,
    metricsSummary: row.metricsSummary as BenchmarkRunMetricsSummary | null,
    config: row.config as Record<string, unknown> | null,
    createdAt: row.createdAt,
    results: testResults.map((tr) => ({
      id: tr.id,
      runId: tr.runId,
      testCaseId: tr.testCaseId,
      category: tr.category as TestCaseCategory,
      inputQuery: tr.inputQuery,
      status: tr.status as TestCaseStatus,
      latencyMs: tr.latencyMs,
      scores: (tr.scores ?? {}) as Record<string, number | null>,
      tracePayload: (tr.tracePayload as BenchmarkResultItem['tracePayload']) ?? undefined,
      errorDetails: tr.errorDetails,
      createdAt: tr.createdAt,
    })),
  };
}

export async function deleteBenchmarkRun(db: AppDb, runId: string): Promise<void> {
  await db.delete(benchmarkRuns).where(eq(benchmarkRuns.id, runId));
}
