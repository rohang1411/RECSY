import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import * as authModule from '@/services/internal/auth';
import type { AppDb } from '@/services/db/client';

vi.mock('@/services/internal/auth');
vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

describe('Operator Billing Actions API (WP-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized requests with 401', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(false);

    const request = new NextRequest('http://localhost:3000/api/internal/billing/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'grant_credits',
        userId: '11111111-1111-4111-8111-111111111111',
        credits: 5,
        reason: 'Customer dispute resolution',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('grant_credits executes atomic credit delta and returns new balance', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const dbModule = await import('@/services/db/client');
    const mockExecute = vi.fn().mockResolvedValue([{ success: true, new_balance: 15 }]);
    vi.mocked(dbModule.getDb).mockReturnValue({
      execute: mockExecute,
    } as unknown as AppDb);

    const request = new NextRequest('http://localhost:3000/api/internal/billing/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'grant_credits',
        userId: '11111111-1111-4111-8111-111111111111',
        credits: 5,
        reason: 'Connection dropped on committed lease',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.creditsGranted).toBe(5);
    expect(body.result.newBalance).toBe(15);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('set_billing_hold updates user profile', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const dbModule = await import('@/services/db/client');
    const mockExecute = vi.fn().mockResolvedValue([]);
    vi.mocked(dbModule.getDb).mockReturnValue({
      execute: mockExecute,
    } as unknown as AppDb);

    const request = new NextRequest('http://localhost:3000/api/internal/billing/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_billing_hold',
        userId: '11111111-1111-4111-8111-111111111111',
        hold: true,
        reason: 'Dispute investigation in progress',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.billingHold).toBe(true);
  });

  it('create_abuse_block inserts block target with TTL', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const dbModule = await import('@/services/db/client');
    const mockExecute = vi.fn().mockResolvedValue([{ id: 'block-new-1' }]);
    vi.mocked(dbModule.getDb).mockReturnValue({
      execute: mockExecute,
    } as unknown as AppDb);

    const request = new NextRequest('http://localhost:3000/api/internal/billing/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_abuse_block',
        kind: 'ip_key',
        value: 'ip-hash-bad-actor',
        reason: 'High velocity scraping detected',
        ttlHours: 48,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.blockId).toBe('block-new-1');
  });
});
