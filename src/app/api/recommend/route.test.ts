import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, parseRequestId } from './route';
import { QuotaDeniedError, AppError } from '@/lib/errors';
import * as recommenderPipeline from '@/services/recommender/run-recommendation';
import * as identityModule from '@/services/auth/identity';
import * as platformModule from '@/services/metering/platform';
import * as configModule from '@/services/metering/config';
import * as reserveModule from '@/services/metering/reserve';
import * as rateLimitModule from '@/services/rate-limit';
import * as userRateLimitModule from '@/services/metering/rate-limit-user';
import * as deviceRateLimitModule from '@/services/abuse/rate-limit-device';
import * as turnstileModule from '@/services/abuse/turnstile';
import * as sessionModule from '@/services/recommender/session';
import * as sessionServiceModule from '@/services/recommender/sessions/service';
import * as summaryModule from '@/services/metering/summary';
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
vi.mock('@/services/metering/rate-limit-user');
vi.mock('@/services/abuse/rate-limit-device');
vi.mock('@/services/abuse/turnstile');
vi.mock('@/services/recommender/session');
vi.mock('@/services/recommender/sessions/service');
vi.mock('@/services/metering/replay');
vi.mock('@/services/metering/summary', async (importOriginal) => {
  const actual = await importOriginal<typeof summaryModule>();
  return {
    ...actual,
    emitMeteredRequestSummary: vi.fn(),
  };
});

describe('POST /api/recommend (WP-08)', () => {
  const fakeSession = { id: '00000000-0000-4000-8000-000000000001', sessionCookie: 'test-cookie' };
  const mockDbTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue([{ recsy_settle_lease: 'committed' }]),
  };
  const mockDb = {
    transaction: vi.fn().mockImplementation(async (cb) => cb(mockDbTx)),
    execute: vi.fn().mockResolvedValue([]),
  };

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

    vi.mocked(sessionModule.findSessionByCookie).mockResolvedValue(
      fakeSession as unknown as sessionModule.RecommendationSessionRow,
    );
    vi.mocked(sessionModule.insertRecommendationSession).mockResolvedValue(
      fakeSession as unknown as sessionModule.RecommendationSessionRow,
    );
    vi.mocked(sessionModule.nextTurnIndex).mockResolvedValue(0);

    vi.mocked(sessionServiceModule.settleTurn).mockResolvedValue({
      turnIndex: 0,
      session: {
        title: 'New Recommendation',
        titleSource: 'default',
        turnCount: 1,
      },
    });
    vi.mocked(sessionServiceModule.resolveOrCreateSession).mockResolvedValue({
      session: {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'New Recommendation',
        titleSource: 'default',
        turnCount: 0,
        status: 'active',
      },
      created: true,
    });

    vi.mocked(rateLimitModule.consumeRecommendRateLimit).mockResolvedValue(undefined);
    vi.mocked(rateLimitModule.consumeAdmissionLimits).mockResolvedValue(undefined);
    vi.mocked(userRateLimitModule.consumeUserRateLimit).mockResolvedValue(undefined);
    vi.mocked(deviceRateLimitModule.consumeDeviceRateLimit).mockResolvedValue(undefined);
    vi.mocked(turnstileModule.isTrafficRiskFlagged).mockReturnValue(false);
    vi.mocked(turnstileModule.verifyTurnstileToken).mockResolvedValue({ success: true });
    vi.mocked(platformModule.assertPlatformAcceptsRequest).mockImplementation(() => {});
  });

  describe('parseRequestId', () => {
    it('returns null when header is absent or empty', () => {
      expect(parseRequestId(null)).toBeNull();
      expect(parseRequestId(undefined)).toBeNull();
      expect(parseRequestId('')).toBeNull();
      expect(parseRequestId('   ')).toBeNull();
    });

    it('returns parsed valid UUID', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(parseRequestId(validUuid)).toBe(validUuid);
    });

    it('throws VALIDATION 400 when invalid UUID is passed', () => {
      expect(() => parseRequestId('not-a-uuid')).toThrowError(AppError);
      try {
        parseRequestId('not-a-uuid');
      } catch (err: unknown) {
        const error = err as AppError;
        expect(error.code).toBe('VALIDATION');
        expect(error.status).toBe(400);
      }
    });
  });

  describe('Contract Matrix: Quota Modes & Outcomes', () => {
    it('QUOTA_MODE=off bypasses reservations and settles noop lease', async () => {
      vi.mocked(configModule.getMeteringConfig).mockReturnValue({
        ...configModule.getMeteringConfig(),
        mode: 'off',
      });

      const noopLease = new QueryLease({
        id: 'off',
        chargeSource: 'anon_free',
        quota: {
          remaining: 999,
          freeRemaining: 999,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
        isNoop: true,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(noopLease);
      const commitSpy = vi.spyOn(noopLease, 'commit');

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [
          {
            phoneId: 'p1',
            slug: 's1',
            brand: 'B',
            model: 'M',
            score: 95,
          } as unknown as recommenderPipeline.RecommendApiPick,
        ],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: ['camera'],
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': '00000000-0000-4000-8000-000000000002',
        },
        body: JSON.stringify({ message: 'looking for good camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('results');
      expect(data.picks).toHaveLength(1);
      expect(data.quota.remaining).toBe(999);
      expect(commitSpy).toHaveBeenCalled();
    });

    it('enforce mode: successful recommendation commits lease and inserts turn with leaseId', async () => {
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
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: 'user_1',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const commitSpy = vi.spyOn(mockLease, 'commit').mockResolvedValue('committed');

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [
          {
            phoneId: 'p1',
            slug: 's1',
            brand: 'B',
            model: 'M',
            score: 90,
          } as unknown as recommenderPipeline.RecommendApiPick,
        ],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: ['battery'],
        usage: { tokensIn: 150, tokensOut: 50 },
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': '00000000-0000-4000-8000-000000000002',
        },
        body: JSON.stringify({ message: 'great battery' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('results');
      expect(data.quota.outcome).toBe('committed');
      expect(commitSpy).toHaveBeenCalled();
      expect(summaryModule.emitMeteredRequestSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'committed',
          httpStatus: 200,
        }),
      );
    });

    it('enforce mode: clarify outcome triggers noCharge(clarify)', async () => {
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
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: 'user_1',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const noChargeSpy = vi.spyOn(mockLease, 'noCharge').mockResolvedValue('no_charge');

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'clarify',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        clarifyingQuestion: 'What is your budget?',
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'need a phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('clarify');
      expect(data.clarifyingQuestion).toBe('What is your budget?');
      expect(noChargeSpy).toHaveBeenCalledWith('clarify', expect.anything());
      expect(data.quota.outcome).toBe('no_charge');
      expect(data.quota.remaining).toBe(1); // restored
    });

    it('enforce mode: zero picks triggers noCharge(no_results)', async () => {
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
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: 'user_1',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const noChargeSpy = vi.spyOn(mockLease, 'noCharge').mockResolvedValue('no_charge');

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: [],
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'impossible budget $1 phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.kind).toBe('results');
      expect(data.picks).toHaveLength(0);
      expect(noChargeSpy).toHaveBeenCalledWith('no_results', expect.anything());
      expect(data.quota.outcome).toBe('no_charge');
    });

    it('enforce mode: pipeline error refunds lease', async () => {
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
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: 'user_1',
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(mockLease);
      const refundSpy = vi.spyOn(mockLease, 'refund').mockResolvedValue('refunded');

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockRejectedValue(
        new AppError('LLM_ERROR', 'Model service unavailable', { status: 502 }),
      );

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(502);
      expect(refundSpy).toHaveBeenCalledWith('LLM_ERROR');
      expect(summaryModule.emitMeteredRequestSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'refunded',
          httpStatus: 502,
        }),
      );
    });
  });

  describe('Denials & Zero Model Calls (Pipeline Spy)', () => {
    it('denial when quota is exhausted: returns 402 with structured actions, zero model calls', async () => {
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
          actions: ['sign_in', 'buy_credits', 'subscribe', 'byok'],
        }),
      );

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(402);
      const data = await res.json();
      expect(data.code).toBe('QUOTA_EXHAUSTED');
      expect(data.actions).toEqual(['sign_in', 'buy_credits', 'subscribe', 'byok']);
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('denial on TOO_MANY_INFLIGHT: returns 429 with Retry-After: 2', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('TOO_MANY_INFLIGHT', 'Another query is already running.', {
          status: 429,
          quota: { remaining: 1 },
          actions: [],
        }),
      );

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('2');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('denial on DUPLICATE_REQUEST: returns 409 with Retry-After: 2', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('DUPLICATE_REQUEST', 'Duplicate request in flight.', {
          status: 409,
          quota: { remaining: 1 },
          actions: [],
        }),
      );

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(409);
      expect(res.headers.get('retry-after')).toBe('2');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('replay on committed DUPLICATE_REQUEST: returns stored result with no new model execution (WP-18)', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('DUPLICATE_REQUEST', 'Duplicate request in flight.', {
          status: 409,
          context: { leaseId: 'lease-replay-abc' },
          quota: { remaining: 1 },
          actions: [],
        }),
      );

      vi.mocked(replayModule.findReplayTurn).mockResolvedValue({
        turnId: 'turn-replay-1',
        sessionId: 'sess-replay-1',
        turnIndex: 0,
        userMessage: 'best battery phone under 500',
        intent: 'recommend',
        extractedRequirements: { battery: 5000 },
        candidatePhoneIds: ['phone-1'],
        picks: [{ id: 'phone-1', model: 'Galaxy A55' }],
        clarifyingQuestion: null,
        latencyMs: 310,
        quota: {
          outcome: 'committed',
          chargeSource: 'daily_free',
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: '2026-10-22T00:00:00.000Z',
        },
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'a0000000-0000-4000-8000-000000000001',
        },
        body: JSON.stringify({ message: 'best battery phone under 500' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.replayed).toBe(true);
      expect(body.kind).toBe('results');
      expect(body.message).toBe('best battery phone under 500');
      expect(body.picks).toHaveLength(1);
      expect(body.relaxed).toEqual([]);
      expect(body.refined).toBe(false);
      expect(body.quota.outcome).toBe('committed');
      // Zero model pipeline executions on replay
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('replay on committed clarify turn: returns kind: clarify with clarifyingQuestion', async () => {
      vi.mocked(reserveModule.reserveQuery).mockRejectedValue(
        new QuotaDeniedError('DUPLICATE_REQUEST', 'Duplicate request in flight.', {
          status: 409,
          context: { leaseId: 'lease-replay-clarify' },
          quota: { remaining: 1 },
          actions: [],
        }),
      );

      vi.mocked(replayModule.findReplayTurn).mockResolvedValue({
        turnId: 'turn-replay-2',
        sessionId: 'sess-replay-2',
        turnIndex: 0,
        userMessage: 'phone with good camera',
        intent: 'clarify',
        extractedRequirements: {},
        candidatePhoneIds: [],
        picks: null,
        clarifyingQuestion: 'What is your budget?',
        latencyMs: 250,
        quota: null,
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'a0000000-0000-4000-8000-000000000002',
        },
        body: JSON.stringify({ message: 'phone with good camera' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.replayed).toBe(true);
      expect(body.kind).toBe('clarify');
      expect(body.clarifyingQuestion).toBe('What is your budget?');
      expect(body.picks).toBeUndefined();
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('denial on platform pause (kill switch): returns 503 PLATFORM_PAUSED', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: true, message: 'Maintenance in progress' },
        globalDailyCap: 5000,
        usedToday: 10,
        capacity: 'paused',
        shedFreeFor: () => true,
        perf: DEFAULT_PERF_FLAGS,
      });

      vi.mocked(platformModule.assertPlatformAcceptsRequest).mockImplementation(() => {
        throw new AppError('PLATFORM_PAUSED', 'Maintenance in progress', { status: 503 });
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.code).toBe('PLATFORM_PAUSED');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('denial on account restriction: returns 403 ACCOUNT_RESTRICTED', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: 'banned_user',
        emailVerified: true,
        deviceId: 'dev_banned',
        deviceCookieIsNew: false,
        ipKey: 'ip_banned',
        ipHashForRateLimit: 'ip_banned_hash',
        isSuspended: true,
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe('ACCOUNT_RESTRICTED');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('risk-flagged anonymous traffic requires captcha (428 CAPTCHA_REQUIRED)', async () => {
      vi.mocked(turnstileModule.isTrafficRiskFlagged).mockReturnValue(true);

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(428);
      const data = await res.json();
      expect(data.code).toBe('CAPTCHA_REQUIRED');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('BYOK request bypasses platform pause and charges byok source', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: true, message: 'Paused for maintenance' },
        globalDailyCap: 5000,
        usedToday: 5000,
        capacity: 'paused',
        shedFreeFor: () => true,
        perf: DEFAULT_PERF_FLAGS,
      });

      const byokLease = new QueryLease({
        id: '00000000-0000-4000-8000-000000000099',
        chargeSource: 'byok',
        quota: {
          remaining: 99,
          freeRemaining: 0,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
        isNoop: false,
      });

      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(byokLease);
      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [
          {
            phoneId: 'p1',
            slug: 's1',
            brand: 'B',
            model: 'M',
            score: 90,
          } as unknown as recommenderPipeline.RecommendApiPick,
        ],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: ['camera'],
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-byok-provider': 'google',
          'x-byok-key': 'AIzaSyFakeKeyForTestValidLength39Chars!',
        },
        body: JSON.stringify({ message: 'camera phone' }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.quota.chargeSource).toBe('byok');
    });
  });

  describe('Session Mode Integration (Plan 27 WP-04)', () => {
    const validSessionId = '123e4567-e89b-12d3-a456-426614174000';

    it('executes in session mode when flag is on and sessionId is provided', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: false },
        globalDailyCap: 5000,
        usedToday: 10,
        capacity: 'ok',
        shedFreeFor: () => false,
        perf: { ...DEFAULT_PERF_FLAGS, recommend_sessions: 'on' },
      });

      const lease = new QueryLease({
        id: 'lease-test-1',
        chargeSource: 'anon_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000002',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
      });
      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(lease);

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [
          {
            phoneId: 'p1',
            slug: 's1',
            brand: 'B',
            model: 'M',
            score: 90,
          } as unknown as recommenderPipeline.RecommendApiPick,
        ],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: ['camera'],
      });

      vi.mocked(sessionServiceModule.resolveOrCreateSession).mockResolvedValue({
        session: {
          id: validSessionId,
          title: 'Camera phone',
          titleSource: 'heuristic',
          turnCount: 1,
          status: 'active',
        },
        created: false,
      });

      vi.mocked(sessionServiceModule.settleTurn).mockResolvedValue({
        turnIndex: 1,
        session: {
          title: 'Camera phone',
          titleSource: 'heuristic',
          turnCount: 2,
        },
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': '00000000-0000-4000-8000-000000000002',
        },
        body: JSON.stringify({ message: 'great battery phone', sessionId: validSessionId }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.sessionId).toBe(validSessionId);
      expect(data.turnIndex).toBe(1);
      expect(data.session.title).toBe('Camera phone');
      expect(data.session.turnCount).toBe(2);
      expect(data.session.created).toBe(false);
      expect(data.replayed).toBe(false);

      // Verify pipeline was called with explicit sessionId
      expect(recommenderPipeline.runRecommendationPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: validSessionId }),
      );
    });

    it('returns 404 SESSION_NOT_FOUND and releases lease with session_gone when session is foreign or deleted', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: false },
        globalDailyCap: 5000,
        usedToday: 10,
        capacity: 'ok',
        shedFreeFor: () => false,
        perf: { ...DEFAULT_PERF_FLAGS, recommend_sessions: 'on' },
      });

      const lease = new QueryLease({
        id: 'lease-test-404',
        chargeSource: 'anon_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000003',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
      });
      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(lease);
      const noChargeSpy = vi.spyOn(lease, 'noCharge');

      vi.mocked(sessionServiceModule.resolveOrCreateSession).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': '00000000-0000-4000-8000-000000000003',
        },
        body: JSON.stringify({ message: 'great battery phone', sessionId: validSessionId }),
      });

      const res = await POST(request);
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.code).toBe('SESSION_NOT_FOUND');
      expect(noChargeSpy).toHaveBeenCalledWith('session_gone');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('returns 409 SESSION_TURN_LIMIT and releases lease when conversation has reached 50 turns', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: false },
        globalDailyCap: 5000,
        usedToday: 10,
        capacity: 'ok',
        shedFreeFor: () => false,
        perf: { ...DEFAULT_PERF_FLAGS, recommend_sessions: 'on' },
      });

      const lease = new QueryLease({
        id: 'lease-test-409',
        chargeSource: 'anon_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000004',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
      });
      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(lease);
      const noChargeSpy = vi.spyOn(lease, 'noCharge');

      vi.mocked(sessionServiceModule.resolveOrCreateSession).mockResolvedValue({
        session: {
          id: validSessionId,
          title: 'Full Conversation',
          titleSource: 'user',
          turnCount: 50,
          status: 'active',
        },
        created: false,
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': '00000000-0000-4000-8000-000000000004',
        },
        body: JSON.stringify({ message: 'turn 51 prompt', sessionId: validSessionId }),
      });

      const res = await POST(request);
      expect(res.status).toBe(409);

      const data = await res.json();
      expect(data.code).toBe('SESSION_TURN_LIMIT');
      expect(noChargeSpy).toHaveBeenCalledWith('session_gone');
      expect(recommenderPipeline.runRecommendationPipeline).not.toHaveBeenCalled();
    });

    it('ignores sessionId and uses legacy path when recommend_sessions flag is off', async () => {
      vi.mocked(platformModule.getPlatformState).mockResolvedValue({
        killSwitch: { enabled: false },
        globalDailyCap: 5000,
        usedToday: 10,
        capacity: 'ok',
        shedFreeFor: () => false,
        perf: { ...DEFAULT_PERF_FLAGS, recommend_sessions: 'off' },
      });

      const lease = new QueryLease({
        id: 'lease-test-legacy',
        chargeSource: 'anon_free',
        quota: {
          remaining: 1,
          freeRemaining: 1,
          creditBalance: 0,
          subRemaining: 0,
          resetAt: new Date().toISOString(),
        },
        requestId: '00000000-0000-4000-8000-000000000005',
        route: 'POST /api/recommend',
        deviceId: 'dev_test_123',
        userId: null,
        traceId: 'trace_test_123',
      });
      vi.mocked(reserveModule.reserveQuery).mockResolvedValue(lease);

      vi.mocked(recommenderPipeline.runRecommendationPipeline).mockResolvedValue({
        kind: 'results',
        requirements: {} as unknown as recommenderPipeline.UserRequirements,
        picks: [],
        relaxed: [],
        refined: false,
        scoresTied: false,
        scorecardMissing: false,
        topAspects: [],
      });

      const request = new NextRequest('http://localhost:3000/api/recommend', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'recsy_rec_session=test-cookie',
          'x-request-id': '00000000-0000-4000-8000-000000000005',
        },
        body: JSON.stringify({ message: 'legacy mode test', sessionId: validSessionId }),
      });

      const res = await POST(request);
      expect(res.status).toBe(200);

      // In legacy mode, resolveOrCreateSession is NOT called
      expect(sessionServiceModule.resolveOrCreateSession).not.toHaveBeenCalled();
      // findSessionByCookie is used instead
      expect(sessionModule.findSessionByCookie).toHaveBeenCalled();
    });
  });
});
