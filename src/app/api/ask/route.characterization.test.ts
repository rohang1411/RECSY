import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { QuotaDeniedError, AppError, RateLimitError } from '@/lib/errors';
import type * as chatAnswerModule from '@/services/chat/answer';
import * as identityModule from '@/services/auth/identity';
import * as platformModule from '@/services/metering/platform';
import * as configModule from '@/services/metering/config';
import * as reserveModule from '@/services/metering/reserve';
import * as rateLimitModule from '@/services/rate-limit';
import * as turnstileModule from '@/services/abuse/turnstile';
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
      RETRIEVAL_LLM_RERANK: false,
    },
  };
});
vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/services/chat/answer', async (importOriginal) => {
  const actual = await importOriginal<typeof chatAnswerModule>();
  return {
    ...actual,
    runPhoneQna: vi.fn(),
    persistChatQuery: vi.fn(),
    chunkTextForStream: actual.chunkTextForStream,
  };
});
vi.mock('@/services/chat/answer-stream');
vi.mock('@/services/retrieval/factory', () => ({
  createHybridRetriever: vi.fn().mockReturnValue({}),
}));
vi.mock('@/services/llm', () => ({
  getLlm: vi.fn().mockReturnValue({}),
}));
vi.mock('@/services/auth/identity');
vi.mock('@/services/metering/platform');
vi.mock('@/services/metering/config');
vi.mock('@/services/metering/reserve');
vi.mock('@/services/rate-limit');
vi.mock('@/services/abuse/turnstile');
vi.mock('@/services/metering/replay');
vi.mock('@/services/metering/summary', async (importOriginal) => {
  const actual = await importOriginal<typeof summaryModule>();
  return {
    ...actual,
    emitMeteredRequestSummary: vi.fn(),
  };
});

async function readAllNdjsonChunks(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('POST /api/ask Characterisation Suite (WP-09)', () => {
  const fakePhone = {
    id: '00000000-0000-4000-8000-000000000010',
    status: 'active',
    brand: 'Google',
    model: 'Pixel 9 Pro',
    lastIngestAt: new Date(),
    nextIngestAt: new Date(),
  };

  const mockDbSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([fakePhone]),
  };

  const mockDb = {
    select: vi.fn().mockReturnValue(mockDbSelectChain),
    execute: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  };

  let mockLease: QueryLease;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    mockDbSelectChain.limit.mockResolvedValue([fakePhone]);

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
      route: 'POST /api/ask',
      deviceId: 'dev_123',
      userId: 'user_123',
      traceId: 'trace_test_123',
      db: mockDb as unknown as ReturnType<typeof getDb>,
    });
    vi.spyOn(mockLease, 'commit').mockResolvedValue('committed');
    vi.spyOn(mockLease, 'noCharge').mockResolvedValue('no_charge');
    vi.spyOn(mockLease, 'refund').mockResolvedValue('refunded');

    vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
  });

  it('rejects bad origin with 403', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://malicious-site.com',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('BAD_ORIGIN');
  });

  it('rejects validation failure on missing fields with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: '' }),
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

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
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

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe('RATE_LIMITED');
  });

  it('returns 428 when CAPTCHA is required', async () => {
    mockDb.execute.mockResolvedValueOnce([{ queries_used: 35 }]);
    vi.mocked(turnstileModule.isTrafficRiskFlagged).mockReturnValueOnce(true);

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(428);
    const json = await res.json();
    expect(json.code).toBe('CAPTCHA_REQUIRED');
  });

  it('returns 503 when platform is paused', async () => {
    vi.mocked(platformModule.assertPlatformAcceptsRequest).mockImplementationOnce(() => {
      throw new AppError('PLATFORM_PAUSED', 'Maintenance in progress');
    });

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('PLATFORM_PAUSED');
  });

  it('returns 404 without creating lease when phone is not found', async () => {
    mockDbSelectChain.limit.mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'non-existent-phone', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe('NOT_FOUND');
    expect(reserveModule.reserveQuery).not.toHaveBeenCalled();
  });

  it('maps QuotaDeniedError with correct status and Retry-After headers', async () => {
    const table = [
      { code: 'QUOTA_EXHAUSTED' as const, status: 402, retryAfter: undefined },
      { code: 'SIGNIN_REQUIRED' as const, status: 402, retryAfter: undefined },
      { code: 'TOO_MANY_INFLIGHT' as const, status: 429, retryAfter: '2' },
      { code: 'CAPACITY_BUSY' as const, status: 503, retryAfter: '30' },
    ];

    for (const row of table) {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValueOnce(
        new QuotaDeniedError(row.code, 'quota denied'),
      );

      const req = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(row.status);
      if (row.retryAfter) {
        expect(res.headers.get('Retry-After')).toBe(row.retryAfter);
      }
      const json = await res.json();
      expect(json.code).toBe(row.code);
    }
  });

  it('replays committed chat query on DUPLICATE_REQUEST', async () => {
    vi.mocked(reserveModule.reserveQuery).mockRejectedValueOnce(
      new QuotaDeniedError('DUPLICATE_REQUEST', 'Duplicate request', {
        context: { leaseId: 'lease-replay-1' },
      }),
    );

    vi.mocked(replayModule.findReplayQuery).mockResolvedValueOnce({
      queryId: 'query_replay_123',
      phoneId: fakePhone.id,
      query: 'What is the battery life?',
      answer: 'Replayed answer text',
      citations: [],
      retrievedChunkIds: ['c1'],
      latencyMs: 120,
      quota: {
        remaining: 1,
        freeRemaining: 1,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: '2026-10-25T00:00:00.000Z',
      },
    });

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const chunks = await readAllNdjsonChunks(res);
    expect(chunks.some((c) => c.type === 'delta' && c.text === 'Replayed answer text')).toBe(true);
    expect(chunks.some((c) => c.type === 'done' && c.replayed === true)).toBe(true);
  });
});
