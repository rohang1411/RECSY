/**
 * Public data cache with tag-based revalidation (Plan 26 WP-07).
 *
 * Exclusively responsible for wrapping public, non-personal queries in `unstable_cache`.
 * Contract rules:
 * - R4: Caches never decide access (only non-personal, public catalog data).
 * - R5: No request-time APIs (cookies, headers, searchParams) inside cached functions.
 * - All dates converted explicitly to ISO strings so serialisation is deterministic.
 * - All cache keys include `env.DATABASE_SCHEMA` so eval environments stay isolated.
 * - Bypasses cache when `platform.perf.public_data_cache` is false.
 * - Gracefully falls back to direct query when running outside Next.js request context (e.g. unit tests).
 */
import { unstable_cache } from 'next/cache';
import { and, asc, eq } from 'drizzle-orm';
import { env } from '@/env';
import { isSupportedRegion } from '@/lib/regions';
import type { AppQueryDb } from '@/services/db/client';
import { getDb } from '@/services/db/client';
import { aspectDefinitions, aspects, phones, phoneRegionalDetails } from '@/services/db/schema';
import { getPerfFlags } from '@/services/metering/platform';
import { DEFAULT_PERF_FLAGS } from '@/services/perf/flags';
import { TAGS } from './tags';
import type { BrowseFilterState } from '@/features/browse/search-params';
import { browseWhereFromState, getBrowseOrderBy } from '@/features/browse/query';
import type { AspectDefinitionRow } from '@/services/scorecard/types';

let cacheEnabledOverride: boolean | null = null;

export function setPublicDataCacheEnabledForTest(enabled: boolean | null): void {
  cacheEnabledOverride = enabled;
}

export async function isPublicDataCacheEnabled(): Promise<boolean> {
  if (cacheEnabledOverride !== null) {
    return cacheEnabledOverride;
  }
  try {
    const flags = await getPerfFlags(getDb());
    return flags.public_data_cache;
  } catch {
    return DEFAULT_PERF_FLAGS.public_data_cache;
  }
}

/**
 * Executes a cached function, gracefully falling back to direct query if
 * Next.js incrementalCache is missing (e.g. outside Next.js server runtime).
 */
async function runWithCacheFallback<T>(
  cacheFn: () => Promise<T>,
  directFn: () => Promise<T>,
): Promise<T> {
  try {
    return await cacheFn();
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes('incrementalCache missing') ||
        err.message.includes('Invariant: incrementalCache'))
    ) {
      return directFn();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 1. Phone page data
// ---------------------------------------------------------------------------

export interface PhoneRegionalPrice {
  readonly price: string | null;
  readonly currency: string | null;
  readonly isEstimated: boolean | null;
  readonly isAvailable: boolean | null;
}

export interface PhonePageData {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly status: string;
  readonly msrpUsd: string | null;
  readonly imageUrl: string | null;
  readonly specJson: unknown;
  readonly regionalPrices: Record<string, PhoneRegionalPrice>;
  readonly localPrice?: string | null;
  readonly isEstimated?: boolean | null;
}

async function fetchPhonePageData(slug: string): Promise<PhonePageData | null> {
  const db = getDb();
  const [phone] = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      status: phones.status,
      msrpUsd: phones.msrpUsd,
      imageUrl: phones.imageUrl,
      specJson: phones.specJson,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);

  if (!phone) {
    return null;
  }

  const regionalRows = await db
    .select({
      countryCode: phoneRegionalDetails.countryCode,
      price: phoneRegionalDetails.price,
      currency: phoneRegionalDetails.currency,
      isEstimated: phoneRegionalDetails.isEstimated,
      isAvailable: phoneRegionalDetails.isAvailable,
    })
    .from(phoneRegionalDetails)
    .where(eq(phoneRegionalDetails.phoneId, phone.id));

  const regionalPrices: Record<string, PhoneRegionalPrice> = {};
  for (const r of regionalRows) {
    regionalPrices[r.countryCode] = {
      price: r.price,
      currency: r.currency,
      isEstimated: r.isEstimated,
      isAvailable: r.isAvailable,
    };
  }

  const defaultDetail = regionalPrices['US'];

  return {
    ...phone,
    regionalPrices,
    localPrice: defaultDetail?.price ?? phone.msrpUsd,
    isEstimated: defaultDetail?.isEstimated ?? false,
  };
}

export async function getPhonePageData(
  slug: string,
  region?: string,
): Promise<PhonePageData | null> {
  if (region && !isSupportedRegion(region.trim().toUpperCase())) {
    throw new Error(`Unsupported region code: ${region}`);
  }
  const cleanSlug = slug.trim().toLowerCase();
  const enabled = await isPublicDataCacheEnabled();

  let data: PhonePageData | null;
  if (!enabled) {
    data = await fetchPhonePageData(cleanSlug);
  } else {
    const cached = unstable_cache(
      () => fetchPhonePageData(cleanSlug),
      ['phone-page', env.DATABASE_SCHEMA, cleanSlug],
      {
        revalidate: 600,
        tags: [TAGS.phones, TAGS.phone(cleanSlug)],
      },
    );
    data = await runWithCacheFallback(cached, () => fetchPhonePageData(cleanSlug));
  }

  if (!data) return null;

  if (region) {
    const reg = region.trim().toUpperCase();
    const detail = data.regionalPrices[reg];
    return {
      ...data,
      localPrice: detail?.price ?? data.msrpUsd,
      isEstimated: detail?.isEstimated ?? false,
    };
  }

  return data;
}

// ---------------------------------------------------------------------------
// 2. Scorecard
// ---------------------------------------------------------------------------

export interface ScorecardAspectRow {
  readonly aspect: string;
  readonly score: string;
  readonly confidence: string;
  readonly summary: string | null;
  readonly nSupporting: number;
  readonly nDissenting: number;
}

async function fetchScorecard(phoneId: string): Promise<readonly ScorecardAspectRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      aspect: aspectDefinitions.aspect,
      score: aspects.score,
      confidence: aspects.confidence,
      summary: aspects.summary,
      nSupporting: aspects.nSupporting,
      nDissenting: aspects.nDissenting,
    })
    .from(aspects)
    .innerJoin(aspectDefinitions, eq(aspects.aspectDefinitionId, aspectDefinitions.id))
    .where(eq(aspects.phoneId, phoneId));

  return rows.map((r) => ({
    aspect: r.aspect,
    score: String(r.score),
    confidence: String(r.confidence),
    summary: r.summary,
    nSupporting: r.nSupporting,
    nDissenting: r.nDissenting,
  }));
}

export async function getScorecard(phoneId: string): Promise<readonly ScorecardAspectRow[]> {
  const cleanId = phoneId.trim().toLowerCase();
  const enabled = await isPublicDataCacheEnabled();
  if (!enabled) {
    return fetchScorecard(cleanId);
  }

  const cached = unstable_cache(
    () => fetchScorecard(cleanId),
    ['scorecard', env.DATABASE_SCHEMA, cleanId],
    {
      revalidate: 600,
      tags: [TAGS.scorecard(cleanId)],
    },
  );
  return runWithCacheFallback(cached, () => fetchScorecard(cleanId));
}

// ---------------------------------------------------------------------------
// 3. Browse results
// ---------------------------------------------------------------------------

export interface BrowseResultRow {
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly msrpUsd: string | null;
  readonly imageUrl: string | null;
  readonly launchDate: string | null;
  readonly releasedAt: string | null;
  readonly localPrice: string | null;
  readonly localCurrency: string | null;
  readonly isEstimated: boolean | null;
  readonly isAvailable: boolean | null;
}

function countActiveBrowseDimensions(filter: BrowseFilterState): number {
  let count = 0;
  if (filter.brands.length > 0) count++;
  if (filter.minPriceUsd !== null || filter.maxPriceUsd !== null) count++;
  if (filter.foldable !== 'any') count++;
  if (filter.sort !== 'latest') count++;
  return count;
}

function buildCanonicalFilterKey(filter: BrowseFilterState): string {
  const sortedBrands = [...filter.brands]
    .map((b) => b.trim().toLowerCase())
    .sort()
    .join(',');
  return `b:${sortedBrands}|min:${filter.minPriceUsd ?? ''}|max:${filter.maxPriceUsd ?? ''}|f:${filter.foldable}|s:${filter.sort}`;
}

async function fetchBrowseResults(
  filter: BrowseFilterState,
  region: string,
): Promise<readonly BrowseResultRow[]> {
  const db = getDb();
  const where = browseWhereFromState(filter, region);
  const rows = await db
    .select({
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      msrpUsd: phones.msrpUsd,
      imageUrl: phones.imageUrl,
      launchDate: phones.launchDate,
      releasedAt: phones.releasedAt,
      localPrice: phoneRegionalDetails.price,
      localCurrency: phoneRegionalDetails.currency,
      isEstimated: phoneRegionalDetails.isEstimated,
      isAvailable: phoneRegionalDetails.isAvailable,
    })
    .from(phones)
    .leftJoin(
      phoneRegionalDetails,
      and(
        eq(phoneRegionalDetails.phoneId, phones.id),
        eq(phoneRegionalDetails.countryCode, region),
      ),
    )
    .where(where)
    .orderBy(...getBrowseOrderBy(filter.sort))
    .limit(100);

  return rows.map((r) => ({
    slug: r.slug,
    brand: r.brand,
    model: r.model,
    tagline: r.tagline,
    msrpUsd: r.msrpUsd,
    imageUrl: r.imageUrl,
    launchDate: r.launchDate ? new Date(r.launchDate).toISOString() : null,
    releasedAt: r.releasedAt ? new Date(r.releasedAt).toISOString() : null,
    localPrice: r.localPrice,
    localCurrency: r.localCurrency,
    isEstimated: r.isEstimated,
    isAvailable: r.isAvailable,
  }));
}

export async function getBrowseResults(
  filter: BrowseFilterState,
  region: string,
): Promise<readonly BrowseResultRow[]> {
  const reg = region.trim().toUpperCase();
  if (!isSupportedRegion(reg)) {
    throw new Error(`Unsupported region code: ${region}`);
  }

  const enabled = await isPublicDataCacheEnabled();
  const activeDims = countActiveBrowseDimensions(filter);

  // If cache is disabled or filter has more than 3 active dimensions, query directly
  if (!enabled || activeDims > 3) {
    return fetchBrowseResults(filter, reg);
  }

  const filterKey = buildCanonicalFilterKey(filter);
  const cached = unstable_cache(
    () => fetchBrowseResults(filter, reg),
    ['browse', env.DATABASE_SCHEMA, filterKey, reg],
    {
      revalidate: 600,
      tags: [TAGS.phones, TAGS.browse],
    },
  );
  return runWithCacheFallback(cached, () => fetchBrowseResults(filter, reg));
}

// ---------------------------------------------------------------------------
// 4. Active brands
// ---------------------------------------------------------------------------

async function fetchActiveBrands(): Promise<readonly string[]> {
  const db = getDb();
  const brandRows = await db
    .select({ brand: phones.brand })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .groupBy(phones.brand)
    .orderBy(asc(phones.brand));

  return brandRows.map((r) => r.brand);
}

export async function getActiveBrands(): Promise<readonly string[]> {
  const enabled = await isPublicDataCacheEnabled();
  if (!enabled) {
    return fetchActiveBrands();
  }

  const cached = unstable_cache(() => fetchActiveBrands(), ['brands', env.DATABASE_SCHEMA], {
    revalidate: 3600,
    tags: [TAGS.phones],
  });
  return runWithCacheFallback(cached, () => fetchActiveBrands());
}

// ---------------------------------------------------------------------------
// 5. Active phone slugs (sitemap)
// ---------------------------------------------------------------------------

export interface ActivePhoneSlugEntry {
  readonly slug: string;
  readonly updatedAt: string | null;
}

async function fetchActivePhoneSlugs(): Promise<readonly ActivePhoneSlugEntry[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: phones.slug, updatedAt: phones.updatedAt })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .orderBy(asc(phones.slug));

  return rows.map((r) => ({
    slug: r.slug,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  }));
}

export async function getActivePhoneSlugs(): Promise<readonly ActivePhoneSlugEntry[]> {
  const enabled = await isPublicDataCacheEnabled();
  if (!enabled) {
    return fetchActivePhoneSlugs();
  }

  const cached = unstable_cache(() => fetchActivePhoneSlugs(), ['slugs', env.DATABASE_SCHEMA], {
    revalidate: 3600,
    tags: [TAGS.phones],
  });
  return runWithCacheFallback(cached, () => fetchActivePhoneSlugs());
}

// ---------------------------------------------------------------------------
// 6. Ask phone target
// ---------------------------------------------------------------------------

export interface CachedAskPhoneTarget {
  readonly id: string;
  readonly status: string;
  readonly brand: string;
  readonly model: string;
  readonly lastIngestAt: Date | string | null;
  readonly nextIngestAt: Date | string | null;
}

async function fetchAskPhoneTarget(
  slug: string,
  db?: AppQueryDb,
): Promise<CachedAskPhoneTarget | null> {
  const client = db ?? getDb();
  const [phone] = await client
    .select({
      id: phones.id,
      status: phones.status,
      brand: phones.brand,
      model: phones.model,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);

  if (!phone) return null;

  return {
    id: phone.id,
    status: phone.status,
    brand: phone.brand,
    model: phone.model,
    lastIngestAt: phone.lastIngestAt,
    nextIngestAt: phone.nextIngestAt,
  };
}

export async function getAskPhoneTarget(
  slug: string,
  db?: AppQueryDb,
): Promise<CachedAskPhoneTarget | null> {
  const cleanSlug = slug.trim().toLowerCase();
  const enabled = await isPublicDataCacheEnabled();
  if (db || !enabled) {
    return fetchAskPhoneTarget(cleanSlug, db);
  }

  const cached = unstable_cache(
    () => fetchAskPhoneTarget(cleanSlug),
    ['ask-target', env.DATABASE_SCHEMA, cleanSlug],
    {
      revalidate: 600,
      tags: [TAGS.phones, TAGS.phone(cleanSlug)],
    },
  );
  return runWithCacheFallback(cached, () => fetchAskPhoneTarget(cleanSlug));
}

// ---------------------------------------------------------------------------
// 7. Aspect definitions
// ---------------------------------------------------------------------------

async function fetchAspectDefinitions(db?: AppQueryDb): Promise<readonly AspectDefinitionRow[]> {
  const client = db ?? getDb();
  const rows = await client.select().from(aspectDefinitions);
  return rows;
}

export async function getAspectDefinitions(
  db?: AppQueryDb,
): Promise<readonly AspectDefinitionRow[]> {
  const enabled = await isPublicDataCacheEnabled();
  if (db || !enabled) {
    return fetchAspectDefinitions(db);
  }

  const cached = unstable_cache(
    () => fetchAspectDefinitions(),
    ['aspect-defs', env.DATABASE_SCHEMA],
    {
      revalidate: 3600,
      tags: [TAGS.aspectDefinitions],
    },
  );
  return runWithCacheFallback(cached, () => fetchAspectDefinitions());
}
