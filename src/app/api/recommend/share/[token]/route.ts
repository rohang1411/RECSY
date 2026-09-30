/**
 * GET /api/recommend/share/[token] — Retrieve a public read-only recommendation snapshot.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { toAppError } from '@/lib/errors';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { getShareSnapshot } from '@/services/recommender/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: `GET /api/recommend/share/${token}` });

  try {
    const db = getDb();
    const result = await getShareSnapshot(db, token);
    if (!result) {
      return NextResponse.json(
        { code: 'NOT_FOUND', message: 'Shared snapshot not found or expired' },
        { status: 404, headers: { 'X-Trace-Id': traceId } },
      );
    }

    return NextResponse.json(
      {
        share: {
          shareToken: result.share.shareToken,
          viewsCount: result.share.viewsCount,
          createdAt: result.share.createdAt.toISOString(),
          expiresAt: result.share.expiresAt?.toISOString() ?? null,
        },
        session: result.frozenState.session,
        turns: result.frozenState.turns,
        sharedAt: result.frozenState.sharedAt,
      },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );
  } catch (err) {
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'GET /api/recommend/share/:token failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
