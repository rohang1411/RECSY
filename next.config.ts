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
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    // Seeded + editorial photos may point at Wikimedia Commons; Supabase
    // storage and OEM CDNs are added the same way as they are onboarded.
    remotePatterns: [
      { protocol: 'https', hostname: 'upload.wikimedia.org', pathname: '/wikipedia/commons/**' },
    ],
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
