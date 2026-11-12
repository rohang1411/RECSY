import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from './route';
import * as driverModule from '@/services/auth/driver';
import * as profileModule from '@/services/auth/profile';
import * as claimModule from '@/services/auth/claim-anonymous';
import * as identityModule from '@/services/auth/identity';
import * as dbClientModule from '@/services/db/client';
import type { NextRequest } from 'next/server';

function createMockRequest(body: unknown): NextRequest {
  const jsonStr = JSON.stringify(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(jsonStr));
      controller.close();
    },
  });

  return {
    body: stream,
    headers: new Map([['content-type', 'application/json']]),
    cookies: {
      get: vi.fn().mockReturnValue(undefined),
    },
  } as unknown as NextRequest;
}

describe('POST /auth/otp/verify', () => {
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

  it('rejects missing email or token with 400', async () => {
    const req = createMockRequest({ email: 'user@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/required/i);
  });

  it('returns 400 when OTP token is invalid or expired', async () => {
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue({
      getGoogleOAuthUrl: vi.fn(),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn().mockResolvedValue({ user: null }),
      signOut: vi.fn(),
    });

    const req = createMockRequest({ email: 'user@example.com', token: '000000' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid or expired/i);
  });

  it('verifies valid OTP, ensures user profile, and graduates anonymous state', async () => {
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue({
      getGoogleOAuthUrl: vi.fn(),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn().mockResolvedValue({
        user: { id: 'u-123', email: 'user@example.com' },
      }),
      signOut: vi.fn(),
    });

    const req = createMockRequest({ email: 'user@example.com', token: '123456' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.user.id).toBe('u-123');
    expect(profileModule.ensureUserProfile).toHaveBeenCalled();
    expect(claimModule.claimAnonymousState).toHaveBeenCalled();
  });
});
