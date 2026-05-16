/**
 * Unit tests for client IP extraction (`request-ip.ts`).
 *
 * Tests cover: `x-forwarded-for` first-hop extraction, multiple-proxy
 * chain (uses leftmost), `x-real-ip` fallback, combined header
 * preference, and fallback to 'unknown' when no headers are present.
 *
 * Uses a minimal `NextRequest`-compatible mock — no actual HTTP I/O.
 */
import { describe, expect, it } from 'vitest';

import { getRequestClientIp } from './request-ip';

function makeRequest(headers: Record<string, string>): {
  headers: { get: (key: string) => string | null };
} {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  };
}

describe('getRequestClientIp', () => {
  it('returns the first IP from x-forwarded-for', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4' });
    expect(getRequestClientIp(req as never)).toBe('1.2.3.4');
  });

  it('returns the leftmost IP from a multi-proxy x-forwarded-for chain', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.1' });
    expect(getRequestClientIp(req as never)).toBe('1.2.3.4');
  });

  it('trims whitespace from x-forwarded-for values', () => {
    const req = makeRequest({ 'x-forwarded-for': '  5.6.7.8  , 192.168.1.1' });
    expect(getRequestClientIp(req as never)).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = makeRequest({ 'x-real-ip': '9.10.11.12' });
    expect(getRequestClientIp(req as never)).toBe('9.10.11.12');
  });

  it('prefers x-forwarded-for over x-real-ip when both are present', () => {
    const req = makeRequest({
      'x-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
    });
    expect(getRequestClientIp(req as never)).toBe('1.1.1.1');
  });

  it('returns "unknown" when no IP headers are present', () => {
    const req = makeRequest({});
    expect(getRequestClientIp(req as never)).toBe('unknown');
  });

  it('returns "unknown" when x-real-ip is empty after trim', () => {
    const req = makeRequest({ 'x-real-ip': '   ' });
    expect(getRequestClientIp(req as never)).toBe('unknown');
  });

  it('handles IPv6 addresses', () => {
    const req = makeRequest({ 'x-forwarded-for': '::1' });
    expect(getRequestClientIp(req as never)).toBe('::1');
  });
});
