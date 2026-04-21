import { createHash } from 'node:crypto';

/** Deterministic short hash for rate-limit keys — not reversible to an IP. */
export function hashClientIp(ip: string): string {
  const normalised = ip.trim().toLowerCase() || 'unknown';
  return createHash('sha256')
    .update(`recsy|ask|v1|${normalised}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}
