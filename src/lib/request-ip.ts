import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@/env';

const DEV_FALLBACK_IP_SECRET = 'dev-ip-hash-hmac-secret-min-32-chars-key';

/**
 * Best-effort client IP extraction.
 * In order of trust:
 * 1. env.TRUST_PROXY_HEADER (if explicitly configured by operator)
 * 2. 'cf-connecting-ip' (Cloudflare edge)
 * 3. 'x-vercel-forwarded-for' (Vercel edge)
 * 4. 'x-forwarded-for' (first hop)
 * 5. 'x-real-ip'
 */
export function getRequestClientIp(
  request: NextRequest | { headers: { get: (name: string) => string | null } },
): string {
  if (env.TRUST_PROXY_HEADER) {
    const val = request.headers.get(env.TRUST_PROXY_HEADER)?.trim();
    if (val) {
      const first = val.split(',')[0]?.trim();
      if (first) return first;
    }
  }

  // Check cf-connecting-ip (Cloudflare edge)
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  // Check x-vercel-forwarded-for (injected by Vercel edge)
  const vff = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (vff) {
    const first = vff.split(',')[0]?.trim();
    if (first) return first;
  }

  // Standard x-forwarded-for (leftmost hop)
  const xff = request.headers.get('x-forwarded-for')?.trim();
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return 'unknown';
}

/**
 * Expands an IPv6 address into 8 16-bit hex integers.
 */
function expandIpv6(ip: string): number[] | null {
  // Check for IPv4-mapped IPv6, e.g. ::ffff:192.168.1.1
  const ipv4Match = ip.match(/^(?:.*:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4Match) {
    return null; // Handled as IPv4
  }

  const fullIp = ip;
  if (fullIp.includes(':::')) return null;

  const parts = fullIp.split('::');
  if (parts.length > 2) return null;

  let hextets: number[] = [];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':').map((h) => parseInt(h, 16)) : [];
    const right = parts[1] ? parts[1].split(':').map((h) => parseInt(h, 16)) : [];
    if (left.some(isNaN) || right.some(isNaN)) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    hextets = [...left, ...new Array(missing).fill(0), ...right];
  } else {
    hextets = fullIp.split(':').map((h) => parseInt(h, 16));
    if (hextets.length !== 8 || hextets.some(isNaN)) return null;
  }

  return hextets;
}

/**
 * Returns the subnet prefix:
 * - IPv4: /24 (e.g. 1.2.3.0/24)
 * - IPv6: /56 (e.g. 2001:db8:85a3:800::/56)
 * - Unknown: null
 */
export function getIpPrefix(ip: string): string | null {
  if (!ip || ip === 'unknown') return null;

  // Handle IPv4 (or IPv4-mapped IPv6)
  const ipv4Match = ip.match(/(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = ipv4Match[1];
    const b = ipv4Match[2];
    const c = ipv4Match[3];
    if (a !== undefined && b !== undefined && c !== undefined) {
      const nA = parseInt(a, 10);
      const nB = parseInt(b, 10);
      const nC = parseInt(c, 10);
      if (nA <= 255 && nB <= 255 && nC <= 255) {
        return `${nA}.${nB}.${nC}.0/24`;
      }
    }
  }

  // Handle IPv6
  const hextets = expandIpv6(ip);
  if (
    hextets &&
    hextets.length === 8 &&
    hextets[0] !== undefined &&
    hextets[1] !== undefined &&
    hextets[2] !== undefined &&
    hextets[3] !== undefined
  ) {
    const h0 = hextets[0].toString(16);
    const h1 = hextets[1].toString(16);
    const h2 = hextets[2].toString(16);
    // /56 covers first 48 bits (h0, h1, h2) + upper 8 bits of h3
    const h3Masked = (hextets[3] & 0xff00).toString(16);
    return `${h0}:${h1}:${h2}:${h3Masked}::/56`;
  }

  return null;
}

function getIpHashSecret(): string {
  if (env.IP_HASH_SECRET && env.IP_HASH_SECRET.trim().length >= 16) {
    return env.IP_HASH_SECRET.trim();
  }
  // In production, derive a secure unique secret from server credentials rather than
  // throwing a fatal runtime error that takes down user authentication and API routes.
  if (env.SUPABASE_SERVICE_ROLE_KEY || env.DATABASE_URL) {
    return createHmac('sha256', 'recsy-ip-hash-salt')
      .update(env.SUPABASE_SERVICE_ROLE_KEY || env.DATABASE_URL || '')
      .digest('hex');
  }
  return DEV_FALLBACK_IP_SECRET;
}

/**
 * Produces a deterministic HMAC-SHA256 digest of an IP prefix.
 * Truncated to 32 hex chars.
 */
export function hashIpPrefix(ipPrefix: string): string {
  const secret = getIpHashSecret();
  return createHmac('sha256', secret).update(ipPrefix.trim()).digest('hex').slice(0, 32);
}
