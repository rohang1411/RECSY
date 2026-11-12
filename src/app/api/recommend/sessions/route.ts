import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { assertSameOrigin } from '@/lib/same-origin';
import {
  getDeviceCookieName,
  getDeviceCookieOptions,
  hashDeviceId,
  mintDeviceCookieValue,
} from '@/services/auth/device';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { getPerfFlags, isRecommendSessionsEnabled } from '@/services/perf/flags';
import { consumeSessionRateLimit, hashClientIp } from '@/services/rate-limit';
import {
  listSessions,
  ownerFromIdentity,
  resolveOrCreateSession,
  type SessionOwner,
} from '@/services/recommender/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().max(80).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  includePinned: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val !== undefined ? val === 'true' : undefined)),
});

const createSessionSchema = z
  .object({
    id: z.string().uuid().optional(),
  })
  .optional();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/recommend/sessions' });

  try {
    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    const perf = await getPerfFlags(db);
    if (!isRecommendSessionsEnabled(perf, identity.userId)) {
      throw new AppError('NOT_FOUND', 'Not found', { status: 404 });
    }

    const clientIp = getRequestClientIp(request);
    const subject =
      identity.userId ??
      (identity.deviceId && !identity.deviceId.startsWith('nocookie:')
        ? identity.deviceId
        : hashClientIp(clientIp));

    await consumeSessionRateLimit('sessions:list', subject, db);

    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      includePinned: url.searchParams.get('includePinned') ?? undefined,
    });

    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid query parameters', { status: 400 });
    }

    const owner = ownerFromIdentity(identity);
    const includePinned = parsed.data.includePinned ?? parsed.data.cursor === undefined;

    const result = await listSessions(db, owner, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      query: parsed.data.q,
      status: parsed.data.status,
      includePinned,
    });

    const response = NextResponse.json(
      {
        pinned: result.pinned ?? [],
        sessions: result.sessions,
        nextCursor: result.nextCursor,
        guestImportAvailable: result.guestImportAvailable ?? 0,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );

    return response;
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'list sessions request rejected');
      return NextResponse.json(
        {
          code: err.code,
          message: publicErrorMessage(err),
          traceId,
        },
        {
          status: err.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    log.error({ err }, 'failed to list recommendation sessions');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Internal server error',
        traceId,
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/recommend/sessions' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    const perf = await getPerfFlags(db);
    if (!isRecommendSessionsEnabled(perf, identity.userId)) {
      throw new AppError('NOT_FOUND', 'Not found', { status: 404 });
    }

    let owner: SessionOwner = ownerFromIdentity(identity);
    let mintedDeviceCookie: string | null = null;

    if (owner.kind === 'none') {
      mintedDeviceCookie = mintDeviceCookieValue();
      const mintedDeviceId = hashDeviceId(mintedDeviceCookie);
      owner = { kind: 'device', deviceId: mintedDeviceId };
    }

    const clientIp = getRequestClientIp(request);
    const subject =
      identity.userId ?? (owner.kind === 'device' ? owner.deviceId : hashClientIp(clientIp));

    await consumeSessionRateLimit('sessions:mutate', subject, db);

    let rawBody: unknown;
    try {
      const text = await request.text();
      rawBody = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new AppError('VALIDATION', 'Invalid JSON body', { status: 400 });
    }

    const parsed = createSessionSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid session payload', { status: 400 });
    }

    const sessionId = parsed.data?.id ?? crypto.randomUUID();

    const resolved = await resolveOrCreateSession(db, {
      id: sessionId,
      owner,
      ipHash: hashClientIp(clientIp),
      userAgent: request.headers.get('user-agent'),
    });

    if (!resolved) {
      throw new AppError('NOT_FOUND', 'Unable to create or resolve session', { status: 404 });
    }

    const response = NextResponse.json(
      {
        session: resolved.session,
        created: resolved.created,
      },
      {
        status: resolved.created ? 201 : 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );

    if (mintedDeviceCookie) {
      response.cookies.set(getDeviceCookieName(), mintedDeviceCookie, getDeviceCookieOptions());
    }

    return response;
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'create session request rejected');
      return NextResponse.json(
        {
          code: err.code,
          message: publicErrorMessage(err),
          traceId,
        },
        {
          status: err.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    log.error({ err }, 'failed to create recommendation session');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Internal server error',
        traceId,
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );
  }
}
