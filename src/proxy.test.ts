import { describe, expect, it, vi } from 'vitest';
import { proxy, REGION_COOKIE } from './proxy';
import * as supabaseServerModule from './services/auth/supabase-server';
import type { NextRequest } from 'next/server';

function createMockRequest(options: {
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

describe('proxy / middleware', () => {
  it('sets region cookie and device cookie when none exist', async () => {
    const req = createMockRequest({
      headers: { 'x-vercel-ip-country': 'IN' },
      cookies: {},
    });

    const res = await proxy(req);
    const regionCookie = res.cookies.get(REGION_COOKIE);
    expect(regionCookie).toBeDefined();
    expect(regionCookie?.value).toBe('IN');

    const didCookie = res.cookies.get('recsy_did') || res.cookies.get('__Host-recsy_did');
    expect(didCookie).toBeDefined();
    expect(didCookie?.value).toBeTruthy();
    expect(didCookie?.httpOnly).toBe(true);
  });

  it('preserves existing valid region and device cookies', async () => {
    const req = createMockRequest({
      headers: { 'x-vercel-ip-country': 'US' },
      cookies: {
        [REGION_COOKIE]: 'IN',
        recsy_did: 'existing-did-token',
      },
    });

    const res = await proxy(req);
    // When region exists and is valid, proxy does not overwrite it on the response
    expect(res.cookies.get(REGION_COOKIE)).toBeUndefined();
    expect(res.cookies.get('recsy_did')).toBeUndefined();
  });

  it('triggers Supabase token refresh when sb-* cookies exist', async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.spyOn(supabaseServerModule, 'createSupabaseProxyClient').mockReturnValue({
      auth: { getUser: mockGetUser },
    } as never);

    const req = createMockRequest({
      cookies: { 'sb-access-token': 'token123' },
    });

    await proxy(req);
    expect(supabaseServerModule.createSupabaseProxyClient).toHaveBeenCalled();
    expect(mockGetUser).toHaveBeenCalled();
  });
});
