import { asc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';

import { env } from '@/env';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

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
 * Sitemap: static marketing/app routes; active phone pages are appended when a
 * live `DATABASE_URL` is available (e.g. production). Local `next build` in CI
 * typically has no database — static entries still publish.
 */
let cachedPhoneEntries: {
  readonly entries: { slug: string; updatedAt: Date | null }[];
  readonly expiresAtMs: number;
} | null = null;

async function getCachedPhoneRows() {
  const now = Date.now();
  if (cachedPhoneEntries && now < cachedPhoneEntries.expiresAtMs) {
    return cachedPhoneEntries.entries;
  }
  const db = getDb();
  const rows = await db
    .select({ slug: phones.slug, updatedAt: phones.updatedAt })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .orderBy(asc(phones.slug));

  cachedPhoneEntries = { entries: rows, expiresAtMs: now + 3_600_000 };
  return rows;
}

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
    const rows = await getCachedPhoneRows();

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
