import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveRequestIdentity } from './identity';
import * as deviceModule from './device';
import * as abuseCacheModule from './abuse-cache';
import * as supabaseServerModule from './supabase-server';
import * as fakeDriverModule from './drivers/fake';
import * as envModule from '@/env';
import type { NextRequest } from 'next/server';

function makeMockRequest(options: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): NextRequest {
  const headersMap = new Map<string, string>();
  for (const [k, v] of Object.entries(options.headers || {})) {
    headersMap.set(k.toLowerCase(), v);
  }

  const cookiesList = Object.entries(options.cookies || {}).map(([name, value]) => ({
    name,
    value,
  }));

  return {
    headers: {
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    },
    cookies: {
      get: (k: string) => {
        const found = cookiesList.find((c) => c.name === k);
        return found ? { name: found.name, value: found.value } : undefined;
      },
      getAll: () => cookiesList,
    },
  } as unknown as NextRequest;
}

describe('resolveRequestIdentity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    abuseCacheModule.invalidateAbuseCache();
  });

  it('hashes valid device cookie into 32-char hex and marks deviceCookieIsNew=false', async () => {
    const cookieName = deviceModule.getDeviceCookieName();
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { [cookieName]: 'client-cookie-secret-val' },
    });

    const identity = await resolveRequestIdentity(req);
    expect(identity.deviceCookieIsNew).toBe(false);
    expect(identity.deviceId).toHaveLength(32);
    expect(identity.deviceId).not.toContain('nocookie:');
    expect(identity.ipKey).toBeTruthy();
    expect(identity.userId).toBeNull();
  });

  it('generates nocookie:<ipKey> and marks deviceCookieIsNew=true when device cookie is missing', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: {},
    });

    const identity = await resolveRequestIdentity(req);
    expect(identity.deviceCookieIsNew).toBe(true);
    expect(identity.deviceId).toMatch(/^nocookie:[0-9a-f]{32}$/);
    expect(identity.ipKey).toBeTruthy();
    expect(identity.userId).toBeNull();
  });

  it('degrades to anonymous user when sb-* cookies fail verification (getUser path)', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'garbage-token' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    vi.spyOn(supabaseServerModule, 'getVerifiedUserWithTimeout').mockResolvedValueOnce(null);

    const identity = await resolveRequestIdentity(req);
    expect(identity.userId).toBeNull();
    expect(identity.emailVerified).toBe(false);
  });

  it('throws 503 AUTH_UNAVAILABLE when session verification times out (getUser path)', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'some-token' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    vi.spyOn(supabaseServerModule, 'getVerifiedUserWithTimeout').mockRejectedValueOnce(
      new Error('AUTH_TIMEOUT'),
    );

    await expect(resolveRequestIdentity(req)).rejects.toThrow(
      expect.objectContaining({
        code: 'AUTH_UNAVAILABLE',
        status: 503,
      }),
    );
  });

  it('resolves user id and emailVerified when localClaims is true and claims are valid', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'valid-jwt' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    const claimsSpy = vi
      .spyOn(supabaseServerModule, 'getVerifiedClaimsWithTimeout')
      .mockResolvedValueOnce({
        id: 'sub-claim-user-123',
        emailVerified: true,
      });
    const userSpy = vi.spyOn(supabaseServerModule, 'getVerifiedUserWithTimeout');

    const identity = await resolveRequestIdentity(req, { localClaims: true });
    expect(claimsSpy).toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
    expect(identity.userId).toBe('sub-claim-user-123');
    expect(identity.emailVerified).toBe(true);
  });

  it('degrades to anonymous when localClaims is true and token is expired/invalid', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'expired-jwt' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    vi.spyOn(supabaseServerModule, 'getVerifiedClaimsWithTimeout').mockResolvedValueOnce(null);

    const identity = await resolveRequestIdentity(req, { localClaims: true });
    expect(identity.userId).toBeNull();
    expect(identity.emailVerified).toBe(false);
  });

  it('throws 503 AUTH_UNAVAILABLE when localClaims verification times out', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'slow-jwt' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    vi.spyOn(supabaseServerModule, 'getVerifiedClaimsWithTimeout').mockRejectedValueOnce(
      new Error('AUTH_TIMEOUT'),
    );

    await expect(resolveRequestIdentity(req, { localClaims: true })).rejects.toThrow(
      expect.objectContaining({
        code: 'AUTH_UNAVAILABLE',
        status: 503,
      }),
    );
  });

  it('uses getUser path when localClaims is false or omitted', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'valid-jwt' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    const userSpy = vi
      .spyOn(supabaseServerModule, 'getVerifiedUserWithTimeout')
      .mockResolvedValueOnce({
        id: 'get-user-456',
        email_confirmed_at: '2026-01-01',
      } as never);
    const claimsSpy = vi.spyOn(supabaseServerModule, 'getVerifiedClaimsWithTimeout');

    const identity = await resolveRequestIdentity(req, { localClaims: false });
    expect(userSpy).toHaveBeenCalled();
    expect(claimsSpy).not.toHaveBeenCalled();
    expect(identity.userId).toBe('get-user-456');
    expect(identity.emailVerified).toBe(true);
  });

  it('marks isSuspended=true when device is in abuse blocks', async () => {
    const cookieName = deviceModule.getDeviceCookieName();
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { [cookieName]: 'blocked-device-raw' },
    });

    const devId = deviceModule.hashDeviceId('blocked-device-raw');
    abuseCacheModule.setAbuseCacheForTest([{ kind: 'device', value: devId }]);

    const identity = await resolveRequestIdentity(req);
    expect(identity.isSuspended).toBe(true);
  });

  it('suspension via abuse_blocks still applies with localClaims', async () => {
    const req = makeMockRequest({
      headers: { 'x-forwarded-for': '198.51.100.22' },
      cookies: { 'sb-access-token': 'valid-jwt' },
    });

    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValueOnce({} as never);
    vi.spyOn(supabaseServerModule, 'getVerifiedClaimsWithTimeout').mockResolvedValueOnce({
      id: 'blocked-user-uuid',
      emailVerified: true,
    });

    abuseCacheModule.setAbuseCacheForTest([{ kind: 'user', value: 'blocked-user-uuid' }]);

    const identity = await resolveRequestIdentity(req, { localClaims: true });
    expect(identity.userId).toBe('blocked-user-uuid');
    expect(identity.isSuspended).toBe(true);
  });

  it('throws before reading fake auth cookie when AUTH_DRIVER=fake and NODE_ENV=production', async () => {
    const req = makeMockRequest({
      cookies: { recsy_fake_uid: 'malicious-injected-uid' },
    });

    const origDriver = envModule.env.AUTH_DRIVER;
    // Cast to modify for test
    (envModule.env as { AUTH_DRIVER: string }).AUTH_DRIVER = 'fake';

    vi.spyOn(fakeDriverModule, 'assertFakeAuthAllowed').mockImplementation(() => {
      throw new Error('FakeAuthDriver is forbidden in production environment');
    });

    try {
      await expect(resolveRequestIdentity(req)).rejects.toThrow(/forbidden in production/);
    } finally {
      (envModule.env as { AUTH_DRIVER: string }).AUTH_DRIVER = origDriver;
    }
  });
});
