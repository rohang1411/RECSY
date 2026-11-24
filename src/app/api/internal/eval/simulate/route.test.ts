import { describe, it, expect, beforeEach } from 'vitest';
import * as envModule from '@/env';
import { GET, POST } from './route';

describe('Simulation Internal API Route', () => {
  beforeEach(() => {
    (envModule.env as { INTERNAL_DASHBOARD_ENABLED?: boolean }).INTERNAL_DASHBOARD_ENABLED = true;
  });
  it('GET returns full inventory of golden personas and QA queries for simulation', async () => {
    const req = new Request('http://localhost:3000/api/internal/eval/simulate', {
      headers: { host: 'localhost:3000' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.totalPersonas).toBe(45);
    expect(data.totalQaQueries).toBe(30);
  });

  it('POST runs simulation on a golden recommender persona and returns side-by-side results', async () => {
    const req = new Request('http://localhost:3000/api/internal/eval/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({
        queryType: 'recommender',
        caseId: 'rec-001',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.simulation.caseId).toBe('rec-001');
    expect(data.simulation.stageTimings).toBeDefined();
    expect(data.simulation.egressMetrics.safeUnderFreeTierLimit).toBe(true);
  });

  it('POST validates malformed payload', async () => {
    const req = new Request('http://localhost:3000/api/internal/eval/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({
        queryType: 'invalid-type-123',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
