import { describe, expect, it } from 'vitest';
import { buildMeteredRequestSummary } from './summary';

describe('buildMeteredRequestSummary', () => {
  it('constructs summary matching Section 13.2 specification', () => {
    const summary = buildMeteredRequestSummary({
      traceId: 'trace-12345678',
      route: 'POST /api/recommend',
      quotaMode: 'enforce',
      byok: false,
      userId: '11111111-2222-3333-4444-555555555555',
      deviceId: 'dev-abcdef123456',
      chargeSource: 'daily_free',
      outcome: 'committed',
      denial: null,
      reserveMs: 12.3,
      settleMs: 8.7,
      totalMs: 1450.2,
      model: 'gemini-3-flash-preview',
      tokensIn: 500,
      tokensOut: 120,
      costMicros: 73,
      cacheHit: false,
      httpStatus: 200,
    });

    expect(summary.event).toBe('metered_request');
    expect(summary.subjectKind).toBe('user');
    expect(summary.userRef).toBe('11111111');
    expect(summary.deviceRef).toBe('dev-abcd');
    expect(summary.chargeSource).toBe('daily_free');
    expect(summary.outcome).toBe('committed');
    expect(summary.reserveMs).toBe(12);
    expect(summary.settleMs).toBe(9);
    expect(summary.totalMs).toBe(1450);
    expect(summary.httpStatus).toBe(200);
  });

  it('marks subjectKind as byok when byok is true', () => {
    const summary = buildMeteredRequestSummary({
      traceId: 'trace-1',
      route: 'POST /api/ask',
      quotaMode: 'enforce',
      byok: true,
      deviceId: 'dev-1',
      outcome: 'committed',
      reserveMs: 5,
      settleMs: 5,
      totalMs: 500,
      httpStatus: 200,
    });

    expect(summary.subjectKind).toBe('byok');
  });

  it('marks subjectKind as ip when deviceId starts with nocookie:', () => {
    const summary = buildMeteredRequestSummary({
      traceId: 'trace-1',
      route: 'POST /api/ask',
      quotaMode: 'enforce',
      byok: false,
      deviceId: 'nocookie:ipkey123',
      outcome: 'denied',
      denial: 'ANON_IP_CAP',
      reserveMs: 5,
      settleMs: 0,
      totalMs: 5,
      httpStatus: 402,
    });

    expect(summary.subjectKind).toBe('ip');
    expect(summary.denial).toBe('ANON_IP_CAP');
  });
});
