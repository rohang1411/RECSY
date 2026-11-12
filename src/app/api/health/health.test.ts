import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { getDb } from '@/services/db/client';
import { env } from '@/env';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

describe('WP-12: /api/health Liveness and Readiness Probe', () => {
  const mockDb = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
  });

  it('returns 200 with status ok and DB ok when database ping succeeds', async () => {
    mockDb.execute.mockResolvedValueOnce([{ '?column?': 1 }]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('recsy-v2');
    expect(data.db).toBe('ok');
    expect(data.quotaMode).toBe(env.QUOTA_MODE);
    expect(data.billingEnabled).toBe(env.BILLING_ENABLED);
    expect(data.timestamp).toBeDefined();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('returns 503 with status degraded when database ping fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('connection refused'));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('degraded');
    expect(data.db).toBe('degraded');
    expect(data.service).toBe('recsy-v2');
    expect(data.quotaMode).toBe(env.QUOTA_MODE);
  });
});
