import type { NextRequest } from 'next/server';

/**
 * Best-effort client IP for rate limiting. Prefer `x-forwarded-for` first hop
 * when behind Vercel / proxies; never log raw IPs — hash at the callsite.
 */
export function getRequestClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}
