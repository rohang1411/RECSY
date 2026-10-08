/**
 * POST /api/internal/eval/import — Rehydrate historical benchmark report.
 *
 * Validates uploaded JSON report against BenchmarkReportSchema, persists to database,
 * and returns the rehydrated BenchmarkRunRecord.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getDb } from '@/services/db/client';
import { BenchmarkReportSchema } from '@/services/eval/export/report-schema';
import {
  createBenchmarkRun,
  persistBenchmarkResults,
  updateBenchmarkRunProgress,
  getBenchmarkRunById,
} from '@/services/eval/storage/benchmark-repository';
import type { BenchmarkResultItem, BenchmarkTier, TestCaseCategory } from '@/services/eval/types';
import { evalAccessError } from '@/services/eval/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const json: unknown = await request.json();
    const parsed = BenchmarkReportSchema.parse(json);

    const db = getDb();

    // Recreate run in DB
    const runId = await createBenchmarkRun(db, {
      suiteName: `[UNVERIFIED IMPORT] ${parsed.run.suiteName}`,
      tier: parsed.run.tier as BenchmarkTier,
      triggerSource: 'unverified-import',
      commitHash: parsed.systemInfo.commitHash,
      concurrencyVus: parsed.run.concurrencyVus,
      config: {
        ...(parsed.run.config ?? {}),
        evidenceStatus: 'unverified-import',
        importedAt: new Date().toISOString(),
      },
    });

    const results: BenchmarkResultItem[] = parsed.results.map((r, i) => ({
      id: r.id ?? `imported-${i}`,
      runId,
      testCaseId: r.testCaseId,
      category: r.category as TestCaseCategory,
      inputQuery: r.inputQuery,
      status: r.status,
      latencyMs: r.latencyMs,
      scores: r.scores as Record<string, number | null>,
      tracePayload: (r.tracePayload as BenchmarkResultItem['tracePayload']) ?? undefined,
      errorDetails: r.errorDetails,
      createdAt: new Date(),
    }));

    await persistBenchmarkResults(db, runId, results);

    await updateBenchmarkRunProgress(db, runId, {
      status: 'unverified',
      totalTests: parsed.run.totalTests,
      passedTests: parsed.run.passedTests,
      failedTests: parsed.run.failedTests,
      durationMs: parsed.run.durationMs,
      metricsSummary: parsed.run.metricsSummary as Record<string, unknown>,
    });

    const fullRun = await getBenchmarkRunById(db, runId);
    return NextResponse.json({ success: true, run: fullRun });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Import failed: ${errorMsg}` }, { status: 400 });
  }
}
