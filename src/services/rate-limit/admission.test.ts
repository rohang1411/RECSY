import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_RATE_LIMIT_MAX,
  ASK_RATE_LIMIT_WINDOW_MS,
  RECOMMEND_RATE_LIMIT_MAX,
  RECOMMEND_RATE_LIMIT_WINDOW_MS,
} from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';
import type { RequestIdentity } from '@/services/auth/identity';
import type { AppQueryDb } from '@/services/db/client';
import {
  DEVICE_ASK_RATE_LIMIT_MAX,
  DEVICE_RECOMMEND_RATE_LIMIT_MAX,
  deviceRateLimitKey,
} from '@/services/abuse/rate-limit-device';
import {
  USER_ASK_RATE_LIMIT_MAX,
  USER_RATE_LIMIT_WINDOW_MS,
  USER_RECOMMEND_RATE_LIMIT_MAX,
  userRateLimitKey,
} from '@/services/metering/rate-limit-user';

import { buildAdmissionChecks, consumeAdmissionLimits } from './admission';
import { askRateLimitKey, recommendRateLimitKey } from './consume';
import { hashClientIp } from './ip-hash';
import { getRateLimitStats, resetRateLimitStats, type RateLimitStore } from './store';

describe('buildAdmissionChecks', () => {
  const ip = '198.51.100.42';
  const ipHash = hashClientIp(ip);

  it('builds 2 checks for anonymous ask request with deviceId', () => {
    const identity: RequestIdentity = {
      userId: null,
      emailVerified: false,
      deviceId: 'dev_anon_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    const checks = buildAdmissionChecks({ ip, identity, route: 'ask' });

    expect(checks).toHaveLength(2);
    expect(checks[0]).toEqual({
      key: askRateLimitKey(ipHash),
      windowMs: ASK_RATE_LIMIT_WINDOW_MS,
      max: ASK_RATE_LIMIT_MAX,
      subject: 'ip',
    });
    expect(checks[1]).toEqual({
      key: deviceRateLimitKey('dev_anon_1', 'POST /api/ask'),
      windowMs: 60_000,
      max: DEVICE_ASK_RATE_LIMIT_MAX,
      subject: 'device',
    });
  });

  it('builds 3 checks for signed-in ask request with deviceId', () => {
    const identity: RequestIdentity = {
      userId: 'usr_premium_123',
      emailVerified: true,
      deviceId: 'dev_user_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    const checks = buildAdmissionChecks({ ip, identity, route: 'ask' });

    expect(checks).toHaveLength(3);
    expect(checks[0]).toEqual({
      key: askRateLimitKey(ipHash),
      windowMs: ASK_RATE_LIMIT_WINDOW_MS,
      max: ASK_RATE_LIMIT_MAX,
      subject: 'ip',
    });
    expect(checks[1]).toEqual({
      key: userRateLimitKey('ask', 'usr_premium_123'),
      windowMs: USER_RATE_LIMIT_WINDOW_MS,
      max: USER_ASK_RATE_LIMIT_MAX,
      subject: 'user',
    });
    expect(checks[2]).toEqual({
      key: deviceRateLimitKey('dev_user_1', 'POST /api/ask'),
      windowMs: 60_000,
      max: DEVICE_ASK_RATE_LIMIT_MAX,
      subject: 'device',
    });
  });

  it('builds checks for recommend route with recommend limits and keys', () => {
    const identity: RequestIdentity = {
      userId: 'usr_rec_123',
      emailVerified: true,
      deviceId: 'dev_rec_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    const checks = buildAdmissionChecks({ ip, identity, route: 'recommend' });

    expect(checks).toHaveLength(3);
    expect(checks[0]).toEqual({
      key: recommendRateLimitKey(ipHash),
      windowMs: RECOMMEND_RATE_LIMIT_WINDOW_MS,
      max: RECOMMEND_RATE_LIMIT_MAX,
      subject: 'ip',
    });
    expect(checks[1]).toEqual({
      key: userRateLimitKey('recommend', 'usr_rec_123'),
      windowMs: USER_RATE_LIMIT_WINDOW_MS,
      max: USER_RECOMMEND_RATE_LIMIT_MAX,
      subject: 'user',
    });
    expect(checks[2]).toEqual({
      key: deviceRateLimitKey('dev_rec_1', 'POST /api/recommend'),
      windowMs: 60_000,
      max: DEVICE_RECOMMEND_RATE_LIMIT_MAX,
      subject: 'device',
    });
  });

  it('produces exact key strings equal to the legacy helpers', () => {
    const identity: RequestIdentity = {
      userId: 'test_user_id',
      emailVerified: true,
      deviceId: 'test_device_id',
      deviceCookieIsNew: false,
      ipKey: 'ip_key_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    const checks = buildAdmissionChecks({ ip, identity, route: 'ask' });

    expect(checks.find((c) => c.subject === 'ip')?.key).toBe(`ask:v1:${ipHash}`);
    expect(checks.find((c) => c.subject === 'user')?.key).toBe('ask:user:v1:test_user_id');
    expect(checks.find((c) => c.subject === 'device')?.key).toBe('dev_rl:ask:test_device_id');
  });
});

describe('consumeAdmissionLimits', () => {
  const ip = '198.51.100.42';
  const ipHash = hashClientIp(ip);
  let mockDb: AppQueryDb;
  let mockStore: RateLimitStore;

  beforeEach(() => {
    resetRateLimitStats();
    mockDb = {} as unknown as AppQueryDb;
    mockStore = {
      name: 'postgres',
      consume: vi.fn(),
    };
  });

  it('succeeds without throwing when all checks are within limit', async () => {
    const identity: RequestIdentity = {
      userId: 'user_1',
      emailVerified: true,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    vi.mocked(mockStore.consume).mockResolvedValue([
      { key: askRateLimitKey(ipHash), count: 5, limited: false },
      { key: userRateLimitKey('ask', 'user_1'), count: 2, limited: false },
      { key: deviceRateLimitKey('dev_1', 'POST /api/ask'), count: 1, limited: false },
    ]);

    await expect(
      consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
      }),
    ).resolves.toBeUndefined();

    expect(mockStore.consume).toHaveBeenCalledTimes(1);
  });

  it('fails open on store error (rule R3), logs warning and increments counter', async () => {
    const identity: RequestIdentity = {
      userId: null,
      emailVerified: false,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    vi.mocked(mockStore.consume).mockRejectedValue(new Error('connection terminated unexpectedly'));

    await expect(
      consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
      }),
    ).resolves.toBeUndefined();

    expect(getRateLimitStats().storeErrors).toBe(1);
  });

  it('throws RateLimitError when IP is limited with windowStart context', async () => {
    const identity: RequestIdentity = {
      userId: 'user_1',
      emailVerified: true,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    const nowMs = 1700000030000;
    vi.mocked(mockStore.consume).mockResolvedValue([
      { key: askRateLimitKey(ipHash), count: ASK_RATE_LIMIT_MAX + 1, limited: true },
      { key: userRateLimitKey('ask', 'user_1'), count: 2, limited: false },
      { key: deviceRateLimitKey('dev_1', 'POST /api/ask'), count: 1, limited: false },
    ]);

    try {
      await consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
        nowMs,
      });
      expect.unreachable('Should have thrown RateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rlErr = err as RateLimitError;
      expect(rlErr.context).toHaveProperty('windowStart');
    }
  });

  it('throws RateLimitError for User when User is limited', async () => {
    const identity: RequestIdentity = {
      userId: 'user_1',
      emailVerified: true,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    vi.mocked(mockStore.consume).mockResolvedValue([
      { key: askRateLimitKey(ipHash), count: 5, limited: false },
      { key: userRateLimitKey('ask', 'user_1'), count: USER_ASK_RATE_LIMIT_MAX + 1, limited: true },
      { key: deviceRateLimitKey('dev_1', 'POST /api/ask'), count: 1, limited: false },
    ]);

    try {
      await consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
      });
      expect.unreachable('Should have thrown RateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rlErr = err as RateLimitError;
      expect(rlErr.context).toMatchObject({
        route: 'ask',
        maxAllowed: USER_ASK_RATE_LIMIT_MAX,
        userId: 'user_1',
      });
    }
  });

  it('throws RateLimitError for Device when Device is limited', async () => {
    const identity: RequestIdentity = {
      userId: 'user_1',
      emailVerified: true,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    vi.mocked(mockStore.consume).mockResolvedValue([
      { key: askRateLimitKey(ipHash), count: 5, limited: false },
      { key: userRateLimitKey('ask', 'user_1'), count: 2, limited: false },
      {
        key: deviceRateLimitKey('dev_1', 'POST /api/ask'),
        count: DEVICE_ASK_RATE_LIMIT_MAX + 1,
        limited: true,
      },
    ]);

    try {
      await consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
      });
      expect.unreachable('Should have thrown RateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rlErr = err as RateLimitError;
      expect(rlErr.context).toMatchObject({
        limit: DEVICE_ASK_RATE_LIMIT_MAX,
        current: DEVICE_ASK_RATE_LIMIT_MAX + 1,
        subject: 'device',
      });
    }
  });

  it('prioritizes IP over User over Device when multiple limits are exceeded', async () => {
    const identity: RequestIdentity = {
      userId: 'user_1',
      emailVerified: true,
      deviceId: 'dev_1',
      deviceCookieIsNew: false,
      ipKey: 'ip_1',
      ipHashForRateLimit: ipHash,
      isSuspended: false,
    };

    // All 3 limited
    vi.mocked(mockStore.consume).mockResolvedValue([
      { key: askRateLimitKey(ipHash), count: 99, limited: true },
      { key: userRateLimitKey('ask', 'user_1'), count: 99, limited: true },
      { key: deviceRateLimitKey('dev_1', 'POST /api/ask'), count: 99, limited: true },
    ]);

    try {
      await consumeAdmissionLimits({
        db: mockDb,
        ip,
        identity,
        route: 'ask',
        store: mockStore,
      });
      expect.unreachable('Should have thrown RateLimitError');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rlErr = err as RateLimitError;
      // IP limit context only has windowStart, no userId or subject: 'device'
      expect(rlErr.context).toHaveProperty('windowStart');
      expect(rlErr.context.userId).toBeUndefined();
    }
  });
});
