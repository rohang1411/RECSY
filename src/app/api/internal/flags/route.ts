/**
 * Operator Platform Flags API.
 * GET /api/internal/flags — retrieves current platform flags.
 * POST /api/internal/flags — updates a platform flag with audit log trail.
 *
 * Normative reference: Plan 25 Section 13.5, WP-19.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { readRequestJson } from '@/lib/request-json';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { isOperatorAuthorized } from '@/services/internal/auth';
import { resetPlatformStateCache } from '@/services/metering/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const flagUpdateSchema = z.object({
  key: z.string().trim().min(1).max(64),
  value: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(3).max(500),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/internal/flags' });

  try {
    const authorized = await isOperatorAuthorized();
    if (!authorized) {
      throw new AppError('UNAUTHORIZED', 'Operator authorization required', { status: 401 });
    }

    const db = getDb();
    type FlagRow = Record<string, unknown> & {
      key: string;
      value: Record<string, unknown>;
      updated_at: string;
      updated_by: string | null;
    };

    const rows = await db.execute<FlagRow>(sql`
      SELECT key, value, updated_at::text AS updated_at, updated_by
      FROM platform_flags
      ORDER BY key ASC;
    `);

    const flags: Record<
      string,
      { value: Record<string, unknown>; updatedAt: string; updatedBy: string | null }
    > = {};
    for (const row of rows) {
      flags[row.key] = {
        value: row.value,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
      };
    }

    return NextResponse.json(
      { flags },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'operator flags read rejected');
      return NextResponse.json(
        { code: err.code, message: publicErrorMessage(err) },
        { status: err.status, headers: { 'X-Trace-Id': traceId } },
      );
    }
    log.error({ err }, 'failed to read platform flags');
    return NextResponse.json(
      { code: 'INTERNAL', message: 'Failed to read platform flags' },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/internal/flags' });

  try {
    const authorized = await isOperatorAuthorized();
    if (!authorized) {
      throw new AppError('UNAUTHORIZED', 'Operator authorization required', { status: 401 });
    }

    const body = await readRequestJson(request, 8192);
    const parsed = flagUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid flag payload or missing reason', { status: 400 });
    }

    const { key, value, reason } = parsed.data;
    const db = getDb();

    // 1. Fetch current value for audit delta
    const currentRows = await db.execute<{ value: Record<string, unknown> }>(sql`
      SELECT value FROM platform_flags WHERE key = ${key} LIMIT 1;
    `);
    const before = currentRows[0]?.value ?? null;

    // 2. Upsert flag
    await db.execute(sql`
      INSERT INTO platform_flags (key, value, updated_at, updated_by)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, now(), 'operator')
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by;
    `);

    // 3. Invalidate state cache
    resetPlatformStateCache();

    // 4. Audit logging
    log.warn(
      {
        event: 'platform_flag_changed',
        key,
        before,
        after: value,
        reason,
        actor: 'operator',
        traceId,
      },
      'Platform flag modified by operator',
    );

    return NextResponse.json(
      { success: true, key, value },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'operator flag update rejected');
      return NextResponse.json(
        { code: err.code, message: publicErrorMessage(err) },
        { status: err.status, headers: { 'X-Trace-Id': traceId } },
      );
    }
    log.error({ err }, 'failed to update platform flag');
    return NextResponse.json(
      { code: 'INTERNAL', message: 'Failed to update platform flag' },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }
}
