import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import * as authModule from '@/services/internal/auth';
import type { AppDb } from '@/services/db/client';

vi.mock('@/services/internal/auth');
vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));
vi.mock('@/services/metering/platform', () => ({
  resetPlatformStateCache: vi.fn(),
}));

describe('Operator Flags API (WP-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/internal/flags returns 401 when unauthorized', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(false);

    const request = new NextRequest('http://localhost:3000/api/internal/flags');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('GET /api/internal/flags returns platform flags when authorized', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const dbModule = await import('@/services/db/client');
    vi.mocked(dbModule.getDb).mockReturnValue({
      execute: vi.fn().mockResolvedValue([
        {
          key: 'kill_switch',
          value: { enabled: false },
          updated_at: '2026-10-21T10:00:00Z',
          updated_by: 'operator',
        },
      ]),
    } as unknown as AppDb);

    const request = new NextRequest('http://localhost:3000/api/internal/flags');
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.flags.kill_switch).toBeDefined();
    expect(body.flags.kill_switch.value.enabled).toBe(false);
  });

  it('POST /api/internal/flags rejects missing reason with 400', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const request = new NextRequest('http://localhost:3000/api/internal/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'kill_switch',
        value: { enabled: true },
        reason: 'no', // too short (<3)
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('POST /api/internal/flags updates flag and records audit log', async () => {
    vi.mocked(authModule.isOperatorAuthorized).mockResolvedValue(true);

    const dbModule = await import('@/services/db/client');
    const mockExecute = vi
      .fn()
      .mockResolvedValueOnce([{ value: { enabled: false } }]) // fetch before
      .mockResolvedValueOnce([]); // upsert

    vi.mocked(dbModule.getDb).mockReturnValue({
      execute: mockExecute,
    } as unknown as AppDb);

    const request = new NextRequest('http://localhost:3000/api/internal/flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'kill_switch',
        value: { enabled: true },
        reason: 'Emergency load shedding drill',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.key).toBe('kill_switch');
    expect(body.value.enabled).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
