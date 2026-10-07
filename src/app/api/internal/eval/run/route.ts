/**
 * POST /api/internal/eval/run — Automated Benchmark Suite Execution.
 *
 * Streams real-time progress events as NDJSON while executing selected benchmark suites.
 * Finalizes and returns the complete BenchmarkRunRecord.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/services/db/client';
import { executeBenchmarkSuite } from '@/services/eval/orchestrator';
import { evalAccessError } from '@/services/eval/access';
import { diagnoseEvaluationError } from '@/services/eval/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const runRequestSchema = z.object({
  suite: z.enum(['recsys', 'rag', 'load-stress', 'multi-turn', 'all']).default('recsys'),
  providerTrack: z.enum(['stub', 'live']),
  concurrencyVus: z.number().int().min(1).max(100).default(1),
  totalRequests: z.number().int().min(1).max(10000).optional(),
  sampleScale: z.enum(['quick', 'full']).default('full'),
});

export async function POST(request: NextRequest): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const json: unknown = await request.json().catch(() => ({}));
    const body = runRequestSchema.parse(json);

    const db = getDb();
    const enc = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        };

        send({
          type: 'start',
          suite: body.suite,
          track: body.providerTrack,
          vus: body.concurrencyVus,
        });

        try {
          const runRecord = await executeBenchmarkSuite({
            db,
            suite: body.suite,
            providerTrack: body.providerTrack,
            concurrencyVus: body.concurrencyVus,
            totalRequests: body.totalRequests,
            sampleScale: body.sampleScale,
            onProgress: (p) => {
              send({
                type: 'progress',
                step: p.currentStep,
                total: p.totalSteps,
                activeTest: p.activeTest,
                interimQps: p.interimQps,
              });
            },
          });

          send({ type: 'done', run: runRecord });
        } catch (err: unknown) {
          const errorMsg = diagnoseEvaluationError(err);
          send({ type: 'error', message: errorMsg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    const errorMsg = diagnoseEvaluationError(err);
    return Response.json({ error: errorMsg }, { status: 400 });
  }
}
