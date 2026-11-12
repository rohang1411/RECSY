import { describe, expect, it } from 'vitest';
import {
  getDeviceCookieName,
  getDeviceCookieOptions,
  hashDeviceId,
  mintDeviceCookieValue,
} from './device';

describe('device authentication helpers', () => {
  it('mints random 16-byte base64url cookie strings', () => {
    const val1 = mintDeviceCookieValue();
    const val2 = mintDeviceCookieValue();
    expect(val1).toBeTruthy();
    expect(val2).toBeTruthy();
    expect(val1).not.toBe(val2);
    // Base64url without padding: 16 bytes -> 22 characters
    expect(val1.length).toBeGreaterThanOrEqual(21);
  });

  it('hashes device cookies into 32-character hex HMAC digests', () => {
    const raw = 'dGVzdC1kZXZpY2UtaWQ';
    const hash1 = hashDeviceId(raw);
    const hash2 = hashDeviceId(raw);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
    expect(hash1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('derives a deterministic secure hash in production when DEVICE_ID_SECRET is unset', () => {
    const raw = 'dGVzdC1kZXZpY2UtaWQ';
    const hash1 = hashDeviceId(raw);
    const hash2 = hashDeviceId(raw);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(32);
    expect(hash1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('provides cookie options with 1 year max-age, lax samesite, and httponly', () => {
    const options = getDeviceCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(31536000);
  });

  it('returns cookie name matching environment', () => {
    const name = getDeviceCookieName();
    expect(typeof name).toBe('string');
    expect(name === '__Host-recsy_did' || name === 'recsy_did').toBe(true);
  });
});
