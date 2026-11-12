import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './route';
import * as supabaseServerModule from '@/services/auth/supabase-server';
import * as profileModule from '@/services/auth/profile';
import * as claimModule from '@/services/auth/claim-anonymous';
import * as identityModule from '@/services/auth/identity';
import * as dbClientModule from '@/services/db/client';
import type { NextRequest } from 'next/server';

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dbClientModule, 'getDb').mockReturnValue({} as never);
    vi.spyOn(profileModule, 'ensureUserProfile').mockResolvedValue({
      id: 'u-123',
      email: 'user@example.com',
      email_normalized: 'user@example.com',
    });
    vi.spyOn(claimModule, 'claimAnonymousState').mockResolvedValue({ success: true });
    vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
      userId: 'u-123',
      emailVerified: true,
      deviceId: 'dev-456',
      deviceCookieIsNew: false,
      ipKey: 'ip-789',
      ipHashForRateLimit: 'hash',
      isSuspended: false,
    });
  });

  it('exchanges PKCE code, sets up profile, and redirects to safe return URL', async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      data: { user: { id: 'u-123', email: 'user@example.com' } },
      error: null,
    });
    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
    } as never);

    const req = {
      nextUrl: new URL('http://localhost:3000/auth/callback?code=pkce-code-123&next=/recommend'),
      url: 'http://localhost:3000/auth/callback?code=pkce-code-123&next=/recommend',
      cookies: {
        get: vi.fn().mockReturnValue(undefined),
      },
    } as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:3000/recommend');
    expect(mockExchange).toHaveBeenCalledWith('pkce-code-123');
    expect(profileModule.ensureUserProfile).toHaveBeenCalled();
    expect(claimModule.claimAnonymousState).toHaveBeenCalled();
  });

  it('redirects to /login?error=auth_exchange_failed when exchange fails', async () => {
    vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: new Error('fail') }),
      },
    } as never);

    const req = {
      nextUrl: new URL('http://localhost:3000/auth/callback?code=bad-code'),
      url: 'http://localhost:3000/auth/callback?code=bad-code',
      cookies: {
        get: vi.fn().mockReturnValue(undefined),
      },
    } as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=auth_exchange_failed');
  });
});
