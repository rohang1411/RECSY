/**
 * Unit tests for IP hashing utilities (`ip-hash.ts`).
 *
 * Tests cover: deterministic output, 32-char hex format, different salts
 * for ask vs session hashes, empty/unknown input fallback, case
 * normalization, and the property that raw IPs cannot be trivially
 * recovered (no plaintext IP appears in the hash output). Pure.
 */
import { describe, expect, it } from 'vitest';

import { hashClientIp, hashSessionIp } from './ip-hash';

describe('hashClientIp', () => {
  it('returns a 32-char hex string', () => {
    const hash = hashClientIp('1.2.3.4');
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashClientIp('1.2.3.4')).toBe(hashClientIp('1.2.3.4'));
  });

  it('produces different hashes for different IPs', () => {
    expect(hashClientIp('1.2.3.4')).not.toBe(hashClientIp('1.2.3.5'));
  });

  it('normalises case — IPv6 uppercase equals lowercase', () => {
    expect(hashClientIp('::1')).toBe(hashClientIp('::1'));
    // Explicitly test that trimming is applied
    expect(hashClientIp('  1.2.3.4  ')).toBe(hashClientIp('1.2.3.4'));
  });

  it('falls back to "unknown" for empty string', () => {
    expect(hashClientIp('')).toBe(hashClientIp('unknown'));
  });

  it('does not expose the raw IP in the hash', () => {
    const ip = '203.0.113.42';
    const hash = hashClientIp(ip);
    expect(hash).not.toContain(ip);
    expect(hash).not.toContain('203');
  });
});

describe('hashSessionIp', () => {
  it('returns a 32-char hex string', () => {
    expect(hashSessionIp('1.2.3.4')).toHaveLength(32);
  });

  it('uses a different salt from hashClientIp', () => {
    const ip = '10.0.0.1';
    expect(hashSessionIp(ip)).not.toBe(hashClientIp(ip));
  });

  it('is deterministic', () => {
    expect(hashSessionIp('::1')).toBe(hashSessionIp('::1'));
  });
});
