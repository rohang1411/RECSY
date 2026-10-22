/**
 * GET /api/me/entitlements — viewer quota and subscription snapshot.
 *
 * Normative reference: Plan 25 Section 7.8, Section 5.7, Section 15.2.
 *
 * Fast path: unauthenticated requests without device cookies (crawlers, first paint)
 * are served static defaults with ZERO database queries.
 * Hot path: single-statement SQL snapshot with private no-store and ETag caching.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { AccountRestrictedError, isAppError, publicErrorMessage } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getUserProfile } from '@/services/auth/profile';
import {
  getEntitlementSnapshot,
  getStaticDefaultEntitlement,
} from '@/services/metering/entitlement';
import { consumeUserRateLimit } from '@/services/metering/rate-limit-user';
import { consumeDeviceRateLimit } from '@/services/abuse/rate-limit-device';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/me/entitlements' });

  try {
    const identity = await resolveRequestIdentity(request);

    if (identity.isSuspended) {
      throw new AccountRestrictedError('Your account has been restricted');
    }

    // Fast path: crawler or fresh client with no cookies
    if (!identity.userId && (!identity.deviceId || identity.deviceId.startsWith('nocookie:'))) {
      const snapshot = getStaticDefaultEntitlement();
      const etag = `W/"${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 27)}"`;

      if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            'Cache-Control': 'private, no-store',
            ETag: etag,
            'X-Trace-Id': traceId,
          },
        });
      }

      return NextResponse.json(
        {
          ...snapshot,
          serverNow: new Date().toISOString(),
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            ETag: etag,
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    const db = getDb();

    // Rate limiting: 60/min per identity
    if (identity.userId) {
      await consumeUserRateLimit(identity.userId, 'read', db);
    }
    await consumeDeviceRateLimit(db, identity.deviceId, 'GET /api/me');

    const profile = identity.userId ? await getUserProfile(db, identity.userId) : null;
    const snapshot = await getEntitlementSnapshot({
      db,
      identity: {
        userId: identity.userId,
        deviceId: identity.deviceId,
        email: profile?.email ?? null,
      },
      profile,
    });

    const etag = `W/"${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 27)}"`;

    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'private, no-store',
          ETag: etag,
          'X-Trace-Id': traceId,
        },
      });
    }

    return NextResponse.json(
      {
        ...snapshot,
        serverNow: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          ETag: etag,
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'entitlements read denied');
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

    log.error({ err }, 'failed to serve entitlements');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to retrieve entitlements',
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
