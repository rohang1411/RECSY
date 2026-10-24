/**
 * POST /api/ask — phone-scoped grounded Q&A with NDJSON streaming (Plan 26 WP-09).
 *
 * Thin controller delegating to `admitMeteredRequest`, `AskQuestionUseCase`,
 * and `meteredErrorResponse`.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { MAX_CHAT_MESSAGE_BYTES } from '@/lib/constants';
import { QuotaDeniedError } from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { createStageTimer, type StageTimer } from '@/lib/stage-timer';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import { getDb } from '@/services/db/client';
import { getAskPhoneTarget } from '@/services/chat/phone-target';
import { getLlm } from '@/services/llm';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { requestLogger } from '@/services/logger';
import { inCanary } from '@/services/perf/flags';
import { getMeteringConfig } from '@/services/metering/config';
import { reserveQuery } from '@/services/metering/reserve';
import { findReplayQuery, type ReplayQueryResult } from '@/services/metering/replay';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import type { QueryLease } from '@/services/metering/lease';
import { admitMeteredRequest, type AdmittedRequest } from '@/services/metering/admission';
import { meteredErrorResponse } from '@/services/metering/http-errors';
import { AskQuestionUseCase } from '@/services/chat/ask-use-case';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

function createReplayResponse(
  replay: ReplayQueryResult,
  traceId: string,
  requestId: string,
  timer: StageTimer,
  request: NextRequest,
): Response {
  const enc = new TextEncoder();
  const replayStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        enc.encode(
          `${JSON.stringify({
            type: 'meta',
            phoneId: replay.phoneId,
            retrievedChunkIds: replay.retrievedChunkIds,
          })}\n`,
        ),
      );
      controller.enqueue(
        enc.encode(
          `${JSON.stringify({
            type: 'delta',
            text: replay.answer,
          })}\n`,
        ),
      );
      controller.enqueue(
        enc.encode(
          `${JSON.stringify({
            type: 'done',
            citations: replay.citations,
            model: 'replayed',
            quota: replay.quota,
            replayed: true,
          })}\n`,
        ),
      );
      controller.close();
    },
  });

  const replayHeaders: Record<string, string> = {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Trace-Id': traceId,
    'X-Request-Id': requestId,
  };
  if (shouldEmitServerTiming(request)) {
    replayHeaders['Server-Timing'] = timer.serverTiming();
  }

  return new Response(replayStream, {
    headers: replayHeaders,
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = performance.now();
  const timer = createStageTimer();
  const traceId = randomUUID();
  const log = requestLogger({ traceId, route: 'POST /api/ask' });

  let lease: QueryLease | null = null;
  let admitted: AdmittedRequest | null = null;
  let reserveMs = 0;

  try {
    // 1. Request body parsing (fail-fast before database work)
    const json = await readRequestJson(request, 24_576);
    const body = askBodySchema.parse(json);

    // 2. Start phone lookup in parallel with admission
    const db = getDb();
    const phonePromise = timer.time('phone', () => getAskPhoneTarget(db, body.phoneSlug));
    phonePromise.catch(() => undefined); // avoid unhandled rejection if admission throws first

    // 3. Shared metered request admission pipeline
    admitted = await admitMeteredRequest(request, 'POST /api/ask', { db }, timer);

    // 4. Verify phone target before reserving a lease
    const phone = await phonePromise;
    if (!phone || phone.status !== 'active') {
      const totalMs = Math.round(performance.now() - t0);
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: admitted.config.mode,
        byok: admitted.isByok,
        userId: admitted.identity.userId,
        deviceId: admitted.identity.deviceId,
        chargeSource: undefined,
        outcome: 'denied',
        denial: 'NOT_FOUND',
        reserveMs: 0,
        settleMs: 0,
        totalMs,
        httpStatus: 404,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });

      const notFoundHeaders: Record<string, string> = { 'X-Trace-Id': traceId };
      if (shouldEmitServerTiming(request)) {
        notFoundHeaders['Server-Timing'] = timer.serverTiming();
      }

      return Response.json(
        { code: 'NOT_FOUND', message: 'Phone not found' },
        { status: 404, headers: notFoundHeaders },
      );
    }

    // 5. Reserve quota BEFORE execution
    const tReserveStart = performance.now();
    try {
      lease = await timer.time('reserve', () =>
        reserveQuery({
          db,
          identity: admitted!.identity,
          requestId: admitted!.requestId,
          route: 'POST /api/ask',
          traceId,
          byok: admitted!.isByok,
          shedFree: admitted!.platform.shedFreeFor(admitted!.identity),
          config: admitted!.config,
        }),
      );
      reserveMs = Math.round(performance.now() - tReserveStart);
    } catch (err: unknown) {
      if (err instanceof QuotaDeniedError && err.code === 'DUPLICATE_REQUEST') {
        const leaseId = (err.context?.leaseId as string) || null;
        if (leaseId) {
          const replay = await findReplayQuery(db, leaseId);
          if (replay) {
            log.info(
              { traceId, requestId: admitted.requestId, leaseId },
              'replaying_committed_chat_query',
            );
            return createReplayResponse(replay, traceId, admitted.requestId, timer, request);
          }
        }
      }
      throw err;
    }

    // 6. Streaming decision gated by perf flags
    const mode = admitted.platform.perf.ask_streaming;
    const shouldStream =
      mode === 'on' ||
      (mode === 'canary' &&
        inCanary(admitted.identity.deviceId, admitted.platform.perf.ask_streaming_canary_pct));

    // 7. Execute Q&A use case
    const useCase = new AskQuestionUseCase({
      db,
      llm: getLlm(),
      retriever: getHybrid(),
      log,
      timer,
    });

    return await useCase.execute({
      request,
      phone,
      query: body.query,
      admitted,
      lease,
      traceId,
      requestId: admitted.requestId,
      t0,
      reserveMs,
      shouldStream,
    });
  } catch (err) {
    return meteredErrorResponse(err, {
      traceId,
      route: 'POST /api/ask',
      request,
      timer,
      t0,
      lease,
      identity: admitted?.identity ?? null,
      isByok: admitted?.isByok ?? false,
      config: admitted?.config ?? getMeteringConfig(),
      reserveMs,
    });
  }
}
