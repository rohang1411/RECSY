import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from './route';
import * as driverModule from '@/services/auth/driver';
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
  } as unknown as NextRequest;
}

describe('POST /auth/otp/send', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid email addresses with 400', async () => {
    const req = createMockRequest({ email: 'not-an-email' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/valid email/i);
  });

  it('rejects disposable email addresses with 400', async () => {
    vi.spyOn(dbClientModule, 'getDb').mockReturnValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);

    const req = createMockRequest({ email: 'user@mailinator.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/disposable.*not accepted/i);
  });

  it('calls driver.sendOtp and answers sent: true for valid emails', async () => {
    vi.spyOn(dbClientModule, 'getDb').mockReturnValue({
      execute: vi.fn().mockResolvedValue([]),
    } as never);

    const mockDriver = {
      getGoogleOAuthUrl: vi.fn(),
      sendOtp: vi.fn().mockResolvedValue({ sent: true }),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    };
    vi.spyOn(driverModule, 'getAuthDriver').mockReturnValue(mockDriver);

    const req = createMockRequest({ email: 'genuine.user@gmail.com' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sent).toBe(true);
    expect(mockDriver.sendOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'genuine.user@gmail.com' }),
    );
  });
});
