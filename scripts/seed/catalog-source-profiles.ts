/**
 * Seed catalog source profiles.
 *
 * Purpose: configure trusted catalog discovery/enrichment sources without code
 * edits. Initial sources are conservative: Wikidata/Commons are enabled, OEM
 * profiles are seeded disabled until extractor fixtures are implemented.
 *
 * Used by: `scripts/seed/index.ts`.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { catalogSourceProfiles } from '../../src/services/db/schema';

interface CatalogSourceProfileSeed {
  readonly sourceKey: string;
  readonly type: 'wikidata' | 'media' | 'oem_sitemap' | 'licensed_api' | 'aggregator' | 'search';
  readonly priority: number;
  readonly trustWeight: string;
  readonly enabled: boolean;
  readonly baseUrls?: readonly string[];
  readonly sitemapUrls?: readonly string[];
  readonly allowedUrlPatterns?: readonly string[];
  readonly robotsRespected?: boolean;
  readonly rateLimitMs?: number;
  readonly monthlyRequestBudget?: number | null;
  readonly configJson?: Record<string, unknown>;
}

const CATALOG_SOURCE_PROFILE_SEEDS: readonly CatalogSourceProfileSeed[] = [
  {
    sourceKey: 'wikidata',
    type: 'wikidata',
    priority: 80,
    trustWeight: '0.80',
    enabled: true,
    baseUrls: ['https://query.wikidata.org/sparql', 'https://www.wikidata.org/wiki/'],
    robotsRespected: true,
    rateLimitMs: 2_000,
    monthlyRequestBudget: 20,
    configJson: {
      role: 'open-discovery',
      promotion: 'identity-only',
      llmCalls: false,
    },
  },
  {
    sourceKey: 'commons',
    type: 'media',
    priority: 70,
    trustWeight: '0.80',
    enabled: true,
    baseUrls: ['https://commons.wikimedia.org/w/api.php'],
    robotsRespected: true,
    rateLimitMs: 2_000,
    monthlyRequestBudget: 100,
    configJson: {
      role: 'license-checked-media',
      cacheAllowedWhenLicensed: true,
      llmCalls: false,
    },
  },
  {
    sourceKey: 'mobileapi',
    type: 'licensed_api',
    priority: 90,
    trustWeight: '0.90',
    enabled: false,
    baseUrls: ['https://api.mobileapi.dev/'],
    robotsRespected: true,
    rateLimitMs: 12_500,
    monthlyRequestBudget: 50,
    configJson: {
      role: 'licensed-structured-specs',
      promotion: 'allowed_when_phone_spec_projection_valid',
      freePlan: { requestsPerMonth: 50, requestsPerMinute: 5 },
      llmCalls: false,
    },
  },
  {
    sourceKey: 'google-store-us',
    type: 'oem_sitemap',
    priority: 95,
    trustWeight: '0.95',
    enabled: false,
    baseUrls: ['https://store.google.com/'],
    sitemapUrls: ['https://store.google.com/sitemap.xml'],
    allowedUrlPatterns: ['/product/'],
    configJson: { brand: 'Google', regions: ['US'], extractor: 'google-store-v1' },
  },
  {
    sourceKey: 'samsung-us',
    type: 'oem_sitemap',
    priority: 95,
    trustWeight: '0.95',
    enabled: false,
    baseUrls: ['https://www.samsung.com/us/'],
    sitemapUrls: ['https://www.samsung.com/us/sitemap.xml'],
    allowedUrlPatterns: ['/smartphones/', '/galaxy-'],
    configJson: { brand: 'Samsung', regions: ['US'], extractor: 'samsung-us-v1' },
  },
] as const;

export async function seedCatalogSourceProfiles(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<{ upserted: number }> {
  const rows = CATALOG_SOURCE_PROFILE_SEEDS.map((seed) => ({
    sourceKey: seed.sourceKey,
    type: seed.type,
    priority: seed.priority,
    trustWeight: seed.trustWeight,
    enabled: seed.enabled,
    baseUrls: [...(seed.baseUrls ?? [])],
    sitemapUrls: [...(seed.sitemapUrls ?? [])],
    allowedUrlPatterns: [...(seed.allowedUrlPatterns ?? [])],
    robotsRespected: seed.robotsRespected ?? true,
    rateLimitMs: seed.rateLimitMs ?? 3_000,
    monthlyRequestBudget: seed.monthlyRequestBudget ?? null,
    configJson: seed.configJson ?? {},
  }));

  const result = await db
    .insert(catalogSourceProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: catalogSourceProfiles.sourceKey,
      set: {
        type: sql`excluded.type`,
        priority: sql`excluded.priority`,
        trustWeight: sql`excluded.trust_weight`,
        enabled: sql`excluded.enabled`,
        baseUrls: sql`excluded.base_urls`,
        sitemapUrls: sql`excluded.sitemap_urls`,
        allowedUrlPatterns: sql`excluded.allowed_url_patterns`,
        robotsRespected: sql`excluded.robots_respected`,
        rateLimitMs: sql`excluded.rate_limit_ms`,
        monthlyRequestBudget: sql`excluded.monthly_request_budget`,
        configJson: sql`excluded.config_json`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: catalogSourceProfiles.id });

  return { upserted: result.length };
}
