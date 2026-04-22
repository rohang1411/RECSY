import type { MetadataRoute } from 'next';

import { env } from '@/env';

/**
 * PWA / installable metadata (no service worker — shell caching is a future
 * follow-up; see ADR 0010).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RECSY — honest smartphone recommendations',
    short_name: 'RECSY',
    description:
      'Ask what matters. Get the phone that actually fits you — grounded in real reviews, with receipts.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafaf8',
    theme_color: '#111114',
    lang: 'en',
    id: new URL(env.NEXT_PUBLIC_SITE_URL).toString(),
    icons: [
      { src: '/icon', type: 'image/png', sizes: '32x32' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}
