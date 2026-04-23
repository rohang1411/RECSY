import { asc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';

import { env } from '@/env';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

const STATIC_PATHS = ['/', '/browse', '/recommend', '/about', '/compare'] as const;

/**
 * Sitemap: static marketing/app routes; active phone pages are appended when a
 * live `DATABASE_URL` is available (e.g. production). Local `next build` in CI
 * typically has no database — static entries still publish.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL);
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: new URL(path, site).toString(),
    lastModified: now,
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.7,
  }));

  if (!env.DATABASE_URL?.trim()) {
    return entries;
  }

  try {
    const db = getDb();
    const rows = await db
      .select({ slug: phones.slug, updatedAt: phones.updatedAt })
      .from(phones)
      .where(eq(phones.status, 'active'))
      .orderBy(asc(phones.slug));

    for (const row of rows) {
      entries.push({
        url: new URL(`/p/${row.slug}`, site).toString(),
        lastModified: row.updatedAt ?? now,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  } catch {
    // Build / preview with no working DB: keep static URLs.
  }

  return entries;
}
