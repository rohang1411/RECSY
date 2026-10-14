import type { MetadataRoute } from 'next';

import { env } from '@/env';

export default function robots(): MetadataRoute.Robots {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL);
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/internal/', '/api/internal/'],
    },
    sitemap: new URL('sitemap.xml', site).toString(),
  };
}
