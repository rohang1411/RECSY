import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Computes an HMAC-SHA256 signature in hexadecimal.
 */
export function computeHmacSha256(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Verifies an HMAC-SHA256 hexadecimal signature using constant-time comparison.
 */
export function verifyHmacSha256(message: string, signatureHex: string, secret: string): boolean {
  if (
    typeof message !== 'string' ||
    typeof signatureHex !== 'string' ||
    signatureHex.length !== 64 ||
    !secret
  ) {
    return false;
  }

  const expectedHex = computeHmacSha256(message, secret);
  const sigBuf = Buffer.from(signatureHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (sigBuf.length !== expectedBuf.length || sigBuf.length === 0) {
    return false;
  }

  return timingSafeEqual(sigBuf, expectedBuf);
}
