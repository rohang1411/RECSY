/**
 * Shared HTTP error mapper for metered routes (Plan 26 WP-09).
 *
 * Maps errors (ZodError, QuotaDeniedError, RateLimitError, AccountRestrictedError,
 * ByokError, AppError, unknown) to canonical HTTP responses and emits structured
 * request summary telemetry. Idempotently refunds unsettled query leases.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  AccountRestrictedError,
  AppError,
  ByokError,
  QuotaDeniedError,
  RateLimitError,
  publicErrorMessage,
} from '@/lib/errors';
import { shouldEmitServerTiming } from '@/lib/server-timing';
import type { StageTimer } from '@/lib/stage-timer';
import type { RequestIdentity } from '@/services/auth/identity';
import type { QueryLease } from '@/services/metering/lease';
import type { MeteringConfig } from '@/services/metering/types';
import { emitMeteredRequestSummary } from '@/services/metering/summary';
import { logger } from '@/services/logger';

export interface MeteredErrorContext {
  readonly traceId: string;
  readonly route: 'POST /api/ask' | 'POST /api/recommend';
  readonly request: NextRequest;
  readonly timer: StageTimer;
  readonly t0: number;
  readonly lease: QueryLease | null;
  readonly identity: RequestIdentity | null;
  readonly isByok: boolean;
  readonly config: MeteringConfig;
  readonly reserveMs?: number;
}

export async function meteredErrorResponse(
  err: unknown,
  ctx: MeteredErrorContext,
): Promise<NextResponse> {
  const { traceId, route, request, timer, t0, lease, identity, isByok, config } = ctx;
  const reserveMs = ctx.reserveMs ?? 0;
  const totalMs = Math.round(performance.now() - t0);

  // Refund unsettled lease on any error
  let refunded = false;
  if (lease && !lease.settled) {
    const refundCode = err instanceof AppError ? err.code : 'internal_error';
    await lease.refund(refundCode).catch(() => undefined);
    refunded = true;
  }

  const headers: Record<string, string> = { 'X-Trace-Id': traceId };
  if (shouldEmitServerTiming(request)) {
    headers['Server-Timing'] = timer.serverTiming();
  }

  if (err instanceof ZodError) {
    const body =
      route === 'POST /api/ask'
        ? { code: 'VALIDATION', message: err.issues[0]?.message ?? 'Invalid request body' }
        : { code: 'VALIDATION', message: err.flatten() };

    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: 'denied',
      denial: 'VALIDATION',
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: 400,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(body, { status: 400, headers });
  }

  if (err instanceof QuotaDeniedError) {
    const retryAfter =
      err.code === 'TOO_MANY_INFLIGHT' || err.code === 'DUPLICATE_REQUEST'
        ? '2'
        : err.code === 'CAPACITY_BUSY'
          ? '30'
          : undefined;

    if (retryAfter) {
      headers['Retry-After'] = retryAfter;
    }

    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: 'denied',
      denial: err.code,
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: err.status,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      {
        code: err.code,
        message: err.message,
        quota: err.quota,
        actions: err.actions,
      },
      { status: err.status, headers },
    );
  }

  if (err instanceof RateLimitError) {
    headers['Retry-After'] = '60';

    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: 'denied',
      denial: 'RATE_LIMITED',
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: 429,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      { code: 'RATE_LIMITED', message: 'Too many requests' },
      { status: 429, headers },
    );
  }

  if (err instanceof AccountRestrictedError) {
    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: 'denied',
      denial: 'ACCOUNT_RESTRICTED',
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: 403,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      { code: 'ACCOUNT_RESTRICTED', message: err.message },
      { status: 403, headers },
    );
  }

  if (err instanceof ByokError) {
    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: 'denied',
      denial: err.code,
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: err.status,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      { code: err.code, message: err.message },
      { status: err.status, headers },
    );
  }

  if (err instanceof AppError) {
    if (err.code === 'METERING_UNAVAILABLE' || err.code === 'AUTH_UNAVAILABLE') {
      headers['Retry-After'] = '10';
    } else if (err.code === 'CAPACITY_BUSY') {
      headers['Retry-After'] = '30';
    }

    emitMeteredRequestSummary({
      traceId,
      route,
      quotaMode: config.mode,
      byok: isByok,
      userId: identity?.userId,
      deviceId: identity?.deviceId,
      chargeSource: lease?.chargeSource,
      outcome: refunded ? 'refunded' : 'denied',
      denial: err.code,
      reserveMs,
      settleMs: 0,
      totalMs,
      httpStatus: err.status,
      stages: timer.snapshot(),
      ttfbMs: totalMs,
    });

    return NextResponse.json(
      { code: err.code, message: publicErrorMessage(err) },
      { status: err.status, headers },
    );
  }

  // Unknown internal error
  logger.error({ err, traceId, route }, 'unexpected_metered_route_failure');

  emitMeteredRequestSummary({
    traceId,
    route,
    quotaMode: config.mode,
    byok: isByok,
    userId: identity?.userId,
    deviceId: identity?.deviceId,
    chargeSource: lease?.chargeSource,
    outcome: refunded ? 'refunded' : 'denied',
    denial: 'INTERNAL',
    reserveMs,
    settleMs: 0,
    totalMs,
    httpStatus: 500,
    stages: timer.snapshot(),
    ttfbMs: totalMs,
  });

  return NextResponse.json(
    { code: 'INTERNAL', message: 'Internal server error' },
    { status: 500, headers },
  );
}
