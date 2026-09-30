/**
 * POST /api/recommend/sessions/[id]/share — Generate a public read-only share snapshot.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { CLIENT_ID_COOKIE } from '@/lib/constants';
import { toAppError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import { createShareSnapshot, getOrCreateClient } from '@/services/recommender/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: `POST /api/recommend/sessions/${id}/share` });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const share = await createShareSnapshot(db, id, client.id);

    return NextResponse.json(
      {
        shareToken: share.shareToken,
        shareUrl: `/recommend/share/${share.shareToken}`,
        createdAt: share.createdAt.toISOString(),
      },
      { status: 201, headers: { 'X-Trace-Id': traceId } },
    );
  } catch (err) {
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'POST /api/recommend/sessions/:id/share failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
