import { describe, expect, it, vi } from 'vitest';
import {
  consumeUserRateLimit,
  userRateLimitKey,
  USER_RECOMMEND_RATE_LIMIT_MAX,
} from './rate-limit-user';
import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';

describe('consumeUserRateLimit', () => {
  it('no-ops when userId is null or undefined', async () => {
    const mockDb = {
      execute: vi.fn(),
    } as unknown as AppQueryDb;

    await expect(consumeUserRateLimit(null, 'recommend', mockDb)).resolves.toBeUndefined();
    await expect(consumeUserRateLimit(undefined, 'ask', mockDb)).resolves.toBeUndefined();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('formats keys with expected prefix pattern', () => {
    expect(userRateLimitKey('recommend', 'u-123')).toBe('recommend:user:v1:u-123');
    expect(userRateLimitKey('ask', 'u-456')).toBe('ask:user:v1:u-456');
  });

  it('allows request when within limit', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: USER_RECOMMEND_RATE_LIMIT_MAX }]),
    } as unknown as AppQueryDb;

    await expect(consumeUserRateLimit('user-1', 'recommend', mockDb)).resolves.toBeUndefined();
  });

  it('throws RateLimitError when limit is exceeded', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: USER_RECOMMEND_RATE_LIMIT_MAX + 1 }]),
    } as unknown as AppQueryDb;

    await expect(consumeUserRateLimit('user-1', 'recommend', mockDb)).rejects.toThrow(
      RateLimitError,
    );
  });

  it('fails open on database error (rule R3)', async () => {
    const mockDb = {
      execute: vi.fn().mockRejectedValue(new Error('db connection lost')),
    } as unknown as AppQueryDb;

    await expect(consumeUserRateLimit('user-1', 'recommend', mockDb)).resolves.toBeUndefined();
  });
});
