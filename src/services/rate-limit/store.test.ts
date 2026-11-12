import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import { PostgresRateLimitStore, resetRateLimitStats, type RateLimitCheck } from './store';

describe('PostgresRateLimitStore', () => {
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockDb: AppQueryDb;
  let store: PostgresRateLimitStore;

  beforeEach(() => {
    resetRateLimitStats();
    mockExecute = vi.fn();
    mockDb = {
      execute: mockExecute,
    } as unknown as AppQueryDb;
    store = new PostgresRateLimitStore(mockDb);
  });

  it('has name "postgres"', () => {
    expect(store.name).toBe('postgres');
  });

  it('returns empty array without calling db when checks is empty', async () => {
    const result = await store.consume([], Date.now());
    expect(result).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('throws an error before db call when duplicate keys are provided', async () => {
    const checks: RateLimitCheck[] = [
      { key: 'key:1', windowMs: 60_000, max: 10, subject: 'ip' },
      { key: 'key:1', windowMs: 60_000, max: 20, subject: 'user' },
    ];

    await expect(store.consume(checks, Date.now())).rejects.toThrow(
      'Duplicate rate limit key: key:1',
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('executes exactly one SQL statement with sorted rows', async () => {
    const nowMs = 1700000000000;
    const checks: RateLimitCheck[] = [
      { key: 'z_key', windowMs: 60_000, max: 10, subject: 'ip' },
      { key: 'a_key', windowMs: 60_000, max: 20, subject: 'user' },
    ];

    mockExecute.mockResolvedValue([
      { key: 'a_key', count: 5 },
      { key: 'z_key', count: 12 },
    ]);

    const outcomes = await store.consume(checks, nowMs);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(2);

    // Results mapped back in original input order
    expect(outcomes[0]).toEqual({
      key: 'z_key',
      count: 12,
      limited: true, // 12 > 10
    });
    expect(outcomes[1]).toEqual({
      key: 'a_key',
      count: 5,
      limited: false, // 5 <= 20
    });
  });

  it('maps results back by key, not by position', async () => {
    const checks: RateLimitCheck[] = [
      { key: 'check:first', windowMs: 60_000, max: 10, subject: 'ip' },
      { key: 'check:second', windowMs: 60_000, max: 10, subject: 'device' },
    ];

    // Return in reversed order
    mockExecute.mockResolvedValue([
      { key: 'check:second', count: 99 },
      { key: 'check:first', count: 1 },
    ]);

    const outcomes = await store.consume(checks, Date.now());

    expect(outcomes[0]).toEqual({
      key: 'check:first',
      count: 1,
      limited: false,
    });
    expect(outcomes[1]).toEqual({
      key: 'check:second',
      count: 99,
      limited: true,
    });
  });

  it('bubbles up SQL errors', async () => {
    mockExecute.mockRejectedValue(new Error('deadlock detected (40P01)'));

    const checks: RateLimitCheck[] = [{ key: 'key:1', windowMs: 60_000, max: 10, subject: 'ip' }];

    await expect(store.consume(checks, Date.now())).rejects.toThrow('deadlock detected (40P01)');
  });
});
