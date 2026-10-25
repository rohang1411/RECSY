import { describe, expect, it, vi, beforeEach } from 'vitest';
import { proxy, REGION_COOKIE } from './proxy';
import * as supabaseServerModule from './services/auth/supabase-server';
import type { NextRequest } from 'next/server';

function createMockRequest(options: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  method?: string;
  url?: string;
}): NextRequest {
  const headersMap = new Map<string, string>();
  for (const [k, v] of Object.entries(options.headers || {})) {
    headersMap.set(k.toLowerCase(), v);
  }

  const cookiesList = Object.entries(options.cookies || {}).map(([name, value]) => ({
    name,
    value,
  }));

  const url = options.url || 'http://localhost/';

  return {
    method: options.method || 'GET',
    nextUrl: new URL(url),
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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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

  it('triggers Supabase token refresh via getClaims() on page routes when sb-* cookies exist', async () => {
    const mockGetClaims = vi.fn().mockResolvedValue({ data: { claims: null }, error: null });
    const spy = vi.spyOn(supabaseServerModule, 'createSupabaseProxyClient').mockReturnValue({
      auth: { getClaims: mockGetClaims },
    } as never);

    const req = createMockRequest({
      cookies: { 'sb-access-token': 'token123' },
      url: 'http://localhost/p/iphone-16',
      method: 'GET',
    });

    await proxy(req);
    expect(spy).toHaveBeenCalled();
    expect(mockGetClaims).toHaveBeenCalled();
  });

  it('bypasses Supabase client creation entirely for POST /api/ask and POST /api/recommend', async () => {
    const spy = vi.spyOn(supabaseServerModule, 'createSupabaseProxyClient');

    const reqAsk = createMockRequest({
      cookies: { 'sb-access-token': 'token123' },
      url: 'http://localhost/api/ask',
      method: 'POST',
    });

    await proxy(reqAsk);
    expect(spy).not.toHaveBeenCalled();

    const reqRec = createMockRequest({
      cookies: { 'sb-access-token': 'token123' },
      url: 'http://localhost/api/recommend',
      method: 'POST',
    });

    await proxy(reqRec);
    expect(spy).not.toHaveBeenCalled();
  });
});
