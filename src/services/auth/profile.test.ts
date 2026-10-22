import { describe, expect, it, vi } from 'vitest';
import { ensureUserProfile, getUserProfile, requireUser } from './profile';
import type { AppQueryDb } from '@/services/db/client';
import { AccountRestrictedError, UnauthorizedError } from '@/lib/errors';
import * as identityModule from './identity';
import type { NextRequest } from 'next/server';

describe('ensureUserProfile', () => {
  it('throws when userId is missing', async () => {
    const mockDb = { execute: vi.fn() } as unknown as AppQueryDb;
    await expect(ensureUserProfile(mockDb, { email: 'test@example.com' })).rejects.toThrow(
      /missing from claims/,
    );
  });

  it('executes upsert query with normalized email and metadata', async () => {
    const mockDb = { execute: vi.fn().mockResolvedValue([]) } as unknown as AppQueryDb;
    const res = await ensureUserProfile(mockDb, {
      id: 'a0000000-0000-0000-0000-000000000001',
      email: 'John.Doe+promo@gmail.com',
      user_metadata: {
        full_name: 'John Doe',
        avatar_url: 'https://example.com/avatar.jpg',
      },
    });

    expect(res.id).toBe('a0000000-0000-0000-0000-000000000001');
    expect(res.email).toBe('John.Doe+promo@gmail.com');
    expect(res.email_normalized).toBe('johndoe@gmail.com');
    expect(mockDb.execute).toHaveBeenCalled();
  });
});

describe('getUserProfile', () => {
  it('queries user_profiles by id', async () => {
    const mockProfile = {
      id: 'a0000000-0000-0000-0000-000000000001',
      email: 'user@example.com',
      status: 'active',
    };
    const mockDb = { execute: vi.fn().mockResolvedValue([mockProfile]) } as unknown as AppQueryDb;

    const res = await getUserProfile(mockDb, 'a0000000-0000-0000-0000-000000000001');
    expect(res).toEqual(mockProfile);
  });
});

describe('requireUser', () => {
  it('throws UnauthorizedError when userId is null', async () => {
    vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValueOnce({
      userId: null,
      emailVerified: false,
      deviceId: 'dev-1',
      deviceCookieIsNew: false,
      ipKey: 'ip-1',
      ipHashForRateLimit: 'hash-1',
      isSuspended: false,
    });

    const dummyReq = {} as NextRequest;
    await expect(requireUser(dummyReq)).rejects.toThrow(UnauthorizedError);
  });

  it('throws AccountRestrictedError when user is suspended', async () => {
    vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValueOnce({
      userId: 'u1',
      emailVerified: true,
      deviceId: 'dev-1',
      deviceCookieIsNew: false,
      ipKey: 'ip-1',
      ipHashForRateLimit: 'hash-1',
      isSuspended: true,
    });

    const dummyReq = {} as NextRequest;
    await expect(requireUser(dummyReq)).rejects.toThrow(AccountRestrictedError);
  });

  it('returns resolved identity when active user is present', async () => {
    const mockIdentity = {
      userId: 'u1',
      emailVerified: true,
      deviceId: 'dev-1',
      deviceCookieIsNew: false,
      ipKey: 'ip-1',
      ipHashForRateLimit: 'hash-1',
      isSuspended: false,
    };
    vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValueOnce(mockIdentity);

    const dummyReq = {} as NextRequest;
    const res = await requireUser(dummyReq);
    expect(res).toEqual(mockIdentity);
  });
});
