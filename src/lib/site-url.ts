import type { NextRequest } from 'next/server';
import { env } from '@/env';

/**
 * Validates whether a candidate hostname belongs to the application.
 * Prevents host-header poisoning attacks and unverified origin spoofing.
 */
export function isTrustedSiteHost(host: string | null | undefined): boolean {
  if (!host || typeof host !== 'string') return false;
  const cleanHost = host.split(':')[0]?.trim().toLowerCase() ?? '';
  if (!cleanHost) return false;

  // 1. Local loopback / dev
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
    return true;
  }

  // 2. Configured NEXT_PUBLIC_SITE_URL host
  try {
    const configured = new URL(env.NEXT_PUBLIC_SITE_URL).hostname.toLowerCase();
    if (cleanHost === configured) {
      return true;
    }
  } catch {
    // Ignore invalid configured URL
  }

  // 3. Vercel deployment variables
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    if (cleanHost === process.env.VERCEL_PROJECT_PRODUCTION_URL.toLowerCase()) {
      return true;
    }
  }
  if (process.env.VERCEL_URL) {
    if (cleanHost === process.env.VERCEL_URL.toLowerCase()) {
      return true;
    }
  }

  // 4. Primary application domains & Vercel preview wildcards
  if (
    cleanHost === 'recsy.com' ||
    cleanHost.endsWith('.recsy.com') ||
    cleanHost === 'recsy.app' ||
    cleanHost.endsWith('.recsy.app') ||
    cleanHost.endsWith('.vercel.app')
  ) {
    return true;
  }

  return false;
}

/**
 * Resolves the canonical base URL (origin) for redirects, OAuth callbacks,
 * and email links.
 *
 * In production/preview environments, request headers (e.g. x-forwarded-host,
 * request.nextUrl.origin) represent the true client-facing origin.
 *
 * Security: strictly validates hostnames against `isTrustedSiteHost` to prevent
 * Host Header / X-Forwarded-Host injection and password reset / OAuth poisoning.
 */
export function resolveSiteUrl(request?: NextRequest | Request | null): string {
  if (request) {
    // 1. Forwarded headers (Vercel, Cloudflare, Reverse Proxies) take precedence if trusted
    const headers = 'headers' in request ? request.headers : null;
    if (headers) {
      const forwardedHost = headers.get('x-forwarded-host')?.trim();
      const directHost = headers.get('host')?.trim();
      const candidateHost =
        forwardedHost && isTrustedSiteHost(forwardedHost)
          ? forwardedHost
          : directHost && isTrustedSiteHost(directHost)
            ? directHost
            : null;

      const forwardedProto = headers.get('x-forwarded-proto') || 'https';
      if (candidateHost) {
        return `${forwardedProto}://${candidateHost}`.replace(/\/$/, '');
      }
    }

    // 2. NextRequest nextUrl.origin
    if ('nextUrl' in request && request.nextUrl?.origin) {
      const origin = request.nextUrl.origin;
      try {
        const parsed = new URL(origin);
        if (isTrustedSiteHost(parsed.host)) {
          return origin.replace(/\/$/, '');
        }
      } catch {
        // Fall through
      }
    }

    // 3. Request.url origin
    if (typeof request.url === 'string' && request.url.startsWith('http')) {
      try {
        const parsed = new URL(request.url);
        if (isTrustedSiteHost(parsed.host)) {
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
