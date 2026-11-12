/**
 * Metered request admission pipeline (Plan 26 WP-09).
 *
 * Implements the shared admission prelude for `/api/ask` and `/api/recommend`:
 * 1. Same-origin validation
 * 2. Request client IP resolution
 * 3. Request ID resolution
 * 4. In-memory platform state check
 * 5. Identity & suspension resolution
 * 6. Rate limit consumption
 * 7. Abuse / CAPTCHA risk evaluation
 * 8. BYOK extraction & platform capacity assertion
 *
 * All admission checks happen strictly BEFORE query reservation.
 */
import { sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { env } from '@/env';
import { AccountRestrictedError, AppError } from '@/lib/errors';
import { parseRequestId } from '@/lib/request-id';
import { getRequestClientIp } from '@/lib/request-ip';
import { assertSameOrigin } from '@/lib/same-origin';
import type { StageTimer } from '@/lib/stage-timer';
import type { AppQueryDb } from '@/services/db/client';
import { resolveRequestIdentity, type RequestIdentity } from '@/services/auth/identity';
import { isTrafficRiskFlagged, verifyTurnstileToken } from '@/services/abuse/turnstile';
import { consumeAdmissionLimits } from '@/services/rate-limit';
import type { RateLimitStore } from '@/services/rate-limit/store';
import { extractByokFromHeaders, type UserByokConfig } from '@/services/llm/keys/byok-parser';
import { assertPlatformAcceptsRequest, getPlatformState } from '@/services/metering/platform';
import { getMeteringConfig } from '@/services/metering/config';
import type { PlatformState, MeteringConfig } from '@/services/metering/types';

export interface AdmissionDeps {
  readonly db: AppQueryDb;
  readonly rateLimits?: RateLimitStore;
  readonly now?: () => number;
  readonly verifyTurnstile?: typeof verifyTurnstileToken;
}

export interface AdmittedRequest {
  readonly identity: RequestIdentity;
  readonly ip: string;
  readonly requestId: string;
  readonly byok: UserByokConfig | null;
  readonly isByok: boolean;
  readonly platform: PlatformState;
  readonly config: MeteringConfig;
}

export async function assertCaptchaIfRiskFlagged(
  db: AppQueryDb,
  identity: RequestIdentity,
  anonIpCap: number,
  turnstileToken: string | null | undefined,
  clientIp?: string,
  verifier: typeof verifyTurnstileToken = verifyTurnstileToken,
): Promise<void> {
  if (identity.userId !== null || !identity.ipKey || anonIpCap <= 0 || !env.TURNSTILE_SECRET_KEY) {
    return;
  }
  try {
    const res = await db.execute<{ queries_used: number }>(sql`
      SELECT queries_used FROM usage_counters
       WHERE subject_type = 'ip_prefix'
         AND subject_id = ${identity.ipKey}
         AND usage_date = (now() AT TIME ZONE 'UTC')::date
       LIMIT 1;
    `);
    const ipAnonUsedToday = res[0]?.queries_used ?? 0;
    if (isTrafficRiskFlagged({ ipKey: identity.ipKey, ipAnonUsedToday, anonIpCap })) {
      if (!turnstileToken) {
        throw new AppError('CAPTCHA_REQUIRED', 'Security verification required', {
          status: 428,
        });
      }
      const result = await verifier(turnstileToken, clientIp);
      if (!result.success) {
        throw new AppError('CAPTCHA_REQUIRED', 'Security verification failed. Please try again.', {
          status: 428,
          context: { errorCodes: result.errorCodes },
        });
      }
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'CAPTCHA_REQUIRED') throw err;
    // Fail-open on transient database counter lookup error
  }
}

export async function admitMeteredRequest(
  request: NextRequest,
  route: 'POST /api/ask' | 'POST /api/recommend',
  deps: AdmissionDeps,
  timer: StageTimer,
): Promise<AdmittedRequest> {
  // 1. Same-origin validation
  assertSameOrigin(request);
  const ip = getRequestClientIp(request);

  // 2. Request id parsing
  const requestId = parseRequestId(request.headers.get('x-request-id')) ?? crypto.randomUUID();

  // 3. Platform state (cached in-memory, read-only; loaded before identity for localClaims flag)
  const platform = await timer.time('platform', () => getPlatformState(deps.db));

  // 4. Identity & suspension checks (local claims fast path when enabled)
  const identity = await timer.time('auth', () =>
    resolveRequestIdentity(request, {
      db: deps.db,
      localClaims: platform.perf.auth_local_claims,
    }),
  );

  if (identity.isSuspended) {
    throw new AccountRestrictedError();
  }

  // 5. Rate limiting
  const rateLimitRoute = route === 'POST /api/ask' ? 'ask' : 'recommend';
  await timer.time('rl', () =>
    consumeAdmissionLimits({
      db: deps.db,
      ip,
      identity,
      route: rateLimitRoute,
      singleStatement: platform.perf.admission_single_statement,
    }),
  );

  const config = getMeteringConfig();

  // 6. CAPTCHA verification if risk flagged
  await timer.time('captcha', () =>
    assertCaptchaIfRiskFlagged(
      deps.db,
      identity,
      config.anonIpDailyCap,
      request.headers.get('x-turnstile-token'),
      ip,
      deps.verifyTurnstile,
    ),
  );

  // 7. BYOK & Platform capacity acceptance
  const byok = extractByokFromHeaders(request.headers);
  const isByok = byok != null;
  assertPlatformAcceptsRequest(platform, identity, isByok);

  return {
    identity,
    ip,
    requestId,
    byok,
    isByok,
    platform,
    config,
  };
}
