/**
 * POST /api/recommend — conversational recommender pipeline.
 *
 * Accepts `{ message, sessionId? }`. Creates or loads an anonymous
 * or user-owned recommendation session, enforces metering, quota reservations,
 * rate limits, abuse checks, then runs the full recommender pipeline.
 *
 * Normative reference: Section 7.3.1, 7.5, 7.7, 8.6, 8.7 of plan 25.
 */
import { randomBytes } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';
import { sql } from 'drizzle-orm';

import { MAX_RECOMMENDER_MESSAGE_BYTES, RECOMMEND_SESSION_COOKIE } from '@/lib/constants';
import { env } from '@/env';
import {
  AccountRestrictedError,
  AppError,
  ByokError,
  QuotaDeniedError,
  RateLimitError,
  isAppError,
  publicErrorMessage,
  toAppError,
} from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getRequestClientIp } from '@/lib/request-ip';
import { assertSameOrigin } from '@/lib/same-origin';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { recommendationTurns } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { extractByokFromHeaders } from '@/services/llm/keys/byok-parser';
import { requestLogger } from '@/services/logger';
import { consumeRecommendRateLimit } from '@/services/rate-limit';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { runRecommendationPipeline } from '@/services/recommender/run-recommendation';
import {
  findSessionByCookie,
  insertRecommendationSession,
  nextTurnIndex,
} from '@/services/recommender/session';
import {
  getDeviceCookieName,
  getDeviceCookieOptions,
  mintDeviceCookieValue,
} from '@/services/auth/device';
import { resolveRequestIdentity, type RequestIdentity } from '@/services/auth/identity';
import { consumeUserRateLimit } from '@/services/metering/rate-limit-user';
import { consumeDeviceRateLimit } from '@/services/abuse/rate-limit-device';
import { isTrafficRiskFlagged, verifyTurnstileToken } from '@/services/abuse/turnstile';
import { assertPlatformAcceptsRequest, getPlatformState } from '@/services/metering/platform';
import { getMeteringConfig } from '@/services/metering/config';
import { reserveQuery } from '@/services/metering/reserve';
import { findReplayTurn } from '@/services/metering/replay';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import { resolveReasoningMode } from '@/services/metering/mode';
import type { QueryLease } from '@/services/metering/lease';

import { parseRequestId } from '@/lib/request-id';
export { parseRequestId };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .refine(
      (m) => new TextEncoder().encode(m).length <= MAX_RECOMMENDER_MESSAGE_BYTES,
      'message too long',
    ),
});

function sessionCookieOptions(): {
  readonly httpOnly: boolean;
  readonly sameSite: 'lax';
  readonly path: string;
  readonly maxAge: number;
  readonly secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
    secure: env.NODE_ENV === 'production',
  };
}

function attachDeviceCookieIfNeeded(res: NextResponse, request: NextRequest): void {
  const name = getDeviceCookieName();
  if (!request.cookies.get(name)?.value) {
    res.cookies.set(name, mintDeviceCookieValue(), getDeviceCookieOptions());
  }
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
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: 'POST /api/recommend' });
  const config = getMeteringConfig();

  let lease: QueryLease | null = null;
  let identity: RequestIdentity | null = null;
  let isByok = false;
  let reserveMs = 0;
  let settleMs = 0;

  try {
    assertSameOrigin(request);
    const ip = getRequestClientIp(request);
    await consumeRecommendRateLimit(ip);

    const json = await readRequestJson(request, 16_384);
    const body = bodySchema.parse(json);

    const requestId = parseRequestId(request.headers.get('x-request-id')) ?? crypto.randomUUID();

    const db = getDb();
    identity = await resolveRequestIdentity(request, { db });

    if (identity.isSuspended) {
      throw new AccountRestrictedError();
    }

    if (identity.userId) {
      await consumeUserRateLimit(identity.userId, 'recommend', db);
    }
    await consumeDeviceRateLimit(db, identity.deviceId, 'POST /api/recommend');

    await assertCaptchaIfRiskFlagged(
      db,
      identity,
      config.anonIpDailyCap,
      request.headers.get('x-turnstile-token'),
      ip,
    );

    const platform = await getPlatformState(db);
    const byok = extractByokFromHeaders(request.headers);
    isByok = byok != null;
    assertPlatformAcceptsRequest(platform, identity, isByok);

    const tReserveStart = performance.now();
    try {
      lease = await reserveQuery({
        db,
        identity,
        requestId,
        route: 'POST /api/recommend',
        traceId,
        byok: isByok,
        shedFree: platform.shedFreeFor(identity),
        config,
      });
      reserveMs = Math.round(performance.now() - tReserveStart);
    } catch (err: unknown) {
      if (err instanceof QuotaDeniedError && err.code === 'DUPLICATE_REQUEST') {
        const leaseId = (err.context?.leaseId as string) || null;
        if (leaseId) {
          const replay = await findReplayTurn(db, leaseId);
          if (replay) {
            log.info({ traceId, requestId, leaseId }, 'replaying_committed_recommendation');
            return NextResponse.json(
              {
                message: replay.userMessage,
                intent: replay.intent,
                requirements: replay.extractedRequirements,
                picks: replay.picks ?? [],
                clarifyingQuestion: replay.clarifyingQuestion ?? undefined,
                quota: replay.quota,
                sessionId: replay.sessionId,
                replayed: true,
              },
              {
                headers: {
                  'Cache-Control': 'private, no-store',
                  'X-Trace-Id': traceId,
                  'X-Request-Id': requestId,
                },
              },
            );
          }
        }
      }
      throw err;
    }

    const cookieVal = request.cookies.get(RECOMMEND_SESSION_COOKIE)?.value ?? null;
    let sessionToken = cookieVal;
    let session = sessionToken
      ? await findSessionByCookie(db, sessionToken, { userId: identity.userId })
      : null;
    let setSessionCookie = false;

    if (!session) {
      sessionToken = randomBytes(24).toString('base64url');
      session = await insertRecommendationSession(db, {
        sessionCookie: sessionToken,
        ipHash: hashSessionIp(ip),
        userAgent: request.headers.get('user-agent'),
        userId: identity.userId,
      });
      setSessionCookie = true;
    }

    const regionCode = request.cookies.get('recsy_region')?.value ?? 'US';
    const sessionId = session.id;

    const rawRequestedMode = request.headers.get('x-recsy-user-mode')?.trim().toLowerCase() as
      | 'fast'
      | 'deep'
      | undefined;
    const requestedMode = rawRequestedMode === 'deep' ? 'deep' : byok?.userMode;
    const serverMode = await resolveReasoningMode(identity, lease, requestedMode, db);
    const isSubscriber = lease.chargeSource === 'subscription' || serverMode === 'deep';

    const tPipelineStart = performance.now();
    const result = await runRecommendationPipeline({
      db,
      llm: getLlm(),
      sessionId,
      userMessage: body.message,
      regionCode,
      byok,
      serverMode,
      isSubscriber,
      leaseId: lease.isNoop || lease.id === 'off' ? null : lease.id,
      log: log.child({ sessionId }),
    });
    const latencyMs = Math.round(performance.now() - tPipelineStart);

    const isSuccessPicks = result.kind === 'results' && result.picks.length > 0;
    const outcome: 'commit' | 'no_charge' = isSuccessPicks ? 'commit' : 'no_charge';
    const reason: 'clarify' | 'no_results' = result.kind === 'clarify' ? 'clarify' : 'no_results';
    const leaseIdForDb = lease.isNoop || lease.id === 'off' ? null : lease.id;

    const tSettleStart = performance.now();
    await db.transaction(async (tx) => {
      const turnIndex = await nextTurnIndex(tx, sessionId);

      if (result.kind === 'clarify') {
        await tx.insert(recommendationTurns).values({
          sessionId,
          turnIndex,
          userMessage: body.message,
          intent: 'clarify',
          extractedRequirements: result.requirements as unknown as Record<string, unknown>,
          clarifyingQuestion: result.clarifyingQuestion,
          latencyMs,
          leaseId: leaseIdForDb,
        });
      } else {
        await tx.insert(recommendationTurns).values({
          sessionId,
          turnIndex,
          userMessage: body.message,
          intent: 'recommend',
          extractedRequirements: result.requirements as unknown as Record<string, unknown>,
          candidatePhoneIds: result.picks.map((p) => p.phoneId),
          picks: result.picks as unknown[],
          latencyMs,
          leaseId: leaseIdForDb,
        });
      }

      if (outcome === 'commit') {
        await lease!.commit(
          {
            model: env.LLM_CHAT_MODEL,
            tokensIn: result.usage?.tokensIn,
            tokensOut: result.usage?.tokensOut,
            latencyMs,
          },
          tx,
        );
      } else {
        await lease!.noCharge(reason, tx);
      }
    });
    settleMs = Math.round(performance.now() - tSettleStart);

    const totalMs = Math.round(performance.now() - t0);
    emitMeteredRequestSummary({
      traceId,
      route: 'POST /api/recommend',
      quotaMode: config.mode,
      byok: isByok,
      userId: identity.userId,
      deviceId: identity.deviceId,
      chargeSource: lease.chargeSource,
      outcome: outcome === 'commit' ? 'committed' : 'no_charge',
      reserveMs,
      settleMs,
      totalMs,
      model: env.LLM_CHAT_MODEL,
      tokensIn: result.usage?.tokensIn,
      tokensOut: result.usage?.tokensOut,
      httpStatus: 200,
    });

    const res = NextResponse.json(
      {
        kind: result.kind,
        clarifyingQuestion: result.kind === 'clarify' ? result.clarifyingQuestion : undefined,
        picks: result.kind === 'results' ? result.picks : undefined,
        relaxed: result.kind === 'results' ? result.relaxed : undefined,
        refined: result.kind === 'results' ? result.refined : undefined,
        scoresTied: result.kind === 'results' ? result.scoresTied : undefined,
        scorecardMissing: result.kind === 'results' ? result.scorecardMissing : undefined,
        topAspects: result.kind === 'results' ? result.topAspects : undefined,
        quota: lease.projectedQuota(outcome),
      },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );

    if (setSessionCookie && sessionToken) {
      res.cookies.set(RECOMMEND_SESSION_COOKIE, sessionToken, sessionCookieOptions());
    }
    attachDeviceCookieIfNeeded(res, request);

    return res;
  } catch (err) {
    const totalMs = Math.round(performance.now() - t0);
    if (lease && !lease.settled) {
      const refundCode = err instanceof AppError ? err.code : 'internal_error';
      await lease
        .refund(refundCode)
        .catch((e) => log.error({ e }, 'refund failed; lease will expire'));
    }

    if (err instanceof ZodError) {
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/recommend',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'VALIDATION',
        reserveMs,
        settleMs,
        totalMs,
        httpStatus: 400,
      });
      return NextResponse.json(
        { code: 'VALIDATION', message: err.flatten() },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
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

      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/recommend',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: err.code,
        reserveMs,
        settleMs,
        totalMs,
        httpStatus: err.status,
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
        route: 'POST /api/recommend',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'RATE_LIMITED',
        reserveMs,
        settleMs,
        totalMs,
        httpStatus: 429,
      });
      return NextResponse.json(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment.',
        },
        {
          status: 429,
          headers: {
            'X-Trace-Id': traceId,
            'Retry-After': '60',
          },
        },
      );
    }

    if (err instanceof AccountRestrictedError) {
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/recommend',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'denied',
        denial: 'ACCOUNT_RESTRICTED',
        reserveMs,
        settleMs,
        totalMs,
        httpStatus: 403,
      });
      return NextResponse.json(
        {
          code: 'ACCOUNT_RESTRICTED',
          message: err.message,
        },
        { status: 403, headers: { 'X-Trace-Id': traceId } },
      );
    }

    if (err instanceof ByokError) {
      const headers: Record<string, string> = { 'X-Trace-Id': traceId };
      if (err.code === 'BYOK_RATE_LIMITED') {
        headers['Retry-After'] = '60';
      }
      emitMeteredRequestSummary({
        traceId,
        route: 'POST /api/recommend',
        quotaMode: config.mode,
        byok: isByok,
        userId: identity?.userId,
        deviceId: identity?.deviceId,
        chargeSource: lease?.chargeSource,
        outcome: 'error',
        denial: err.code,
        reserveMs,
        settleMs,
        totalMs,
        httpStatus: err.status,
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
    const detail = summarizeErrorChainForLogs(err);
    log.warn(
      {
        err: app.message,
        code: app.code,
        ...(isAppError(err) ? { context: err.context } : {}),
        detail,
      },
      'POST /api/recommend failed',
    );
    const devDebug =
      env.NODE_ENV === 'development' && isAppError(err) && err.code === 'LLM_SCHEMA_VIOLATION'
        ? { context: err.context, causeChain: detail }
        : undefined;

    const headers: Record<string, string> = { 'X-Trace-Id': traceId };
    if (app.code === 'METERING_UNAVAILABLE' || app.code === 'AUTH_UNAVAILABLE') {
      headers['Retry-After'] = '10';
    } else if (app.code === 'CAPACITY_BUSY') {
      headers['Retry-After'] = '30';
    }

    emitMeteredRequestSummary({
      traceId,
      route: 'POST /api/recommend',
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: lease ? 'refunded' : 'error',
      denial: app.code,
      reserveMs,
      settleMs,
      totalMs,
      httpStatus: app.status,
    });

    return NextResponse.json(
      {
        code: app.code,
        message: publicErrorMessage(app),
        ...(devDebug != null ? { debug: devDebug } : {}),
      },
      { status: app.status, headers },
    );
  }
}
