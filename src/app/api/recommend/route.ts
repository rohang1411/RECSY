/**
 * POST /api/recommend — conversational recommender pipeline with isolated multi-session support.
 *
 * Accepts `{ message, sessionId? }`. Resolves client identity from `recsy_client_id` cookie,
 * loads or creates the specified session thread, verifies client ownership, and executes
 * the full recommender pipeline: preference extraction → hard/soft filtering →
 * aspect-weighted ranking → pick diversification.
 *
 * Runs automated semantic titling on turn 0 to produce clean human-readable conversation titles.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import {
  CLIENT_ID_COOKIE,
  MAX_RECOMMENDER_MESSAGE_BYTES,
  RECOMMEND_SESSION_COOKIE,
} from '@/lib/constants';
import { env } from '@/env';
import { isAppError, toAppError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getDb } from '@/services/db/client';
import { recommendationTurns } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { requestLogger } from '@/services/logger';
import { consumeRecommendRateLimit } from '@/services/rate-limit';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { runRecommendationPipeline } from '@/services/recommender/run-recommendation';
import { nextTurnIndex } from '@/services/recommender/session';
import {
  createSession,
  getOrCreateClient,
  getSessionWithTurns,
  updateSession,
} from '@/services/recommender/session-manager';
import { generateSessionTitle } from '@/services/recommender/titling';

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
  sessionId: z.string().uuid().optional(),
});

function clientCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
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
    const cookieVal =
      request.cookies.get(CLIENT_ID_COOKIE)?.value ||
      request.cookies.get(RECOMMEND_SESSION_COOKIE)?.value ||
      null;

    const { client, isNew } = await getOrCreateClient(db, {
      clientToken: cookieVal,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const regionCode = request.cookies.get('recsy_region')?.value ?? 'US';

    let session: { id: string; title: string; clientId: string };
    if (body.sessionId) {
      const existing = await getSessionWithTurns(db, body.sessionId, client.id);
      if (!existing) {
        return NextResponse.json(
          { code: 'SESSION_NOT_FOUND', message: 'Session not found or access denied' },
          { status: 404, headers: { 'X-Trace-Id': traceId } },
        );
      }
      session = existing.session;
    } else {
      session = await createSession(db, client.id, {
        regionCode,
        title: 'New Recommendation',
      });
    }

    const t0 = performance.now();
    const result = await runRecommendationPipeline({
      db,
      llm: getLlm(),
      sessionId: session.id,
      userMessage: body.message,
      regionCode,
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

    let activeTitle = session.title;
    if (turnIndex === 0 && (session.title === 'New Recommendation' || !session.title)) {
      try {
        const generatedTitle = await generateSessionTitle({
          requirements: result.requirements,
          userMessage: body.message,
          llm: getLlm(),
        });
        if (generatedTitle && generatedTitle !== session.title) {
          await updateSession(db, session.id, client.id, { title: generatedTitle });
          activeTitle = generatedTitle;
        }
      } catch {
        // Semantic titling failure must never fail recommendation response
      }
    }

    const res = NextResponse.json(
      {
        kind: result.kind,
        sessionId: session.id,
        sessionTitle: activeTitle,
        turnIndex,
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

    if (isNew) {
      res.cookies.set(CLIENT_ID_COOKIE, client.clientToken, clientCookieOptions());
      res.cookies.set(RECOMMEND_SESSION_COOKIE, client.clientToken, clientCookieOptions());
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
