import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { QuotaDeniedError, AppError } from '@/lib/errors';
import * as chatAnswerModule from '@/services/chat/answer';
import * as identityModule from '@/services/auth/identity';
import * as platformModule from '@/services/metering/platform';
import * as configModule from '@/services/metering/config';
import * as reserveModule from '@/services/metering/reserve';
import * as rateLimitModule from '@/services/rate-limit';
import * as userRateLimitModule from '@/services/metering/rate-limit-user';
import * as deviceRateLimitModule from '@/services/abuse/rate-limit-device';
import * as turnstileModule from '@/services/abuse/turnstile';
import * as summaryModule from '@/services/metering/summary';
import { DEFAULT_PERF_FLAGS } from '@/services/perf/flags';
import { getDb } from '@/services/db/client';
import { QueryLease } from '@/services/metering/lease';
import type { RetrievalResult } from '@/services/retrieval/types';

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
vi.mock('@/services/metering/rate-limit-user');
vi.mock('@/services/abuse/rate-limit-device');
vi.mock('@/services/abuse/turnstile');
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

describe('POST /api/ask (WP-09)', () => {
  const fakeRetrieval = {
    chunks: [],
    citations: [],
    debug: {
      totalMs: 50,
      embedding: { ms: 5 },
      vector: { ms: 10, count: 5, error: false },
      fts: { ms: 10, count: 5, error: false },
      rrf: { ms: 5, count: 5 },
      mmr: { ms: 5, count: 5 },
      coverage: { relaxed: false },
    },
  };

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
  };

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
      userId: 'user_123',
      emailVerified: true,
      deviceId: 'dev_test_123',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_123',
      ipHashForRateLimit: 'ip_hash_123',
      isSuspended: false,
    });

    vi.mocked(rateLimitModule.consumeAskRateLimit).mockResolvedValue(undefined);
    vi.mocked(userRateLimitModule.consumeUserRateLimit).mockResolvedValue(undefined);
    vi.mocked(deviceRateLimitModule.consumeDeviceRateLimit).mockResolvedValue(undefined);
    vi.mocked(turnstileModule.isTrafficRiskFlagged).mockReturnValue(false);
    vi.mocked(turnstileModule.verifyTurnstileToken).mockResolvedValue({ success: true });
    vi.mocked(platformModule.assertPlatformAcceptsRequest).mockImplementation(() => {});
  });

  describe('Denial before stream exists (JSON response)', () => {
    it('returns 402 JSON when quota is exhausted; never opens stream or calls Q&A pipeline', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('QUOTA_EXHAUSTED', 'You have used all included queries for today.', {
          status: 402,
          quota: {
            remaining: 0,
            freeRemaining: 0,
            creditBalance: 0,
            subRemaining: 0,
            resetAt: '2026-10-22T00:00:00.000Z',
          },
          actions: ['buy_credits', 'subscribe', 'byok'],
        }),
      );

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'how is battery life?' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(402);
      expect(res.headers.get('content-type')).toContain('application/json');
      const data = await res.json();
      expect(data.code).toBe('QUOTA_EXHAUSTED');
      expect(data.actions).toEqual(['buy_credits', 'subscribe', 'byok']);
      expect(chatAnswerModule.runPhoneQna).not.toHaveBeenCalled();
    });

    it('returns 429 JSON on TOO_MANY_INFLIGHT with Retry-After: 2', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('TOO_MANY_INFLIGHT', 'Another query is already running.', {
          status: 429,
          quota: { remaining: 1 },
          actions: [],
        }),
      );

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'how is the camera?' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('2');
      expect(chatAnswerModule.runPhoneQna).not.toHaveBeenCalled();
    });

    it('returns 403 JSON when account is restricted', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: 'banned_user',
        emailVerified: true,
        deviceId: 'dev_banned',
        deviceCookieIsNew: false,
        ipKey: 'ip_banned',
        ipHashForRateLimit: 'ip_banned_hash',
        isSuspended: true,
      });

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'camera?' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe('ACCOUNT_RESTRICTED');
      expect(chatAnswerModule.runPhoneQna).not.toHaveBeenCalled();
    });

    it('returns 404 JSON and refunds lease when phone is not found', async () => {
      mockDbSelectChain.limit.mockResolvedValueOnce([]); // no phone found

      const mockLease = new QueryLease({
        id: '00000000-0000-4000-8000-000000000099',
        chargeSource: 'daily_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/ask',
        deviceId: 'dev_test_123',
        userId: 'user_123',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const refundSpy = vi.spyOn(mockLease, 'refund').mockResolvedValue('refunded');

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'non-existent-phone', query: 'camera?' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(404);
      expect(refundSpy).toHaveBeenCalledWith('not_found');
      expect(chatAnswerModule.runPhoneQna).not.toHaveBeenCalled();
    });
  });

  describe('Streaming Execution & Stream-Aware Settlement', () => {
    it('happy path: delivers NDJSON stream, commits lease, and emits quota in done chunk', async () => {
      const mockLease = new QueryLease({
        id: '00000000-0000-4000-8000-000000000099',
        chargeSource: 'daily_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/ask',
        deviceId: 'dev_test_123',
        userId: 'user_123',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const commitSpy = vi.spyOn(mockLease, 'commit').mockResolvedValue('committed');

      vi.mocked(chatAnswerModule.runPhoneQna).mockResolvedValue({
        text: 'The battery lasts about 1.5 days on a single charge.',
        citations: [],
        retrieval: fakeRetrieval as unknown as RetrievalResult,
        usage: { tokensIn: 200, tokensOut: 30 },
        model: 'gemini-2.5-flash',
        generationAccounting: {
          providerCalls: 1,
          cacheHits: 0,
          reportedUsageCalls: 1,
          tokensIn: 200,
          tokensOut: 30,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'how long does battery last?' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/x-ndjson');

      const chunks = await readAllNdjsonChunks(res);
      expect(chunks.some((c) => c.type === 'meta')).toBe(true);
      expect(chunks.some((c) => c.type === 'delta')).toBe(true);

      const doneChunk = chunks.find((c) => c.type === 'done');
      expect(doneChunk).toBeDefined();
      expect(doneChunk?.quota).toEqual(expect.objectContaining({ outcome: 'committed' }));

      expect(commitSpy).toHaveBeenCalled();
      expect(chatAnswerModule.persistChatQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_123',
          leaseId: '00000000-0000-4000-8000-000000000099',
        }),
      );
      expect(summaryModule.emitMeteredRequestSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'committed',
          httpStatus: 200,
        }),
      );
    });

    it('no-context short circuit: settles lease with noCharge(no_context), quota restored in done chunk', async () => {
      const mockLease = new QueryLease({
        id: '00000000-0000-4000-8000-000000000099',
        chargeSource: 'daily_free',
        quota: {
          remaining: 0,
          freeRemaining: 0,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/ask',
        deviceId: 'dev_test_123',
        userId: 'user_123',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const noChargeSpy = vi.spyOn(mockLease, 'noCharge').mockResolvedValue('no_charge');

      vi.mocked(chatAnswerModule.runPhoneQna).mockResolvedValue({
        text: 'No indexed reviews exist yet for this phone.',
        citations: [],
        retrieval: fakeRetrieval as unknown as RetrievalResult,
        usage: { tokensIn: 0, tokensOut: 0 },
        model: chatAnswerModule.NO_CONTEXT_MODEL,
        generationAccounting: {
          providerCalls: 0,
          cacheHits: 0,
          reportedUsageCalls: 0,
          tokensIn: 0,
          tokensOut: 0,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'camera specs?' }),
      });

      const res = await POST(request);
      const chunks = await readAllNdjsonChunks(res);
      const doneChunk = chunks.find((c) => c.type === 'done');

      expect(doneChunk?.quota).toEqual(
        expect.objectContaining({
          outcome: 'no_charge',
          remaining: 1, // unit restored
        }),
      );
      expect(noChargeSpy).toHaveBeenCalledWith('no_context');
    });

    it('error mid-stream: refunds lease before writing error chunk with quota object', async () => {
      const mockLease = new QueryLease({
        id: '00000000-0000-4000-8000-000000000099',
        chargeSource: 'daily_free',
        quota: {
          remaining: 0,
          freeRemaining: 0,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/ask',
        deviceId: 'dev_test_123',
        userId: 'user_123',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const refundSpy = vi.spyOn(mockLease, 'refund').mockResolvedValue('refunded');

      vi.mocked(chatAnswerModule.runPhoneQna).mockRejectedValue(
        new AppError('LLM_ERROR', 'Model service timed out', { status: 504 }),
      );

      const request = new NextRequest('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneSlug: 'pixel-9-pro', query: 'battery?' }),
      });

      const res = await POST(request);
      const chunks = await readAllNdjsonChunks(res);
      const errorChunk = chunks.find((c) => c.type === 'error');

      expect(errorChunk).toBeDefined();
      expect(errorChunk?.code).toBe('LLM_ERROR');
      expect(errorChunk?.quota).toEqual(
        expect.objectContaining({
          outcome: 'refund',
          remaining: 1, // unit restored
        }),
      );
      expect(refundSpy).toHaveBeenCalledWith('LLM_ERROR');
      expect(summaryModule.emitMeteredRequestSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'refunded',
        }),
      );
    });
  });
});
