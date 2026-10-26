import { describe, expect, it } from 'vitest';
import { getIpPrefix, getRequestClientIp, hashIpPrefix } from './request-ip';
import { env } from '@/env';

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
  it('prefers cf-connecting-ip when present', () => {
    const req = makeRequest({
      'cf-connecting-ip': '198.51.100.42',
      'x-vercel-forwarded-for': '203.0.113.195',
      'x-forwarded-for': 'spoofed.ip',
    });
    expect(getRequestClientIp(req as never)).toBe('198.51.100.42');
  });

  it('returns the first IP from x-forwarded-for', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4' });
    expect(getRequestClientIp(req as never)).toBe('1.2.3.4');
  });

  it('returns the leftmost IP from a multi-proxy x-forwarded-for chain', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.1' });
    expect(getRequestClientIp(req as never)).toBe('1.2.3.4');
  });

  it('prefers x-vercel-forwarded-for when present', () => {
    const req = makeRequest({
      'x-vercel-forwarded-for': '203.0.113.195',
      'x-forwarded-for': 'spoofed.ip, 10.0.0.1',
    });
    expect(getRequestClientIp(req as never)).toBe('203.0.113.195');
  });

  it('trims whitespace from x-forwarded-for values', () => {
    const req = makeRequest({ 'x-forwarded-for': '  5.6.7.8  , 192.168.1.1' });
    expect(getRequestClientIp(req as never)).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = makeRequest({ 'x-real-ip': '9.10.11.12' });
    expect(getRequestClientIp(req as never)).toBe('9.10.11.12');
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

describe('getIpPrefix', () => {
  it('truncates IPv4 to /24 prefix', () => {
    expect(getIpPrefix('192.168.1.123')).toBe('192.168.1.0/24');
    expect(getIpPrefix('10.20.30.40')).toBe('10.20.30.0/24');
  });

  it('truncates IPv4-mapped IPv6 to /24 prefix', () => {
    expect(getIpPrefix('::ffff:192.168.1.123')).toBe('192.168.1.0/24');
  });

  it('truncates IPv6 to /56 prefix', () => {
    expect(getIpPrefix('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:800::/56');
    expect(getIpPrefix('2001:db8:85a3:f4f::1')).toBe('2001:db8:85a3:f00::/56');
    expect(getIpPrefix('::1')).toBe('0:0:0:0::/56');
  });

  it('returns null for unknown or invalid IP', () => {
    expect(getIpPrefix('unknown')).toBeNull();
    expect(getIpPrefix('')).toBeNull();
    expect(getIpPrefix('not-an-ip')).toBeNull();
  });
});

describe('hashIpPrefix', () => {
  it('produces a deterministic 32-character hex HMAC digest', () => {
    const prefix = '192.168.1.0/24';
    const h1 = hashIpPrefix(prefix);
    const h2 = hashIpPrefix(prefix);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(32);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('derives a deterministic secure hash in production when IP_HASH_SECRET is unset', () => {
    const origEnv = { ...env };
    const envMut = env as unknown as Record<string, unknown>;
    try {
      envMut.NODE_ENV = 'production';
      envMut.IP_HASH_SECRET = undefined;
      const h1 = hashIpPrefix('192.168.1.0/24');
      const h2 = hashIpPrefix('192.168.1.0/24');
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(32);
      expect(h1).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.assign(env, origEnv);
    }
  });
});
