import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { env } from '@/env';
import { getDb } from '@/services/db/client';

/**
 * Liveness + readiness probe.
 * Normative reference: Section 15.1, Section 17.1 of plan 25.
 *
 * Reports:
 *   - status: 'ok' | 'degraded'
 *   - service: 'recsy-v2'
 *   - commit: git SHA
 *   - timestamp: ISO 8601 string
 *   - quotaMode: 'enforce' | 'shadow' | 'off'
 *   - billingEnabled: boolean
 *   - db: 'ok' | 'degraded'
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  let dbStatus: 'ok' | 'degraded' = 'ok';

  try {
    const db = getDb();
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db health timeout')), 2000)),
    ]);
  } catch {
    dbStatus = 'degraded';
  }

  const isHealthy = dbStatus === 'ok';

  return NextResponse.json(
    {
      status: isHealthy ? 'ok' : 'degraded',
      service: 'recsy-v2',
      commit: env.NEXT_PUBLIC_COMMIT_SHA,
      timestamp: new Date().toISOString(),
      quotaMode: env.QUOTA_MODE,
      billingEnabled: env.BILLING_ENABLED,
      db: dbStatus,
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
