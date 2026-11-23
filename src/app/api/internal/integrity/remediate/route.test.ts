import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as authModule from '@/services/internal/auth';
import * as remediationModule from '@/services/internal/integrity-remediation';
import { POST } from './route';

vi.mock('@/services/internal/auth');
vi.mock('@/services/internal/integrity-remediation');

describe('POST /api/internal/integrity/remediate (Plan 32 WP-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(body: unknown, traceId = 'trace-test'): NextRequest {
    return new NextRequest('http://localhost:3000/api/internal/integrity/remediate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-trace-id': traceId,
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects unauthorized requests with 401', async () => {
    vi.spyOn(authModule, 'isOperatorAuthorized').mockResolvedValue(false);

    const req = createRequest({ action: 'all' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid action payload with 400 VALIDATION', async () => {
    vi.spyOn(authModule, 'isOperatorAuthorized').mockResolvedValue(true);

    const req = createRequest({ action: 'invalid_action' });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.code).toBe('VALIDATION');
    expect(typeof data.message).toBe('string');
  });

  it('executes remediation when operator is authorized', async () => {
    vi.spyOn(authModule, 'isOperatorAuthorized').mockResolvedValue(true);
    vi.spyOn(remediationModule, 'runIntegrityRemediation').mockResolvedValue({
      success: true,
      action: 'prune_zombie_runs',
      remediated: {
        zombieRunsPruned: 3,
        orphanChunksDeleted: 0,
        invalidPricingIdentified: 0,
      },
      timestamp: '2026-11-23T12:00:00.000Z',
    });

    const req = createRequest({ action: 'prune_zombie_runs' }, 'trace-run-1');
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Trace-Id')).toBe('trace-run-1');
    expect(data.success).toBe(true);
    expect(data.remediated.zombieRunsPruned).toBe(3);
    expect(remediationModule.runIntegrityRemediation).toHaveBeenCalledWith('prune_zombie_runs');
  });
});
