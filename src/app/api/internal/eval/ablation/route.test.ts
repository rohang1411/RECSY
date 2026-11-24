import { describe, it, expect, beforeEach } from 'vitest';
import * as envModule from '@/env';
import { GET, POST } from './route';

describe('Ablation Comparison Internal API Route', () => {
  beforeEach(() => {
    (envModule.env as { INTERNAL_DASHBOARD_ENABLED?: boolean }).INTERNAL_DASHBOARD_ENABLED = true;
  });
  it('GET lists available ablation experiments', async () => {
    const req = new Request('http://localhost:3000/api/internal/eval/ablation', {
      headers: { host: 'localhost:3000' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.ablations).toHaveLength(5);
  });

  it('POST executes ablation comparison and returns statistical report', async () => {
    const req = new Request('http://localhost:3000/api/internal/eval/ablation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({
        ablationType: 'hybrid_vs_dense',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.report.ablationType).toBe('hybrid_vs_dense');
    expect(data.report.delta.relativeGainPercent).toBe(18.0);
  });
});
