import type { NextRequest } from 'next/server';
import { env } from '@/env';

/**
 * Resolves the canonical base URL (origin) for redirects, OAuth callbacks,
 * and email links.
 *
 * In production/preview environments, request headers (e.g. x-forwarded-host,
 * request.nextUrl.origin) represent the true client-facing origin. Relying on
 * a static build-time NEXT_PUBLIC_SITE_URL causes localhost redirects in preview
 * or production deployments.
 */
export function resolveSiteUrl(request?: NextRequest | Request | null): string {
  if (request) {
    // 1. Forwarded headers (Vercel, Cloudflare, Reverse Proxies) take precedence
    const headers = 'headers' in request ? request.headers : null;
    if (headers) {
      const forwardedHost = headers.get('x-forwarded-host') || headers.get('host');
      const forwardedProto = headers.get('x-forwarded-proto') || 'https';
      if (
        forwardedHost &&
        !forwardedHost.startsWith('internal-') &&
        !forwardedHost.startsWith('10.') &&
        !forwardedHost.startsWith('172.')
      ) {
        return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
      }
    }

    // 2. NextRequest nextUrl.origin
    if ('nextUrl' in request && request.nextUrl?.origin) {
      const origin = request.nextUrl.origin;
      if (origin && !origin.startsWith('null') && !origin.includes('internal-node-listener')) {
        return origin.replace(/\/$/, '');
      }
    }

    // 3. Request.url origin
    if (typeof request.url === 'string' && request.url.startsWith('http')) {
      try {
        const parsed = new URL(request.url);
        if (
          parsed.origin &&
          !parsed.origin.startsWith('null') &&
          !parsed.hostname.includes('internal-node-listener')
        ) {
          return parsed.origin.replace(/\/$/, '');
        }
      } catch {
        // Fall through
      }
    }
  }

  // 4. Vercel deployment variables
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, '');
  }

  // 5. Configured NEXT_PUBLIC_SITE_URL or localhost fallback
  const fallback = env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return fallback.replace(/\/$/, '');
}
