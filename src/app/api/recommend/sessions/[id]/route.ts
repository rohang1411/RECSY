/**
 * /api/recommend/sessions/[id] — Manage an individual recommendation conversation thread.
 *
 * GET: Hydrates session metadata and sequential turns (ownership verified).
 * PATCH: Updates session title, pinned status, archive/active status.
 * DELETE: Soft-deletes a conversation thread.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import { CLIENT_ID_COOKIE } from '@/lib/constants';
import { env } from '@/env';
import { toAppError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import {
  deleteSession,
  getOrCreateClient,
  getSessionWithTurns,
  updateSession,
} from '@/services/recommender/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: env.NODE_ENV === 'production',
  };
}

const patchSessionSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  isPinned: z.boolean().optional(),
  status: z.enum(['active', 'closed', 'archived', 'deleted']).optional(),
  primaryIntent: z.string().trim().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: `GET /api/recommend/sessions/${id}` });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client, isNew } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const result = await getSessionWithTurns(db, id, client.id);
    if (!result) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Session not found' },
        { status: 404, headers: { 'X-Trace-Id': traceId } },
      );
    }

    const res = NextResponse.json(
      {
        session: {
          id: result.session.id,
          title: result.session.title,
          primaryIntent: result.session.primaryIntent,
          isPinned: result.session.isPinned,
          status: result.session.status,
          metadata: result.session.metadata,
          createdAt: result.session.createdAt.toISOString(),
          updatedAt: result.session.updatedAt.toISOString(),
        },
        turns: result.turns,
      },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );

    if (isNew) {
      res.cookies.set(CLIENT_ID_COOKIE, client.clientToken, clientCookieOptions());
    }

    return res;
  } catch (err) {
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'GET /api/recommend/sessions/:id failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: `PATCH /api/recommend/sessions/${id}` });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const json: unknown = await request.json();
    const body = patchSessionSchema.parse(json);

    const updated = await updateSession(db, id, client.id, body);
    if (!updated) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Session not found or access denied' },
        { status: 404, headers: { 'X-Trace-Id': traceId } },
      );
    }

    return NextResponse.json(
      {
        session: {
          id: updated.id,
          title: updated.title,
          primaryIntent: updated.primaryIntent,
          isPinned: updated.isPinned,
          status: updated.status,
          metadata: updated.metadata,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION', message: err.flatten() },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
    }
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'PATCH /api/recommend/sessions/:id failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: `DELETE /api/recommend/sessions/${id}` });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const deleted = await deleteSession(db, id, client.id);
    if (!deleted) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Session not found or already deleted' },
        { status: 404, headers: { 'X-Trace-Id': traceId } },
      );
    }

    return NextResponse.json(
      { success: true, id },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );
  } catch (err) {
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'DELETE /api/recommend/sessions/:id failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
