import { describe, expect, it } from 'vitest';
import { computeHmacSha256, verifyHmacSha256 } from './hmac';

describe('HMAC verification helper', () => {
  const secret = 'super-secret-key-that-is-at-least-32-bytes-long!';
  const message = '1710000000000.{"tags":["phones"],"reason":"catalog-refresh"}';

  it('computes correct hex HMAC and verifies successfully', () => {
    const signature = computeHmacSha256(message, secret);
    expect(signature).toHaveLength(64);
    expect(verifyHmacSha256(message, signature, secret)).toBe(true);
  });

  it('rejects tampered message', () => {
    const signature = computeHmacSha256(message, secret);
    expect(verifyHmacSha256(message + 'extra', signature, secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const signature = computeHmacSha256(message, secret);
    expect(verifyHmacSha256(message, signature, 'wrong-secret-key-with-32-bytes-length!')).toBe(
      false,
    );
  });

  it('rejects invalid signature length or non-hex input', () => {
    expect(verifyHmacSha256(message, 'short-sig', secret)).toBe(false);
    expect(verifyHmacSha256(message, '', secret)).toBe(false);
  });
});
