import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { AccountRestrictedError, AppError, RateLimitError } from '@/lib/errors';
import { createStageTimer } from '@/lib/stage-timer';
import type { RequestIdentity } from '@/services/auth/identity';
import * as identityModule from '@/services/auth/identity';
import * as platformModule from '@/services/metering/platform';
import * as configModule from '@/services/metering/config';
import * as rateLimitModule from '@/services/rate-limit';
import * as abuseModule from '@/services/abuse/turnstile';
import type { AppQueryDb } from '@/services/db/client';
import type * as EnvModule from '@/env';
import { admitMeteredRequest, assertCaptchaIfRiskFlagged } from './admission';
import type { PlatformState, MeteringConfig } from './types';
import { DEFAULT_PERF_FLAGS } from '@/services/perf/flags';

vi.mock('@/services/auth/identity');
vi.mock('@/services/metering/platform');
vi.mock('@/services/metering/config');
vi.mock('@/services/rate-limit');
vi.mock('@/services/abuse/turnstile');
vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      TURNSTILE_SECRET_KEY: 'test-secret-key',
    },
  };
});

describe('admitMeteredRequest', () => {
  const mockDb = {
    execute: vi.fn(),
  } as unknown as AppQueryDb;

  const defaultPlatformState: PlatformState = {
    killSwitch: { enabled: false },
    globalDailyCap: 1000,
    usedToday: 10,
    capacity: 'ok',
    shedFreeFor: () => false,
    perf: {
      ...DEFAULT_PERF_FLAGS,
      ask_streaming: 'off',
      ask_streaming_canary_pct: 0,
      auth_local_claims: false,
      admission_single_statement: false,
      public_data_cache: true,
      defer_telemetry: true,
      redis_rate_limit: false,
      grounded_thinking: 'default',
    },
  };

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

  const defaultIdentity: RequestIdentity = {
    userId: null,
    deviceId: '00000000-0000-4000-8000-000000000001',
    ipKey: '198.51.100.0/24',
    ipHashForRateLimit: 'hash123',
    isSuspended: false,
    emailVerified: false,
    deviceCookieIsNew: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platformModule.getPlatformState).mockResolvedValue(defaultPlatformState);
    vi.mocked(configModule.getMeteringConfig).mockReturnValue(defaultConfig);
    vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue(defaultIdentity);
    vi.mocked(rateLimitModule.consumeAdmissionLimits).mockResolvedValue(undefined);
    vi.mocked(abuseModule.isTrafficRiskFlagged).mockReturnValue(false);
  });

  it('rejects cross-origin requests with BAD_ORIGIN', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://malicious.com',
        host: 'localhost:3000',
      },
    });
    const timer = createStageTimer();

    await expect(admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer)).rejects.toThrow(
      AppError,
    );
  });

  it('preserves client x-request-id if provided and valid', async () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'x-request-id': validUuid,
      },
    });
    const timer = createStageTimer();

    const result = await admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer);
    expect(result.requestId).toBe(validUuid);
  });

  it('generates a uuid if x-request-id is omitted', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });
    const timer = createStageTimer();

    const result = await admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer);
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('rejects suspended accounts with AccountRestrictedError', async () => {
    vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
      ...defaultIdentity,
      isSuspended: true,
    });

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });
    const timer = createStageTimer();

    await expect(admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer)).rejects.toThrow(
      AccountRestrictedError,
    );
  });

  it('propagates RateLimitError when admission limits are exceeded', async () => {
    vi.mocked(rateLimitModule.consumeAdmissionLimits).mockRejectedValue(
      new RateLimitError({ reason: 'IP limit exceeded' }),
    );

    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });
    const timer = createStageTimer();

    await expect(admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer)).rejects.toThrow(
      RateLimitError,
    );
  });

  it('asserts platform acceptance and admits valid request', async () => {
    const req = new NextRequest('http://localhost:3000/api/ask', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });
    const timer = createStageTimer();

    const admitted = await admitMeteredRequest(req, 'POST /api/ask', { db: mockDb }, timer);

    expect(admitted.identity).toBe(defaultIdentity);
    expect(admitted.isByok).toBe(false);
    expect(admitted.byok).toBeNull();
    expect(admitted.platform).toBe(defaultPlatformState);
    expect(admitted.config).toBe(defaultConfig);
    expect(platformModule.assertPlatformAcceptsRequest).toHaveBeenCalledWith(
      defaultPlatformState,
      defaultIdentity,
      false,
    );
  });
});

describe('assertCaptchaIfRiskFlagged', () => {
  const mockExecute = vi.fn();
  const mockDb = {
    execute: mockExecute,
  } as unknown as AppQueryDb;

  const identity: RequestIdentity = {
    userId: null,
    deviceId: 'dev_123',
    ipKey: '198.51.100.0/24',
    ipHashForRateLimit: 'hash_123',
    isSuspended: false,
    emailVerified: false,
    deviceCookieIsNew: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips captcha check if user is signed in', async () => {
    const signedInIdentity: RequestIdentity = {
      ...identity,
      userId: 'usr_abc123',
    };

    await expect(
      assertCaptchaIfRiskFlagged(mockDb, signedInIdentity, 20, null),
    ).resolves.toBeUndefined();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('skips captcha check if anonIpCap <= 0', async () => {
    await expect(assertCaptchaIfRiskFlagged(mockDb, identity, 0, null)).resolves.toBeUndefined();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('throws CAPTCHA_REQUIRED when risk is flagged and no turnstile token provided', async () => {
    mockExecute.mockResolvedValueOnce([{ queries_used: 15 }]);
    vi.mocked(abuseModule.isTrafficRiskFlagged).mockReturnValueOnce(true);

    await expect(assertCaptchaIfRiskFlagged(mockDb, identity, 20, null)).rejects.toMatchObject({
      code: 'CAPTCHA_REQUIRED',
      status: 428,
    });
  });

  it('throws CAPTCHA_REQUIRED when risk is flagged and verification fails', async () => {
    mockExecute.mockResolvedValueOnce([{ queries_used: 15 }]);
    vi.mocked(abuseModule.isTrafficRiskFlagged).mockReturnValueOnce(true);

    const mockVerifier = vi.fn().mockResolvedValue({
      success: false,
      errorCodes: ['invalid-input-response'],
    });

    await expect(
      assertCaptchaIfRiskFlagged(mockDb, identity, 20, 'bad-token', '198.51.100.5', mockVerifier),
    ).rejects.toMatchObject({
      code: 'CAPTCHA_REQUIRED',
      status: 428,
    });
  });

  it('succeeds when risk is flagged and verification passes', async () => {
    mockExecute.mockResolvedValueOnce([{ queries_used: 15 }]);
    vi.mocked(abuseModule.isTrafficRiskFlagged).mockReturnValueOnce(true);

    const mockVerifier = vi.fn().mockResolvedValue({
      success: true,
    });

    await expect(
      assertCaptchaIfRiskFlagged(mockDb, identity, 20, 'valid-token', '198.51.100.5', mockVerifier),
    ).resolves.toBeUndefined();
  });

  it('fails open on transient db error during counter lookup', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection timeout'));

    await expect(assertCaptchaIfRiskFlagged(mockDb, identity, 20, null)).resolves.toBeUndefined();
  });
});
