import type { MetadataRoute } from 'next';
import { env } from '@/env';
import { getActivePhoneSlugs } from '@/services/cache/public-data';

const STATIC_ROUTES: readonly {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'daily', priority: 1.0 },
  { path: '/pricing', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/recommend', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/browse', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/compare', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/refunds', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.3 },
];

/**
 * Sitemap: static marketing/app routes; active phone pages are appended from public data cache.
 * Contract reference: Plan 26 WP-07 & WP-08.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL);
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: new URL(route.path, site).toString(),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  if (!env.DATABASE_URL?.trim()) {
    return entries;
  }

  try {
    const rows = await getActivePhoneSlugs();

    for (const row of rows) {
      entries.push({
        url: new URL(`/p/${row.slug}`, site).toString(),
        lastModified: row.updatedAt ? new Date(row.updatedAt) : now,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  } catch {
    // Build / preview with no working DB: keep static URLs.
  }

  return entries;
}
