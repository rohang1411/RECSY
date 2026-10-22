import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveReasoningMode } from './mode';
import type { QueryLease } from './lease';
import { getDb, type AppQueryDb } from '@/services/db/client';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

describe('WP-13: Server-side Deep Reasoning Router (mode.ts)', () => {
  const mockDb = {
    execute: vi.fn(),
  };

  const createMockLease = (chargeSource: QueryLease['chargeSource']): QueryLease =>
    ({
      id: 'lease-test-123',
      subjectId: 'sub-1',
      chargeSource,
      isNoop: false,
      commit: vi.fn(),
      refund: vi.fn(),
      projectedQuota: vi.fn(),
    }) as unknown as QueryLease;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
  });

  it('returns fast when requestedMode is undefined or fast', async () => {
    const lease = createMockLease('daily_free');
    const result1 = await resolveReasoningMode({ userId: 'u1' }, lease, undefined);
    const result2 = await resolveReasoningMode({ userId: 'u1' }, lease, 'fast');

    expect(result1).toBe('fast');
    expect(result2).toBe('fast');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns deep for BYOK requests when deep is requested', async () => {
    const lease = createMockLease('byok');
    const result = await resolveReasoningMode({ userId: null }, lease, 'deep');

    expect(result).toBe('deep');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns deep for subscription-charged requests when deep is requested', async () => {
    const lease = createMockLease('subscription');
    const result = await resolveReasoningMode({ userId: 'u1' }, lease, 'deep');

    expect(result).toBe('deep');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns deep for authenticated users with active Pro subscription in DB', async () => {
    const lease = createMockLease('daily_free');
    mockDb.execute.mockResolvedValueOnce([
      { status: 'active', entitled_until: new Date(Date.now() + 86400000).toISOString() },
    ]);

    const result = await resolveReasoningMode(
      { userId: 'u-sub-active' },
      lease,
      'deep',
      mockDb as unknown as AppQueryDb,
    );

    expect(result).toBe('deep');
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('returns deep for authenticated users with trialing Pro subscription in DB', async () => {
    const lease = createMockLease('daily_free');
    mockDb.execute.mockResolvedValueOnce([
      { status: 'trialing', entitled_until: new Date(Date.now() + 86400000).toISOString() },
    ]);

    const result = await resolveReasoningMode(
      { userId: 'u-sub-trial' },
      lease,
      'deep',
      mockDb as unknown as AppQueryDb,
    );

    expect(result).toBe('deep');
  });

  it('downgrades to fast when authenticated user has no active subscription in DB', async () => {
    const lease = createMockLease('daily_free');
    mockDb.execute.mockResolvedValueOnce([]); // No active subscription

    const result = await resolveReasoningMode(
      { userId: 'u-free' },
      lease,
      'deep',
      mockDb as unknown as AppQueryDb,
    );

    expect(result).toBe('fast');
  });

  it('downgrades to fast for anonymous callers even if deep is requested', async () => {
    const lease = createMockLease('daily_free');
    const result = await resolveReasoningMode({ userId: null, deviceId: 'dev-1' }, lease, 'deep');

    expect(result).toBe('fast');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('safely downgrades to fast and logs warning on database failure', async () => {
    const lease = createMockLease('daily_free');
    mockDb.execute.mockRejectedValueOnce(new Error('DB timeout'));

    const result = await resolveReasoningMode(
      { userId: 'u-error' },
      lease,
      'deep',
      mockDb as unknown as AppQueryDb,
    );

    expect(result).toBe('fast');
  });
});
