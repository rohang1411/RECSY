/**
 * POST /api/ask — phone-scoped grounded Q&A with NDJSON streaming.
 *
 * Accepts `{ phoneSlug, query, sessionId? }`. Runs hybrid retrieval
 * (vector + FTS + RRF + MMR) scoped to the requested phone, validates
 * retrieved citations, then streams Gemini's grounded answer back as
 * NDJSON.
 *
 * Implements stream-aware metering & quota reservation:
 * 1. Quota reservation happens BEFORE the stream exists so denials return clean JSON (402/429/503).
 * 2. Grounded answer persisted with userId and leaseId before settling.
 * 3. Commits lease on success, no_charge on empty corpus or client abort, refunds on error.
 * 4. Terminal `done` and `error` chunks contain `quota: QuotaSnapshotLite`.
 *
 * Normative reference: Section 7.3.2, 7.5, 7.7, 8.7 of plan 25; Plan 26 WP-00.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import { env } from '@/env';
import { MAX_CHAT_MESSAGE_BYTES } from '@/lib/constants';
import {
  AccountRestrictedError,
  AppError,
  ByokError,
  QuotaDeniedError,
  RateLimitError,
  publicErrorMessage,
  toAppError,
} from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { getRequestClientIp } from '@/lib/request-ip';
import { parseRequestId } from '@/lib/request-id';
import { assertSameOrigin } from '@/lib/same-origin';
import { buildAskRetrievalTrace } from '@/lib/ask-retrieval-trace';
import { createStageTimer } from '@/lib/stage-timer';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import {
  NO_CONTEXT_MODEL,
  chunkTextForStream,
  persistChatQuery,
  runPhoneQna,
} from '@/services/chat/answer';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { extractByokFromHeaders } from '@/services/llm/keys/byok-parser';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { requestLogger } from '@/services/logger';
import { consumeAskRateLimit } from '@/services/rate-limit';
import { resolveRequestIdentity, type RequestIdentity } from '@/services/auth/identity';
import { consumeUserRateLimit } from '@/services/metering/rate-limit-user';
import { consumeDeviceRateLimit } from '@/services/abuse/rate-limit-device';
import { isTrafficRiskFlagged, verifyTurnstileToken } from '@/services/abuse/turnstile';
import { assertPlatformAcceptsRequest, getPlatformState } from '@/services/metering/platform';
import { getMeteringConfig } from '@/services/metering/config';
import { reserveQuery } from '@/services/metering/reserve';
import { findReplayQuery } from '@/services/metering/replay';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import { resolveReasoningMode } from '@/services/metering/mode';
import type { QueryLease } from '@/services/metering/lease';
import type { MeteredRequestOutcome } from '@/services/metering/types';

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

async function assertCaptchaIfRiskFlagged(
  db: AppQueryDb,
  identity: RequestIdentity,
  anonIpCap: number,
  turnstileToken: string | null | undefined,
  clientIp?: string,
): Promise<void> {
  if (identity.userId !== null || !identity.ipKey || anonIpCap <= 0 || !env.TURNSTILE_SECRET_KEY) {
    return;
  }
  try {
    const res = await db.execute<{ queries_used: number }>(sql`
      SELECT queries_used FROM usage_counters
       WHERE subject_type = 'ip_prefix'
         AND subject_id = ${identity.ipKey}
         AND usage_date = (now() AT TIME ZONE 'UTC')::date
       LIMIT 1;
    `);
    const ipAnonUsedToday = res[0]?.queries_used ?? 0;
    if (isTrafficRiskFlagged({ ipKey: identity.ipKey, ipAnonUsedToday, anonIpCap })) {
      if (!turnstileToken) {
        throw new AppError('CAPTCHA_REQUIRED', 'Security verification required', {
          status: 428,
        });
      }
      const result = await verifyTurnstileToken(turnstileToken, clientIp);
      if (!result.success) {
        throw new AppError('CAPTCHA_REQUIRED', 'Security verification failed. Please try again.', {
          status: 428,
          context: { errorCodes: result.errorCodes },
        });
      }
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'CAPTCHA_REQUIRED') throw err;
    // Fail-open on transient database counter lookup error
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = performance.now();
  const timer = createStageTimer();
  const traceId = randomUUID();
  const log = requestLogger({ traceId, route: 'POST /api/ask' });
  const config = getMeteringConfig();

  let lease: QueryLease | null = null;
  let identity: RequestIdentity | null = null;
  let isByok = false;
  let reserveMs = 0;
  let ttfbMs = 0;

  try {
    // 1. IP rate limit (cheap abuse shield first)
    assertSameOrigin(request);
    const ip = getRequestClientIp(request);
    await timer.time('rl', () => consumeAskRateLimit(ip));

    // 2. Request body & request id parsing
    const json = await readRequestJson(request, 24_576);
    const body = askBodySchema.parse(json);
    const requestId = parseRequestId(request.headers.get('x-request-id')) ?? crypto.randomUUID();

    // 3. Identity and abuse checks
    const db = getDb();
    identity = await timer.time('auth', () => resolveRequestIdentity(request, { db }));

    if (identity.isSuspended) {
      throw new AccountRestrictedError();
    }

    if (identity.userId) {
      await timer.time('rl', () => consumeUserRateLimit(identity!.userId!, 'ask', db));
    }
    await timer.time('rl', () => consumeDeviceRateLimit(db, identity!.deviceId, 'POST /api/ask'));

    await timer.time('captcha', () =>
      assertCaptchaIfRiskFlagged(
        db,
        identity!,
        config.anonIpDailyCap,
        request.headers.get('x-turnstile-token'),
        ip,
      ),
    );

    // 4. Platform admission & BYOK
    const platform = await timer.time('platform', () => getPlatformState(db));
    const byok = extractByokFromHeaders(request.headers);
    isByok = byok != null;
    assertPlatformAcceptsRequest(platform, identity, isByok);

    // 5. Reserve quota BEFORE the stream exists (returns clean JSON on denial)
    const tReserveStart = performance.now();
    try {
      lease = await timer.time('reserve', () =>
        reserveQuery({
          db,
          identity: identity!,
          requestId,
          route: 'POST /api/ask',
          traceId,
          byok: isByok,
          shedFree: platform.shedFreeFor(identity!),
          config,
        }),
      );
      reserveMs = Math.round(performance.now() - tReserveStart);
    } catch (err: unknown) {
      if (err instanceof QuotaDeniedError && err.code === 'DUPLICATE_REQUEST') {
        const leaseId = (err.context?.leaseId as string) || null;
        if (leaseId) {
          const replay = await findReplayQuery(db, leaseId);
          if (replay) {
            log.info({ traceId, requestId, leaseId }, 'replaying_committed_chat_query');
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
        }
      }
      throw err;
    }

    // 6. Check phone target
    const [phone] = await timer.time('phone', () =>
      db
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
        .limit(1),
    );

    if (!phone || phone.status !== 'active') {
      await lease.refund('not_found').catch(() => undefined);
      const totalMs = Math.round(performance.now() - t0);
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity.userId,
        deviceId: identity.deviceId,
        chargeSource: lease.chargeSource,
        outcome: 'refunded',
        denial: 'NOT_FOUND',
        reserveMs,
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

    // 7. Stream-aware Q&A execution
    const enc = new TextEncoder();
    let cancelled = false;
    let streamOutcome: MeteredRequestOutcome = 'committed';
    let settleMs = 0;

    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      async start(controller) {
        const write = (obj: unknown) => {
          if (cancelled || request.signal.aborted) return;
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        };

        const tStreamStart = performance.now();
        try {
          const rawRequestedMode = request.headers
            .get('x-recsy-user-mode')
            ?.trim()
            .toLowerCase() as 'fast' | 'deep' | undefined;
          const requestedMode = rawRequestedMode === 'deep' ? 'deep' : byok?.userMode;
          const serverMode = await timer.time('mode', () =>
            resolveReasoningMode(identity ?? { userId: null }, lease!, requestedMode, db),
          );
          const isSubscriber = lease!.chargeSource === 'subscription' || serverMode === 'deep';

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
            byok,
            serverMode,
            isSubscriber,
            timer,
          });

          const latencyMs = Math.round(performance.now() - tStreamStart);
          const leaseIdForDb = lease!.isNoop || lease!.id === 'off' ? null : lease!.id;

          const persistenceStart = performance.now();
          await timer.time('persist', () =>
            persistChatQuery({
              phoneId: phone.id,
              query: body.query,
              answer: result.text,
              citations: result.citations,
              retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
              latencyMs,
              tokensIn: result.generationAccounting.tokensIn,
              tokensOut: result.generationAccounting.tokensOut,
              model: result.model,
              userId: identity!.userId,
              leaseId: leaseIdForDb,
            }),
          );
          const persistenceMs = performance.now() - persistenceStart;

          const meta = {
            model: result.model,
            tokensIn: result.generationAccounting.tokensIn,
            tokensOut: result.generationAccounting.tokensOut,
            latencyMs,
            cacheHit: result.generationAccounting.cacheHits > 0,
          };

          const tSettleStart = performance.now();
          let outcome: 'commit' | 'no_charge';
          await timer.time('settle', async () => {
            if (result.model === NO_CONTEXT_MODEL) {
              await lease!.noCharge('no_context');
              outcome = 'no_charge';
              streamOutcome = 'no_charge';
            } else if (cancelled || request.signal.aborted) {
              await lease!.noCharge('client_abort');
              outcome = 'no_charge';
              streamOutcome = 'no_charge';
            } else {
              await lease!.commit(meta);
              outcome = 'commit';
              streamOutcome = 'committed';
            }
          });
          settleMs = Math.round(performance.now() - tSettleStart);

          write({
            type: 'meta',
            phoneId: phone.id,
            retrievedChunkIds: result.retrieval.chunks.map((c) => c.chunkId),
          });

          timer.mark('firstDelta');
          const ttfvtMs = Math.round(performance.now() - t0);

          for (const piece of chunkTextForStream(result.text)) {
            write({ type: 'delta', text: piece });
          }

          write({
            type: 'done',
            citations: result.citations,
            usage: result.usage,
            generationAccounting: result.generationAccounting,
            model: result.model,
            persistenceMs,
            retrievalMs: result.retrieval.debug.totalMs,
            retrievalTrace: buildAskRetrievalTrace(result.retrieval),
            quota: lease!.projectedQuota(outcome!),
          });

          const totalMs = Math.round(performance.now() - t0);
          emitMeteredRequestSummary({
            traceId,
            route: 'POST /api/ask',
            quotaMode: config.mode,
            byok: isByok,
            userId: identity!.userId,
            deviceId: identity!.deviceId,
            chargeSource: lease!.chargeSource,
            outcome: streamOutcome,
            reserveMs,
            settleMs,
            totalMs,
            model: result.model,
            tokensIn: result.generationAccounting.tokensIn,
            tokensOut: result.generationAccounting.tokensOut,
            cacheHit: result.generationAccounting.cacheHits > 0,
            httpStatus: 200,
            stages: timer.snapshot(),
            ttfbMs,
            ttfvtMs,
          });
        } catch (err) {
          const app = toAppError(err);
          log.error({ err, code: app.code }, 'Q&A request failed');

          const tRefundStart = performance.now();
          await lease!.refund(app.code).catch(() => undefined);
          settleMs = Math.round(performance.now() - tRefundStart);
          streamOutcome = 'refunded';

          write({
            type: 'error',
            code: app.code,
            message: publicErrorMessage(app),
            quota: lease!.projectedQuota('refund'),
          });

          const totalMs = Math.round(performance.now() - t0);
          emitMeteredRequestSummary({
            traceId,
            route: 'POST /api/ask',
            quotaMode: config.mode,
            byok: isByok,
            userId: identity!.userId,
            deviceId: identity!.deviceId,
            chargeSource: lease!.chargeSource,
            outcome: 'refunded',
            denial: app.code,
            reserveMs,
            settleMs,
            totalMs,
            httpStatus: app.status,
            stages: timer.snapshot(),
            ttfbMs,
          });
        } finally {
          if (!cancelled) controller.close();
        }
      },
    });

    ttfbMs = Math.round(performance.now() - t0);
    const streamHeaders: Record<string, string> = {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Trace-Id': traceId,
      'X-Request-Id': requestId,
    };
    if (shouldEmitServerTiming(request)) {
      streamHeaders['Server-Timing'] = timer.serverTiming();
    }

    return new Response(stream, {
      headers: streamHeaders,
    });
  } catch (err) {
    const totalMs = Math.round(performance.now() - t0);
    if (lease && !lease.settled) {
      const refundCode = err instanceof AppError ? err.code : 'internal_error';
      await lease.refund(refundCode).catch(() => undefined);
    }

    const errorServerTiming = shouldEmitServerTiming(request) ? timer.serverTiming() : undefined;

    if (err instanceof ZodError) {
      const msg = err.issues[0]?.message ?? 'Invalid request body';
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'VALIDATION',
        reserveMs,
        settleMs: 0,
        totalMs,
        httpStatus: 400,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });
      const headers: Record<string, string> = { 'X-Trace-Id': traceId };
      if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;
      return NextResponse.json({ code: 'VALIDATION', message: msg }, { status: 400, headers });
    }

    if (err instanceof QuotaDeniedError) {
      const retryAfter =
        err.code === 'TOO_MANY_INFLIGHT' || err.code === 'DUPLICATE_REQUEST'
          ? '2'
          : err.code === 'CAPACITY_BUSY'
            ? '30'
            : err.code === 'METERING_UNAVAILABLE'
              ? '10'
              : undefined;

      const headers: Record<string, string> = { 'X-Trace-Id': traceId };
      if (retryAfter) headers['Retry-After'] = retryAfter;
      if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;

      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: err.code,
        reserveMs,
        settleMs: 0,
        totalMs,
        httpStatus: err.status,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });

      return NextResponse.json(
        {
          code: err.code,
          message: publicErrorMessage(err),
          quota: err.quota,
          actions: err.actions,
        },
        { status: err.status, headers },
      );
    }

    if (err instanceof RateLimitError) {
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'RATE_LIMITED',
        reserveMs,
        settleMs: 0,
        totalMs,
        httpStatus: 429,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });
      const headers: Record<string, string> = {
        'X-Trace-Id': traceId,
        'Retry-After': '60',
      };
      if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;
      return NextResponse.json(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment.',
        },
        {
          status: 429,
          headers,
        },
      );
    }

    if (err instanceof AccountRestrictedError) {
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'ACCOUNT_RESTRICTED',
        reserveMs,
        settleMs: 0,
        totalMs,
        httpStatus: 403,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });
      const headers: Record<string, string> = { 'X-Trace-Id': traceId };
      if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;
      return NextResponse.json(
        {
          code: 'ACCOUNT_RESTRICTED',
          message: err.message,
        },
        { status: 403, headers },
      );
    }

    if (err instanceof ByokError) {
      const headers: Record<string, string> = { 'X-Trace-Id': traceId };
      if (err.code === 'BYOK_RATE_LIMITED') {
        headers['Retry-After'] = '60';
      }
      if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/ask',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'error',
        denial: err.code,
        reserveMs,
        settleMs: 0,
        totalMs,
        httpStatus: err.status,
        stages: timer.snapshot(),
        ttfbMs: totalMs,
      });
      return NextResponse.json(
        {
          code: err.code,
          message: publicErrorMessage(err),
        },
        { status: err.status, headers },
      );
    }

    const app = toAppError(err);
    log.error({ err, code: app.code }, 'Q&A request setup failed');

    const headers: Record<string, string> = { 'X-Trace-Id': traceId };
    if (app.code === 'METERING_UNAVAILABLE' || app.code === 'AUTH_UNAVAILABLE') {
      headers['Retry-After'] = '10';
    } else if (app.code === 'CAPACITY_BUSY') {
      headers['Retry-After'] = '30';
    }
    if (errorServerTiming) headers['Server-Timing'] = errorServerTiming;

    emitMeteredRequestSummary({
      traceId,
      route: 'POST /api/ask',
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: lease?.settleOutcome === 'refunded' ? 'refunded' : 'error',
      denial: app.code,
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: app.status,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      {
        code: app.code,
        message: publicErrorMessage(app),
      },
      { status: app.status, headers },
    );
  }
}
