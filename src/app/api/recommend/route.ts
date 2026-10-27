/**
 * POST /api/recommend — conversational recommender pipeline (Plan 26 WP-09, Plan 27 WP-04).
 *
 * Thin controller delegating to `admitMeteredRequest`, `RecommendTurnUseCase`,
 * and `meteredErrorResponse`.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_RECOMMENDER_MESSAGE_BYTES, RECOMMEND_SESSION_COOKIE } from '@/lib/constants';
import { QuotaDeniedError } from '@/lib/errors';
import { parseRequestId } from '@/lib/request-id';
import { readRequestJson } from '@/lib/request-json';
import { createStageTimer, type StageTimer } from '@/lib/stage-timer';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import { getDb } from '@/services/db/client';
import { getLlm } from '@/services/llm';
import { requestLogger } from '@/services/logger';
import { findSessionByCookie } from '@/services/recommender/session';
import { getMeteringConfig } from '@/services/metering/config';
import { reserveQuery } from '@/services/metering/reserve';
import { findReplayTurn, type ReplayTurnResult } from '@/services/metering/replay';
import type { QueryLease } from '@/services/metering/lease';
import { admitMeteredRequest, type AdmittedRequest } from '@/services/metering/admission';
import { meteredErrorResponse } from '@/services/metering/http-errors';
import { isRecommendSessionsEnabled } from '@/services/perf/flags';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { hashDeviceId, mintDeviceCookieValue } from '@/services/auth/device';
import { ownerFromIdentity, type SessionOwner } from '@/services/recommender/sessions/owner';
import { resolveOrCreateSession } from '@/services/recommender/sessions/service';
import type { ResolveOrCreateSessionResult } from '@/services/recommender/sessions/types';
import { RecommendTurnUseCase } from '@/services/recommender/recommend-use-case';

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
  sessionId: z.string().uuid().optional(),
});

function createReplayResponse(
  replay: ReplayTurnResult,
  traceId: string,
  requestId: string,
  timer: StageTimer,
  request: NextRequest,
): NextResponse {
  const replayHeaders: Record<string, string> = {
    'Cache-Control': 'private, no-store',
    'X-Trace-Id': traceId,
    'X-Request-Id': requestId,
  };
  if (shouldEmitServerTiming(request)) {
    replayHeaders['Server-Timing'] = timer.serverTiming();
  }
  const kind = replay.intent === 'clarify' ? 'clarify' : 'results';
  return NextResponse.json(
    {
      kind,
      message: replay.userMessage,
      clarifyingQuestion: kind === 'clarify' ? (replay.clarifyingQuestion ?? undefined) : undefined,
      picks: kind === 'results' ? (replay.picks ?? []) : undefined,
      relaxed: [],
      refined: false,
      scoresTied: false,
      scorecardMissing: false,
      topAspects: [],
      quota: replay.quota ?? undefined,
      sessionId: replay.sessionId,
      turnIndex: replay.turnIndex ?? 0,
      session: {
        title: 'Recommendation',
        titleSource: 'default',
        turnCount: (replay.turnIndex ?? 0) + 1,
        created: false,
      },
      topicShift: false,
      replayed: true,
    },
    { headers: replayHeaders },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = performance.now();
  const timer = createStageTimer();
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: 'POST /api/recommend' });

  let lease: QueryLease | null = null;
  let admitted: AdmittedRequest | null = null;
  let reserveMs = 0;

  try {
    // 1. Request body parsing (fail-fast before database work)
    const json = await readRequestJson(request, 16_384);
    const body = bodySchema.parse(json);

    // 2. Shared metered request admission pipeline
    const db = getDb();
    admitted = await admitMeteredRequest(request, 'POST /api/recommend', { db }, timer);

    // 3. Determine execution mode (Session mode vs Legacy cookie mode)
    const sessionsFlagEnabled = isRecommendSessionsEnabled(
      admitted.platform.perf,
      admitted.identity.userId,
    );
    const isSessionMode = Boolean(body.sessionId) && sessionsFlagEnabled;

    let owner: SessionOwner = ownerFromIdentity(admitted.identity);
    let mintedDeviceCookie: string | null = null;

    let sessionLookupPromise:
      | Promise<import('@/services/recommender/session').RecommendationSessionRow | null>
      | undefined;
    let sessionResolutionPromise: Promise<ResolveOrCreateSessionResult | null> | undefined;

    if (isSessionMode) {
      if (owner.kind === 'none') {
        // Mint device cookie for anonymous session owner before creation (Plan 27 Section 7.4)
        mintedDeviceCookie = mintDeviceCookieValue();
        const mintedDeviceId = hashDeviceId(mintedDeviceCookie);
        owner = { kind: 'device', deviceId: mintedDeviceId };
      }

      const regionCode = request.cookies.get('recsy_region')?.value ?? 'US';
      sessionResolutionPromise = timer.time('session', () =>
        resolveOrCreateSession(db, {
          id: body.sessionId!,
          owner,
          ipHash: hashSessionIp(admitted!.ip),
          userAgent: request.headers.get('user-agent'),
          regionCode,
        }),
      );
      sessionResolutionPromise.catch(() => undefined);
    } else {
      // Legacy cookie path
      const cookieVal = request.cookies.get(RECOMMEND_SESSION_COOKIE)?.value ?? null;
      sessionLookupPromise = cookieVal
        ? timer.time('session', () =>
            findSessionByCookie(db, cookieVal, { userId: admitted!.identity.userId }),
          )
        : Promise.resolve(null);
      sessionLookupPromise.catch(() => undefined);
    }

    // 4. Reserve quota in parallel with session resolution BEFORE pipeline execution
    const tReserveStart = performance.now();
    try {
      lease = await timer.time('reserve', () =>
        reserveQuery({
          db,
          identity: admitted!.identity,
          requestId: admitted!.requestId,
          route: 'POST /api/recommend',
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
          const replay = await findReplayTurn(db, leaseId);
          if (replay) {
            log.info(
              { traceId, requestId: admitted.requestId, leaseId },
              'replaying_committed_recommendation',
            );
            return createReplayResponse(replay, traceId, admitted.requestId, timer, request);
          }
        }
      }
      throw err;
    }

    // 5. If session mode, wait for session resolution and enforce 404 / 409 before pipeline
    let sessionResolution: ResolveOrCreateSessionResult | undefined;
    if (isSessionMode && sessionResolutionPromise) {
      const resolved = await sessionResolutionPromise;
      if (!resolved) {
        await lease.noCharge('session_gone');
        return NextResponse.json(
          {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found or deleted',
            traceId,
          },
          { status: 404, headers: { 'Cache-Control': 'private, no-store', 'X-Trace-Id': traceId } },
        );
      }

      // Check turn limit (Plan 27 D27-7)
      if (resolved.session.turnCount >= 50) {
        await lease.noCharge('session_gone');
        return NextResponse.json(
          {
            code: 'SESSION_TURN_LIMIT',
            message: 'This conversation has reached the 50-turn limit',
            traceId,
          },
          { status: 409, headers: { 'Cache-Control': 'private, no-store', 'X-Trace-Id': traceId } },
        );
      }

      sessionResolution = resolved;
    }

    // 6. Execute recommendation turn use case
    const useCase = new RecommendTurnUseCase({
      db,
      llm: getLlm(),
      log,
      timer,
    });

    return await useCase.execute({
      request,
      message: body.message,
      sessionId: body.sessionId,
      isSessionMode,
      admitted,
      lease,
      sessionLookupPromise,
      sessionResolution,
      owner,
      mintedDeviceCookie,
      traceId,
      requestId: admitted.requestId,
      t0,
      reserveMs,
    });
  } catch (err) {
    return meteredErrorResponse(err, {
      traceId,
      route: 'POST /api/recommend',
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
