import { describe, expect, it, vi } from 'vitest';
import { claimAnonymousState, extractSessionIdFromReturnTo } from './claim-anonymous';
import type { AppQueryDb } from '@/services/db/client';

describe('extractSessionIdFromReturnTo', () => {
  it('extracts uuid from /recommend/<uuid>', () => {
    const uuid = 'a0000000-0000-0000-0000-000000000001';
    expect(extractSessionIdFromReturnTo(`/recommend/${uuid}`)).toBe(uuid);
    expect(extractSessionIdFromReturnTo(`/recommend/${uuid}?tab=all`)).toBe(uuid);
  });

  it('returns null for non-recommend or invalid paths', () => {
    expect(extractSessionIdFromReturnTo(null)).toBeNull();
    expect(extractSessionIdFromReturnTo('/recommend')).toBeNull();
    expect(extractSessionIdFromReturnTo('/account/history')).toBeNull();
    expect(extractSessionIdFromReturnTo('/recommend/invalid-uuid')).toBeNull();
  });
});

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
        .mockResolvedValueOnce([{ id: 'c-1' }]) // update client call with RETURNING id
        .mockResolvedValueOnce([]), // update sessions for client call
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
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('claims explicitly presented session ids for the device', async () => {
    const sessionId = 'b0000000-0000-0000-0000-000000000002';
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ recsy_link_device_to_user: 0 }]) // link call
        .mockResolvedValueOnce([{ id: sessionId, client_id: 'client-99' }]) // update session call
        .mockResolvedValueOnce([]), // update client for session
    } as unknown as AppQueryDb;

    const res = await claimAnonymousState(
      mockDb,
      'a0000000-0000-0000-0000-000000000001',
      'dev-123',
      null,
      [sessionId],
    );

    expect(res.success).toBe(true);
    expect(res.sessionsClaimed).toBe(1);
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('marks clientClaimed as false when no unowned client matched the token', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ recsy_link_device_to_user: 0 }])
        .mockResolvedValueOnce([]), // 0 rows updated
    } as unknown as AppQueryDb;

    const res = await claimAnonymousState(
      mockDb,
      'a0000000-0000-0000-0000-000000000001',
      'dev-123',
      'token-unmatched',
    );

    expect(res.success).toBe(true);
    expect(res.clientClaimed).toBe(false);
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
