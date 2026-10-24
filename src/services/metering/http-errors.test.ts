import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z, type ZodError } from 'zod';

import {
  AccountRestrictedError,
  AppError,
  ByokError,
  QuotaDeniedError,
  RateLimitError,
} from '@/lib/errors';
import { createStageTimer } from '@/lib/stage-timer';
import type { RequestIdentity } from '@/services/auth/identity';
import { QueryLease } from '@/services/metering/lease';
import type { MeteringConfig } from '@/services/metering/types';
import * as summaryModule from '@/services/metering/summary';
import { meteredErrorResponse, type MeteredErrorContext } from './http-errors';

vi.mock('@/services/metering/summary');

describe('meteredErrorResponse', () => {
  const defaultConfig: MeteringConfig = {
    mode: 'enforce',
    freeDailyQueries: 5,
    anonDailyQueries: 2,
    anonIpDailyCap: 20,
    deviceAccountCap: 3,
    byokDailyCap: 100,
    clarifyFreeCap: 2,
    maxInflightFree: 1,
    maxInflightPro: 3,
    leaseTtlSeconds: 75,
    dbTimeoutMs: 5000,
    globalDailyPlatformCap: 1000,
  };

  const identity: RequestIdentity = {
    userId: 'usr_123',
    deviceId: 'dev_123',
    ipKey: '198.51.100.0/24',
    ipHashForRateLimit: 'hash_123',
    isSuspended: false,
    emailVerified: false,
    deviceCookieIsNew: false,
  };

  function createTestContext(overrides?: Partial<MeteredErrorContext>): MeteredErrorContext {
    return {
      traceId: 'trace-1234',
      route: 'POST /api/ask',
      request: new NextRequest('http://localhost:3000/api/ask', {
        headers: { host: 'localhost:3000' },
      }),
      timer: createStageTimer(),
      t0: performance.now(),
      lease: null,
      identity,
      isByok: false,
      config: defaultConfig,
      reserveMs: 15,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps ZodError to 400 with VALIDATION code', async () => {
    const schema = z.object({ query: z.string().min(3) });
    let zodError!: ZodError;
    try {
      schema.parse({ query: 'a' });
    } catch (e) {
      zodError = e as ZodError;
    }

    const ctx = createTestContext({ route: 'POST /api/ask' });
    const res = await meteredErrorResponse(zodError, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(res.headers.get('X-Trace-Id')).toBe('trace-1234');
    expect(body.code).toBe('VALIDATION');
    expect(summaryModule.emitMeteredRequestSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'denied',
        denial: 'VALIDATION',
        httpStatus: 400,
      }),
    );
  });

  it('maps QuotaDeniedError with status and Retry-After for TOO_MANY_INFLIGHT', async () => {
    const err = new QuotaDeniedError('TOO_MANY_INFLIGHT', 'Too many requests');
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(body.code).toBe('TOO_MANY_INFLIGHT');
  });

  it('maps QuotaDeniedError with Retry-After 30 for CAPACITY_BUSY', async () => {
    const err = new QuotaDeniedError('CAPACITY_BUSY', 'Server capacity busy');
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('maps RateLimitError to 429 with Retry-After: 60', async () => {
    const err = new RateLimitError({ reason: 'IP limit reached' });
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('maps AccountRestrictedError to 403', async () => {
    const err = new AccountRestrictedError();
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('maps ByokError with its status code', async () => {
    const err = new ByokError('BYOK_REJECTED', 'Invalid API key', { status: 401 });
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('BYOK_REJECTED');
  });

  it('maps generic AppError with public error message', async () => {
    const err = new AppError('NOT_FOUND', 'Entity not found', { status: 404 });
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('maps unknown Error to 500 INTERNAL', async () => {
    const err = new Error('Database disk corrupted');
    const ctx = createTestContext();

    const res = await meteredErrorResponse(err, ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('Internal server error');
  });

  it('refunds unsettled lease on error', async () => {
    const lease = new QueryLease({
      id: 'lease-123',
      chargeSource: 'daily_free',
      quota: {
        remaining: 1,
        freeRemaining: 1,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: '2026-10-25T00:00:00.000Z',
      },
      requestId: 'req-1',
      route: 'POST /api/ask',
      deviceId: 'dev_123',
      userId: 'usr_123',
      traceId: 'trace-1',
    });

    const refundSpy = vi.spyOn(lease, 'refund').mockResolvedValue('refunded');
    const ctx = createTestContext({ lease });

    await meteredErrorResponse(new AppError('INTERNAL', 'Failed upstream', { status: 502 }), ctx);

    expect(refundSpy).toHaveBeenCalledWith('INTERNAL');
  });

  it('does not refund lease if already settled', async () => {
    const lease = new QueryLease({
      id: 'lease-123',
      chargeSource: 'daily_free',
      quota: {
        remaining: 1,
        freeRemaining: 1,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: '2026-10-25T00:00:00.000Z',
      },
      requestId: 'req-1',
      route: 'POST /api/ask',
      deviceId: 'dev_123',
      userId: 'usr_123',
      traceId: 'trace-1',
    });

    vi.spyOn(lease, 'settled', 'get').mockReturnValue(true);
    const refundSpy = vi.spyOn(lease, 'refund');
    const ctx = createTestContext({ lease });

    await meteredErrorResponse(new Error('fail'), ctx);

    expect(refundSpy).not.toHaveBeenCalled();
  });
});
