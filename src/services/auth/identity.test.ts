import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveRequestIdentity } from './identity';
import * as deviceModule from './device';
import * as abuseCacheModule from './abuse-cache';
import * as supabaseServerModule from './supabase-server';
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

  it('degrades to anonymous user when sb-* cookies fail verification', async () => {
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

  it('throws 503 AUTH_UNAVAILABLE when session verification times out', async () => {
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
});
