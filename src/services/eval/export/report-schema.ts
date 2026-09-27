/**
 * Zod schema contracts for portable Benchmark Reports (Export & In-UI Rehydration).
 */
import { z } from 'zod';

export const BenchmarkReportSchema = z.object({
  version: z.literal('2.0'),
  exportedAt: z.string(),
  systemInfo: z.object({
    nodeVersion: z.string(),
    commitHash: z.string().nullable().optional(),
    environment: z.string(),
  }),
  run: z.object({
    id: z.string(),
    suiteName: z.string(),
    tier: z.string(),
    concurrencyVus: z.number(),
    durationMs: z.number(),
    status: z.string(),
    totalTests: z.number(),
    passedTests: z.number(),
    failedTests: z.number(),
    metricsSummary: z.record(z.string(), z.any()),
    config: z.record(z.string(), z.any()).nullable().optional(),
    createdAt: z.string(),
  }),
  results: z.array(
    z.object({
      id: z.string().optional(),
      testCaseId: z.string(),
      category: z.string(),
      inputQuery: z.string(),
      status: z.enum(['pass', 'fail', 'warn']),
      latencyMs: z.number(),
      scores: z.record(z.string(), z.number().nullable()),
      tracePayload: z.record(z.string(), z.any()).optional(),
      errorDetails: z.string().nullable().optional(),
    }),
  ),
});

export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>;
