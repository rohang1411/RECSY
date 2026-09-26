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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const runRequestSchema = z.object({
  suite: z.enum(['recsys', 'rag', 'load-stress', 'multi-turn', 'all']).default('recsys'),
  concurrencyVus: z.number().int().min(1).max(100).default(1),
  sampleScale: z.enum(['quick', 'full']).default('full'),
  tier: z
    .enum([
      'L1_DATA_PLANE',
      'L2_WARM_API',
      'L3_MACRO_LLM',
      'OFFLINE_RECSYS',
      'RAG_ALCE',
      'ABLATION',
      'MULTI_TURN_CRS',
    ])
    .default('OFFLINE_RECSYS'),
});

export async function POST(request: NextRequest): Promise<Response> {
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

        send({ type: 'start', suite: body.suite, vus: body.concurrencyVus });

        try {
          const runRecord = await executeBenchmarkSuite({
            db,
            suite: body.suite,
            tier: body.tier,
            concurrencyVus: body.concurrencyVus,
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
          const errorMsg = err instanceof Error ? err.message : String(err);
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
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: errorMsg }, { status: 400 });
  }
}
