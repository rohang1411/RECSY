import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import * as supabaseServerModule from '@/services/auth/supabase-server';
import * as profileModule from '@/services/auth/profile';
import * as claimModule from '@/services/auth/claim-anonymous';
import * as identityModule from '@/services/auth/identity';
import * as dbClientModule from '@/services/db/client';
import type { NextRequest } from 'next/server';

describe('/auth/confirm', () => {
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

  describe('GET /auth/confirm', () => {
    it('serves HTML confirmation page to protect against scanner prefetch', async () => {
      const req = {
        nextUrl: new URL(
          'http://localhost:3000/auth/confirm?token_hash=thash123&type=email&next=/account',
        ),
        url: 'http://localhost:3000/auth/confirm?token_hash=thash123&type=email&next=/account',
      } as unknown as NextRequest;

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Confirm Sign-In');
      expect(html).toContain('Complete Sign-In');
      expect(html).toContain('thash123');
    });

    it('redirects to /login?error=invalid_magic_link if token_hash is missing', async () => {
      const req = {
        nextUrl: new URL('http://localhost:3000/auth/confirm'),
        url: 'http://localhost:3000/auth/confirm',
      } as unknown as NextRequest;

      const res = await GET(req);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login?error=invalid_magic_link');
    });
  });

  describe('POST /auth/confirm', () => {
    it('verifies token hash, creates profile, claims state, and redirects to next', async () => {
      const mockVerify = vi.fn().mockResolvedValue({
        data: { user: { id: 'u-123', email: 'user@example.com' } },
        error: null,
      });
      vi.spyOn(supabaseServerModule, 'createSupabaseServerClient').mockResolvedValue({
        auth: { verifyOtp: mockVerify },
      } as never);

      const formData = new FormData();
      formData.append('token_hash', 'thash123');
      formData.append('type', 'email');
      formData.append('next', '/pricing');

      const req = {
        formData: vi.fn().mockResolvedValue(formData),
        url: 'http://localhost:3000/auth/confirm',
        cookies: {
          get: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as NextRequest;

      const res = await POST(req);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://localhost:3000/pricing');
      expect(mockVerify).toHaveBeenCalledWith(expect.objectContaining({ token_hash: 'thash123' }));
      expect(profileModule.ensureUserProfile).toHaveBeenCalled();
      expect(claimModule.claimAnonymousState).toHaveBeenCalled();
    });
  });
});
