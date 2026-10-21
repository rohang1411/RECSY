import { describe, expect, it, vi } from 'vitest';
import { claimAnonymousState } from './claim-anonymous';
import type { AppQueryDb } from '@/services/db/client';

describe('claimAnonymousState', () => {
  it('returns failure immediately if userId or deviceId missing', async () => {
    const mockDb = { execute: vi.fn() } as unknown as AppQueryDb;
    expect(await claimAnonymousState(mockDb, '', 'dev-1')).toEqual({ success: false });
    expect(await claimAnonymousState(mockDb, 'u-1', '')).toEqual({ success: false });
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('calls recsy_link_device_to_user and claims recommendation_clients', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ recsy_link_device_to_user: 2 }]) // link call
        .mockResolvedValueOnce([{ rowCount: 1 }]), // update client call
    } as unknown as AppQueryDb;

    const res = await claimAnonymousState(
      mockDb,
      'a0000000-0000-0000-0000-000000000001',
      'dev-123',
      'token-xyz',
    );

    expect(res.success).toBe(true);
    expect(res.freeUsedMerged).toBe(2);
    expect(res.clientClaimed).toBe(true);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it('does not throw when database operation fails, returning failure safely', async () => {
    const mockDb = {
      execute: vi.fn().mockRejectedValueOnce(new Error('DB failure')),
    } as unknown as AppQueryDb;

    const res = await claimAnonymousState(
      mockDb,
      'a0000000-0000-0000-0000-000000000001',
      'dev-123',
    );

    expect(res.success).toBe(false);
  });
});
