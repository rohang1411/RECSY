import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isTrafficRiskFlagged, verifyTurnstileToken } from './turnstile';
import { env } from '@/env';

describe('isTrafficRiskFlagged', () => {
  it('returns true when IP anonymous usage reaches 70% of cap', () => {
    expect(
      isTrafficRiskFlagged({
        ipKey: 'ip-prefix-123',
        ipAnonUsedToday: 21,
        anonIpCap: 30, // 21 >= 0.7 * 30 (21)
      }),
    ).toBe(true);

    expect(
      isTrafficRiskFlagged({
        ipKey: 'ip-prefix-123',
        ipAnonUsedToday: 20,
        anonIpCap: 30, // 20 < 21
      }),
    ).toBe(false);
  });

  it('returns false when ipKey is null or anonIpCap is 0', () => {
    expect(
      isTrafficRiskFlagged({
        ipKey: null,
        ipAnonUsedToday: 50,
        anonIpCap: 30,
      }),
    ).toBe(false);

    expect(
      isTrafficRiskFlagged({
        ipKey: 'ip-123',
        ipAnonUsedToday: 10,
        anonIpCap: 0,
      }),
    ).toBe(false);
  });
});

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bypasses verification when TURNSTILE_SECRET_KEY is not set', async () => {
    // If not set in test environment, resolves immediately to success
    if (!env.TURNSTILE_SECRET_KEY) {
      const res = await verifyTurnstileToken('any-token');
      expect(res.success).toBe(true);
    }
  });

  it('fails closed on network timeout when secret is present', async () => {
    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }),
    );

    // Temporarily set a dummy secret on env for this test
    const secretDescriptor = Object.getOwnPropertyDescriptor(env, 'TURNSTILE_SECRET_KEY');
    Object.defineProperty(env, 'TURNSTILE_SECRET_KEY', {
      value: 'dummy-secret',
      configurable: true,
    });

    try {
      const res = await verifyTurnstileToken('test-token');
      expect(res.success).toBe(false);
      expect(res.errorCodes).toContain('timeout');
    } finally {
      global.fetch = originalFetch;
      if (secretDescriptor) {
        Object.defineProperty(env, 'TURNSTILE_SECRET_KEY', secretDescriptor);
      }
    }
  });
});
