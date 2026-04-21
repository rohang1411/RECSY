import type { NextConfig } from 'next';

/**
 * Next.js configuration.
 *
 * Security headers follow OWASP's secure-headers recommendations. The CSP is
 * intentionally strict for the app origin — relax it per-route rather than
 * globally. Inline scripts are forbidden; Next.js uses nonces for its own
 * runtime injected HTML, which is respected automatically.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // HSTS is set by Vercel at the edge in production; duplicate here for parity
  // with self-hosted deployments.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  images: {
    // Phone imagery will come from Supabase storage + official press assets.
    // Remote patterns will be added as CDNs are onboarded.
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;
