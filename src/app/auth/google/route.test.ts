import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import * as driverModule from '@/services/auth/driver';
import type { NextRequest } from 'next/server';

describe('GET /auth/google', () => {
  it('redirects to Google OAuth URL returned by the driver', async () => {
    const mockDriver = {
      getGoogleOAuthUrl: vi
        .fn()
        .mockResolvedValue('https://accounts.google.com/o/oauth2/auth?client_id=123'),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    };
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue(mockDriver);

    const req = {
      nextUrl: new URL('http://localhost:3000/auth/google?next=/recommend'),
      url: 'http://localhost:3000/auth/google?next=/recommend',
    } as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://accounts.google.com/o/oauth2/auth?client_id=123',
    );
    expect(mockDriver.getGoogleOAuthUrl).toHaveBeenCalledWith(
      '/recommend',
      expect.objectContaining({ siteUrl: expect.any(String) }),
    );
  });

  it('falls back to /login?error=oauth_init_failed on driver error', async () => {
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue({
      getGoogleOAuthUrl: vi.fn().mockRejectedValue(new Error('OAuth failed')),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    });

    const req = {
      nextUrl: new URL('http://localhost:3000/auth/google'),
      url: 'http://localhost:3000/auth/google',
    } as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?error=oauth_init_failed');
  });
});
