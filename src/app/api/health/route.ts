import { NextResponse } from 'next/server';

import { env } from '@/env';

/**
 * Liveness + config probe.
 *
 * Returns 200 only when the process has booted successfully — which implies
 * env validation in `@/env` passed at build time. Used by:
 *   - CI to verify a build works end-to-end.
 *   - Vercel's health checks.
 *   - Manual ops smoke tests.
 *
 * We intentionally avoid touching the database or the LLM provider here — a
 * health check should not depend on external services. Dependency-level
 * readiness belongs to `/api/health/deep` (Phase 1+).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'recsy-v2',
    commit: env.NEXT_PUBLIC_COMMIT_SHA,
    timestamp: new Date().toISOString(),
  });
}
