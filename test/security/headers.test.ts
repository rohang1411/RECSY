import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

/**
 * Security Headers Snapshot Test Suite.
 * Normative reference: Plan 25 Section 10.3, Section 10.9.
 *
 * Verifies that all required OWASP security headers, CSP Report-Only,
 * cross-origin isolations, and sensitive route cache controls are properly configured.
 */
describe('Security Headers Configuration', () => {
  it('configures all required global security headers on /:path*', async () => {
    expect(nextConfig.headers).toBeDefined();
    const headersList = await nextConfig.headers!();

    const globalConfig = headersList.find((entry) => entry.source === '/:path*');
    expect(globalConfig).toBeDefined();

    const headerMap = new Map(globalConfig!.headers.map((h) => [h.key, h.value]));

    // 1. Anti-MIME-sniffing
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');

    // 2. Clickjacking defense
    expect(headerMap.get('X-Frame-Options')).toBe('DENY');

    // 3. Referrer leakage prevention
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');

    // 4. Permissions policy
    expect(headerMap.get('Permissions-Policy')).toContain('camera=()');
    expect(headerMap.get('Permissions-Policy')).toContain('microphone=()');
    expect(headerMap.get('Permissions-Policy')).toContain('geolocation=()');

    // 5. HSTS
    expect(headerMap.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(headerMap.get('Strict-Transport-Security')).toContain('includeSubDomains');
    expect(headerMap.get('Strict-Transport-Security')).toContain('preload');

    // 6. Cross-Origin policies
    expect(headerMap.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headerMap.get('Cross-Origin-Resource-Policy')).toBe('same-site');

    // 7. CSP Report-Only Phase 1
    const csp = headerMap.get('Content-Security-Policy-Report-Only');
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain('img-src');
    expect(csp).toContain('https://upload.wikimedia.org');
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('wss://*.supabase.co');
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('restricts caching with "Cache-Control: private, no-store" on sensitive routes', async () => {
    const headersList = await nextConfig.headers!();

    const sensitiveRoutes = [
      '/api/me/:path*',
      '/api/account/:path*',
      '/api/billing/:path((?!catalog$).*)',
      '/auth/:path*',
      '/account/:path*',
    ];

    for (const route of sensitiveRoutes) {
      const entry = headersList.find((h) => h.source === route);
      expect(entry, `Missing headers for sensitive route: ${route}`).toBeDefined();

      const cacheControl = entry!.headers.find((h) => h.key === 'Cache-Control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl!.value).toBe('private, no-store');
    }
  });

  it('disables X-Powered-By header', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
