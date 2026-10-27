import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { QuotaDeniedError, RateLimitError } from '@/lib/errors';
import * as identityModule from '@/services/auth/identity';
import * as platformModule from '@/services/metering/platform';
import * as configModule from '@/services/metering/config';
import * as reserveModule from '@/services/metering/reserve';
import * as rateLimitModule from '@/services/rate-limit';
import * as turnstileModule from '@/services/abuse/turnstile';
import * as sessionModule from '@/services/recommender/session';
import type { RecommendationSessionRow } from '@/services/recommender/session';
import type * as summaryModule from '@/services/metering/summary';
import * as replayModule from '@/services/metering/replay';
import { DEFAULT_PERF_FLAGS } from '@/services/perf/flags';
import { getDb } from '@/services/db/client';
import { QueryLease } from '@/services/metering/lease';

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    env: {
      ...((actual as { env?: Record<string, unknown> }).env ?? {}),
      TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
    },
  };
});
vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/services/recommender/run-recommendation');
vi.mock('@/services/auth/identity');
vi.mock('@/services/metering/platform');
vi.mock('@/services/metering/config');
vi.mock('@/services/metering/reserve');
vi.mock('@/services/rate-limit');
vi.mock('@/services/abuse/turnstile');
vi.mock('@/services/recommender/session');
vi.mock('@/services/metering/replay');
vi.mock('@/services/metering/summary', async (importOriginal) => {
  const actual = await importOriginal<typeof summaryModule>();
  return {
    ...actual,
    emitMeteredRequestSummary: vi.fn(),
  };
});

describe('POST /api/recommend Characterisation Suite (WP-09)', () => {
  const fakeSession = { id: '00000000-0000-4000-8000-000000000001', sessionCookie: 'test-cookie' };
  const mockDbTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue([{ recsy_settle_lease: 'committed' }]),
  };
  const mockDb = {
    transaction: vi.fn().mockImplementation(async (cb) => cb(mockDbTx)),
    execute: vi.fn().mockResolvedValue([]),
  };

  let mockLease: QueryLease;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);

    vi.mocked(configModule.getMeteringConfig).mockReturnValue({
      mode: 'enforce',
      freeDailyQueries: 2,
      anonDailyQueries: 2,
      anonIpDailyCap: 30,
      deviceAccountCap: 3,
      byokDailyCap: 100,
      clarifyFreeCap: 10,
      maxInflightFree: 1,
      maxInflightPro: 2,
      leaseTtlSeconds: 75,
      dbTimeoutMs: 5000,
      globalDailyPlatformCap: 5000,
    });

    vi.mocked(platformModule.getPlatformState).mockResolvedValue({
      killSwitch: { enabled: false },
      globalDailyCap: 5000,
      usedToday: 10,
      capacity: 'ok',
      shedFreeFor: () => false,
      perf: DEFAULT_PERF_FLAGS,
    });

    vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
      userId: null,
      emailVerified: false,
      deviceId: 'dev_test_123',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_123',
      ipHashForRateLimit: 'ip_hash_123',
      isSuspended: false,
    });

    mockLease = new QueryLease({
      id: '00000000-0000-4000-8000-000000000099',
      chargeSource: 'daily_free',
      quota: {
        remaining: 2,
        freeRemaining: 2,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: '2026-10-25T00:00:00.000Z',
      },
      requestId: 'req_123',
      route: 'POST /api/recommend',
      deviceId: 'dev_123',
      userId: 'user_123',
      traceId: 'trace_test_123',
      db: mockDb as unknown as ReturnType<typeof getDb>,
    });
    vi.spyOn(mockLease, 'commit').mockResolvedValue('committed');
    vi.spyOn(mockLease, 'noCharge').mockResolvedValue('no_charge');
    vi.spyOn(mockLease, 'refund').mockResolvedValue('refunded');

    vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
    vi.mocked(sessionModule.findSessionByCookie).mockResolvedValue(
      fakeSession as unknown as RecommendationSessionRow,
    );
  });

  it('rejects bad origin with 403', async () => {
    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://evil.com',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'I need a phone with good camera' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('BAD_ORIGIN');
  });

  it('rejects validation failure with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION');
  });

  it('rejects suspended accounts with 403', async () => {
    vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValueOnce({
      userId: 'usr_suspended',
      emailVerified: true,
      deviceId: 'dev_123',
      deviceCookieIsNew: false,
      ipKey: 'ip_123',
      ipHashForRateLimit: 'ip_123',
      isSuspended: true,
    });

    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'budget phone' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('ACCOUNT_RESTRICTED');
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimitModule.consumeAdmissionLimits).mockRejectedValueOnce(
      new RateLimitError({ subject: 'ip' }),
    );

    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'budget phone' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe('RATE_LIMITED');
  });

  it('returns 428 when CAPTCHA is required', async () => {
    mockDb.execute.mockResolvedValueOnce([{ queries_used: 35 }]);
    vi.mocked(turnstileModule.isTrafficRiskFlagged).mockReturnValueOnce(true);

    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'budget phone' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(428);
    const json = await res.json();
    expect(json.code).toBe('CAPTCHA_REQUIRED');
  });

  it('replays committed recommendation on DUPLICATE_REQUEST', async () => {
    vi.mocked(reserveModule.reserveQuery).mockRejectedValueOnce(
      new QuotaDeniedError('DUPLICATE_REQUEST', 'Duplicate request', {
        context: { leaseId: 'lease-replay-abc' },
      }),
    );

    vi.mocked(replayModule.findReplayTurn).mockResolvedValueOnce({
      turnId: 'turn_replay_123',
      sessionId: fakeSession.id,
      turnIndex: 0,
      userMessage: 'best camera phone',
      intent: 'recommend',
      extractedRequirements: { camera: true },
      candidatePhoneIds: [],
      picks: [],
      clarifyingQuestion: null,
      latencyMs: 150,
      quota: {
        remaining: 1,
        freeRemaining: 1,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: '2026-10-25T00:00:00.000Z',
      },
    });

    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: 'best camera phone' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.replayed).toBe(true);
    expect(json.message).toBe('best camera phone');
  });
});
