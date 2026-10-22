import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import * as driverModule from '@/services/auth/driver';
import type { NextRequest } from 'next/server';

describe('POST /auth/signout', () => {
  it('calls driver.signOut and answers { ok: true }', async () => {
    const mockSignOut = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue({
      getGoogleOAuthUrl: vi.fn(),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: mockSignOut,
    });

    const res = await POST({} as NextRequest);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockSignOut).toHaveBeenCalled();
  });
});
