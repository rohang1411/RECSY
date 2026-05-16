/**
 * POST /api/recommend — conversational recommender pipeline.
 *
 * Accepts `{ message, sessionId? }`. Creates or loads an anonymous
 * recommendation session, rate-limits by IP hash, then runs the full
 * recommender pipeline: preference extraction → hard/soft filtering →
 * aspect-weighted ranking → pick diversification. Returns structured
 * `{ type: 'picks' | 'clarify' | 'error', picks?, question? }`.
 *
 * Session cookie (`recsy_rec_session`) ties multi-turn conversations to
 * prior picks without requiring authentication. Sessions are anonymous;
 * no PII is stored.
 *
 * Used by: `src/app/recommend/RecommendClient.tsx`.
 */
import { randomBytes } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import { MAX_RECOMMENDER_MESSAGE_BYTES, RECOMMEND_SESSION_COOKIE } from '@/lib/constants';
import { env } from '@/env';
import { isAppError, toAppError } from '@/lib/errors';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getRequestClientIp } from '@/lib/request-ip';
import { getDb } from '@/services/db/client';
import { recommendationTurns } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { requestLogger } from '@/services/logger';
import { consumeRecommendRateLimit } from '@/services/rate-limit';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { runRecommendationPipeline } from '@/services/recommender/run-recommendation';
import {
  findSessionByCookie,
  insertRecommendationSession,
  nextTurnIndex,
} from '@/services/recommender/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(request: NextRequest): Promise<Response> {
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: 'POST /api/recommend' });

  try {
    const ip = getRequestClientIp(request);
    await consumeRecommendRateLimit(ip);

    const json: unknown = await request.json();
    const body = bodySchema.parse(json);

    const db = getDb();
    const cookieVal = request.cookies.get(RECOMMEND_SESSION_COOKIE)?.value ?? null;
    let sessionToken = cookieVal;
    let session = sessionToken ? await findSessionByCookie(db, sessionToken) : null;
    let setSessionCookie = false;

    if (!session) {
      sessionToken = randomBytes(24).toString('base64url');
      session = await insertRecommendationSession(db, {
        sessionCookie: sessionToken,
        ipHash: hashSessionIp(ip),
        userAgent: request.headers.get('user-agent'),
      });
      setSessionCookie = true;
    }

    const t0 = performance.now();
    const result = await runRecommendationPipeline({
      db,
      llm: getLlm(),
      sessionId: session.id,
      userMessage: body.message,
      log: log.child({ sessionId: session.id }),
    });
    const latencyMs = Math.round(performance.now() - t0);

    const turnIndex = await nextTurnIndex(db, session.id);

    if (result.kind === 'clarify') {
      await db.insert(recommendationTurns).values({
        sessionId: session.id,
        turnIndex,
        userMessage: body.message,
        intent: 'clarify',
        extractedRequirements: result.requirements as unknown as Record<string, unknown>,
        clarifyingQuestion: result.clarifyingQuestion,
        latencyMs,
      });
    } else {
      await db.insert(recommendationTurns).values({
        sessionId: session.id,
        turnIndex,
        userMessage: body.message,
        intent: 'recommend',
        extractedRequirements: result.requirements as unknown as Record<string, unknown>,
        candidatePhoneIds: result.picks.map((p) => p.phoneId),
        picks: result.picks as unknown[],
        latencyMs,
      });
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
      },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );

    if (setSessionCookie && sessionToken) {
      res.cookies.set(RECOMMEND_SESSION_COOKIE, sessionToken, sessionCookieOptions());
    }

    return res;
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION', message: err.flatten() },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
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
    return NextResponse.json(
      {
        code: app.code,
        message: app.message,
        ...(devDebug != null ? { debug: devDebug } : {}),
      },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
