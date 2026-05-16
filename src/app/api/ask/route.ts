/**
 * POST /api/ask — phone-scoped grounded Q&A with NDJSON streaming.
 *
 * Accepts `{ phoneSlug, query, sessionId? }`. Runs hybrid retrieval
 * (vector + FTS + RRF + MMR) scoped to the requested phone, validates
 * retrieved citations, then streams Gemini's grounded answer back as
 * NDJSON. A terminal `done` chunk includes the optional `retrievalTrace`
 * for the in-UI collapsible trace panel (controlled by `traceId`).
 *
 * Rate-limited by IP hash (server-side rate_limits table). Logs every
 * request with a `traceId` so ops can correlate NDJSON stream events.
 *
 * Used by: `src/app/p/[slug]/page.tsx` (phone detail chat panel).
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { ZodError, z } from 'zod';

import { env } from '@/env';
import { MAX_CHAT_MESSAGE_BYTES } from '@/lib/constants';
import { toAppError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { buildAskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import { chunkTextForStream, persistChatQuery, runPhoneQna } from '@/services/chat/answer';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { requestLogger } from '@/services/logger';
import { consumeAskRateLimit } from '@/services/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const askBodySchema = z.object({
  phoneSlug: z.string().trim().min(1).max(200),
  query: z
    .string()
    .trim()
    .min(1)
    .refine((q) => new TextEncoder().encode(q).length <= MAX_CHAT_MESSAGE_BYTES, 'query too long'),
});

let hybridSingleton: ReturnType<typeof createHybridRetriever> | null = null;
function getHybrid(): ReturnType<typeof createHybridRetriever> {
  hybridSingleton ??= createHybridRetriever();
  return hybridSingleton;
}

export async function POST(request: NextRequest): Promise<Response> {
  const traceId = randomUUID();
  const log = requestLogger({ traceId, route: 'POST /api/ask' });

  try {
    const ip = getRequestClientIp(request);
    await consumeAskRateLimit(ip);

    const json: unknown = await request.json();
    const body = askBodySchema.parse(json);

    const db = getDb();
    const [phone] = await db
      .select({
        id: phones.id,
        status: phones.status,
        brand: phones.brand,
        model: phones.model,
        lastIngestAt: phones.lastIngestAt,
        nextIngestAt: phones.nextIngestAt,
      })
      .from(phones)
      .where(eq(phones.slug, body.phoneSlug))
      .limit(1);

    if (!phone || phone.status !== 'active') {
      return Response.json(
        { code: 'NOT_FOUND', message: 'Phone not found' },
        { status: 404, headers: { 'X-Trace-Id': traceId } },
      );
    }

    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (obj: unknown) => {
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        };

        const t0 = performance.now();
        try {
          const result = await runPhoneQna({
            phoneId: phone.id,
            query: body.query,
            retriever: getHybrid(),
            llm: getLlm(),
            log: log.child({ phoneId: phone.id }),
            signal: request.signal,
            retrievalOptions: {
              rerank: env.RETRIEVAL_LLM_RERANK ? 'llm' : 'off',
            },
            phoneMeta: {
              brand: phone.brand,
              model: phone.model,
              lastIngestAt: phone.lastIngestAt,
              nextIngestAt: phone.nextIngestAt,
            },
          });

          write({
            type: 'meta',
            phoneId: phone.id,
            retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
          });

          for (const piece of chunkTextForStream(result.text)) {
            write({ type: 'delta', text: piece });
          }

          const latencyMs = Math.round(performance.now() - t0);
          write({
            type: 'done',
            citations: result.citations,
            usage: result.usage,
            model: result.model,
            retrievalMs: result.retrieval.debug.totalMs,
            retrievalTrace: buildAskRetrievalTrace(result.retrieval),
          });

          void persistChatQuery({
            phoneId: phone.id,
            query: body.query,
            answer: result.text,
            citations: result.citations,
            retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
            latencyMs,
            tokensIn: result.usage.tokensIn,
            tokensOut: result.usage.tokensOut,
            model: result.model,
          }).catch((err) => {
            log.error({ err: toAppError(err).message }, 'persistChatQuery failed');
          });
        } catch (err) {
          const app = toAppError(err);
          write({
            type: 'error',
            code: app.code,
            message: app.message,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = err.issues[0]?.message ?? 'Invalid request body';
      return Response.json(
        { code: 'VALIDATION', message: msg },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
    }
    const app = toAppError(err);
    return Response.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
