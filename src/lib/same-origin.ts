/**
 * CSRF and cross-origin request verification.
 * Normative reference: Plan 25 Section 10.3, Section 15.2.
 *
 * Enforces same-origin verification on mutating non-GET requests under /api and /auth:
 * 1. Pass if `Origin` matches the application's host/origin.
 * 2. Pass if `Origin` is absent and `Sec-Fetch-Site` is `same-origin` or `none`.
 * 3. Pass if both are absent and the request carries no ambient auth credentials (`sb-*`).
 * 4. Otherwise, reject with 403 BAD_ORIGIN.
 */
import type { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';

export function assertSameOrigin(request: NextRequest | Request): void {
  const origin = request.headers.get('origin')?.trim();
  const host =
    request.headers.get('x-forwarded-host')?.trim() || request.headers.get('host')?.trim() || '';

  // 1. Direct Origin header check
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const appHost = host.split(':')[0]?.toLowerCase() ?? '';
      const originHostname = originUrl.hostname.toLowerCase();

      // Check hostname match (or localhost in dev)
      if (
        originHostname === appHost ||
        originUrl.host === host ||
        (originHostname === 'localhost' && appHost === 'localhost') ||
        (originHostname === '127.0.0.1' && appHost === '127.0.0.1')
      ) {
        return;
      }
    } catch {
      // Invalid URL in Origin header
    }

    throw new AppError('BAD_ORIGIN', 'Cross-origin request forbidden', {
      status: 403,
      context: { origin, host },
    });
  }

  // 2. Origin absent — check Sec-Fetch-Site
  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase().trim();
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
    return;
  }

  // 3. Neither Origin nor Sec-Fetch-Site present — check if ambient credentials exist
  const cookieHeader = request.headers.get('cookie') || '';
  const hasAuthCookie = /(?:^|;\s*)sb-[a-zA-Z0-9_-]+-auth-token(?:=|$)/.test(cookieHeader);

  // Non-browser / API client without ambient credentials is safe from CSRF
  if (!hasAuthCookie && !secFetchSite) {
    return;
  }

  throw new AppError('BAD_ORIGIN', 'Cross-origin request forbidden', {
    status: 403,
    context: { secFetchSite, host },
  });
}
