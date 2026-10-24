/**
 * Use case: Conversational recommendation turn execution (`/api/recommend`) (Plan 26 WP-09).
 *
 * Encapsulates session acquisition/insertion, reasoning mode resolution, recommender
 * pipeline invocation, atomic turn insertion + lease settlement transaction, and cookie management.
 */
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { env } from '@/env';
import { RECOMMEND_SESSION_COOKIE } from '@/lib/constants';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import type { StageTimer } from '@/lib/stage-timer';
import type { AppDb } from '@/services/db/client';
import { recommendationTurns } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import type { AdmittedRequest } from '@/services/metering/admission';
import type { QueryLease } from '@/services/metering/lease';
import { resolveReasoningMode } from '@/services/metering/mode';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { runRecommendationPipeline } from '@/services/recommender/run-recommendation';
import {
  insertRecommendationSession,
  nextTurnIndex,
  type RecommendationSessionRow,
} from '@/services/recommender/session';
import {
  getDeviceCookieName,
  getDeviceCookieOptions,
  mintDeviceCookieValue,
} from '@/services/auth/device';

export interface RecommendUseCaseDeps {
  readonly db: AppDb;
  readonly llm: LlmProvider;
  readonly log: Logger;
  readonly timer: StageTimer;
}

export interface RecommendTurnInput {
  readonly request: NextRequest;
  readonly message: string;
  readonly admitted: AdmittedRequest;
  readonly lease: QueryLease;
  readonly sessionLookupPromise: Promise<RecommendationSessionRow | null>;
  readonly traceId: string;
  readonly requestId: string;
  readonly t0: number;
  readonly reserveMs: number;
}

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

export class RecommendTurnUseCase {
  constructor(private readonly deps: RecommendUseCaseDeps) {}

  async execute(input: RecommendTurnInput): Promise<Response> {
    const { db, llm, log, timer } = this.deps;
    const {
      request,
      message,
      admitted,
      lease,
      sessionLookupPromise,
      traceId,
      requestId: _requestId,
      t0,
      reserveMs,
    } = input;
    const { identity, ip, byok, isByok, config } = admitted;

    let session = await sessionLookupPromise;
    let sessionToken = request.cookies.get(RECOMMEND_SESSION_COOKIE)?.value ?? null;
    let setSessionCookie = false;

    if (!session) {
      sessionToken = randomBytes(24).toString('base64url');
      session = await timer.time('session', () =>
        insertRecommendationSession(db, {
          sessionCookie: sessionToken!,
          ipHash: hashSessionIp(ip),
          userAgent: request.headers.get('user-agent'),
          userId: identity.userId,
        }),
      );
      setSessionCookie = true;
    }

    const regionCode = request.cookies.get('recsy_region')?.value ?? 'US';
    const sessionId = session.id;

    const rawRequestedMode = request.headers.get('x-recsy-user-mode')?.trim().toLowerCase() as
      | 'fast'
      | 'deep'
      | undefined;
    const requestedMode = rawRequestedMode === 'deep' ? 'deep' : byok?.userMode;
    const serverMode = await timer.time('mode', () =>
      resolveReasoningMode(identity, lease, requestedMode, db),
    );
    const isSubscriber = lease.chargeSource === 'subscription' || serverMode === 'deep';

    const tPipelineStart = performance.now();
    const result = await runRecommendationPipeline({
      db,
      llm,
      sessionId,
      userMessage: message,
      regionCode,
      byok,
      serverMode,
      isSubscriber,
      leaseId: lease.isNoop || lease.id === 'off' ? null : lease.id,
      log: log.child({ sessionId }),
      timer,
    });
    const latencyMs = Math.round(performance.now() - tPipelineStart);

    const isSuccessPicks = result.kind === 'results' && result.picks.length > 0;
    const outcome: 'commit' | 'no_charge' = isSuccessPicks ? 'commit' : 'no_charge';
    const reason: 'clarify' | 'no_results' = result.kind === 'clarify' ? 'clarify' : 'no_results';
    const leaseIdForDb = lease.isNoop || lease.id === 'off' ? null : lease.id;

    const tSettleStart = performance.now();
    await timer.time('settle', async () => {
      await db.transaction(async (tx) => {
        const turnIndex = await nextTurnIndex(tx, sessionId);

        if (result.kind === 'clarify') {
          await tx.insert(recommendationTurns).values({
            sessionId,
            turnIndex,
            userMessage: message,
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
            userMessage: message,
            intent: 'recommend',
            extractedRequirements: result.requirements as unknown as Record<string, unknown>,
            candidatePhoneIds: result.picks.map((p) => p.phoneId),
            picks: result.picks as unknown[],
            latencyMs,
            leaseId: leaseIdForDb,
          });
        }

        if (outcome === 'commit') {
          await lease.commit(
            {
              model: env.LLM_CHAT_MODEL,
              tokensIn: result.usage?.tokensIn,
              tokensOut: result.usage?.tokensOut,
              latencyMs,
            },
            tx,
          );
        } else {
          await lease.noCharge(reason, tx);
        }
      });
    });
    const settleMs = Math.round(performance.now() - tSettleStart);

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
      stages: timer.snapshot(),
      ttfbMs: totalMs,
      ttfvtMs: totalMs,
    });

    const responseHeaders: Record<string, string> = { 'X-Trace-Id': traceId };
    if (shouldEmitServerTiming(request)) {
      responseHeaders['Server-Timing'] = timer.serverTiming();
    }

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
      { status: 200, headers: responseHeaders },
    );

    if (setSessionCookie && sessionToken) {
      res.cookies.set(RECOMMEND_SESSION_COOKIE, sessionToken, sessionCookieOptions());
    }
    attachDeviceCookieIfNeeded(res, request);

    return res;
  }
}
