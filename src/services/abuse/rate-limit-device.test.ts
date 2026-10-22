import { describe, expect, it, vi } from 'vitest';
import {
  consumeDeviceRateLimit,
  deviceRateLimitKey,
  DEVICE_RECOMMEND_RATE_LIMIT_MAX,
} from './rate-limit-device';
import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';

describe('consumeDeviceRateLimit', () => {
  it('no-ops when deviceId is null or empty', async () => {
    const mockDb = { insert: vi.fn(), execute: vi.fn() } as unknown as AppQueryDb;
    await expect(
      consumeDeviceRateLimit(mockDb, null, 'POST /api/recommend'),
    ).resolves.toBeUndefined();
    await expect(
      consumeDeviceRateLimit(mockDb, '', 'POST /api/recommend'),
    ).resolves.toBeUndefined();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('increments counter and succeeds within limit', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: 5 }]),
    } as unknown as AppQueryDb;

    await expect(
      consumeDeviceRateLimit(mockDb, 'dev-123', 'POST /api/recommend'),
    ).resolves.toBeUndefined();
    expect(mockDb.execute).toHaveBeenCalled();
  });

  it('throws RateLimitError when count exceeds threshold', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: DEVICE_RECOMMEND_RATE_LIMIT_MAX + 1 }]),
    } as unknown as AppQueryDb;

    await expect(consumeDeviceRateLimit(mockDb, 'dev-123', 'POST /api/recommend')).rejects.toThrow(
      RateLimitError,
    );
  });

  it('derives expected key format', () => {
    expect(deviceRateLimitKey('dev-abc', 'POST /api/recommend')).toBe('dev_rl:rec:dev-abc');
    expect(deviceRateLimitKey('dev-abc', 'POST /api/ask')).toBe('dev_rl:ask:dev-abc');
  });
});
