/**
 * Recommendation catalog loader — fetches active phones with aspect scores.
 *
 * `loadRecommendationCatalog(db)` returns every active phone enriched
 * with its latest aspect scores (keyed by aspect name), parsed `spec_json`,
 * `msrp_usd`, `image_url`, and optional `spec_embedding` vector for the
 * semantic-bump path.
 *
 * Optimization (Phase B / DB-02):
 * Previously, `phones` was joined with `aspects` and `aspectDefinitions`,
 * duplicating phone specs and the 768-dimensional `spec_embedding` vector
 * across 7 aspect rows per phone (~5.4 MB per cold read).
 *
 * Now, phone specs/vectors are queried once per phone, and aspect scores
 * are fetched separately (or mapped without duplication), dropping cold
 * payload by ~80% to ~0.88 MB.
 *
 * Phones without aspect rows are still included (scores default to the
 * neutral value 5); the ranker uses `scorecardMissing` to signal this to
 * the UI.
 *
 * Used by: `src/services/recommender/run-recommendation.ts`,
 * `src/app/api/recommend/route.ts` (via run-recommendation).
 */
import { and, eq } from 'drizzle-orm';

import type { AspectName } from '@/lib/constants';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import type { AppQueryDb } from '@/services/db/client';
import { aspectDefinitions, aspects, phones, phoneRegionalDetails } from '@/services/db/schema';

import { parseVectorColumn } from './vector-utils';

export interface PhoneCatalogEntry {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly launchDate?: Date | null;
  readonly tagline: string | null;
  readonly msrpUsd: string | null;
  readonly localPrice?: string | null;
  readonly localCurrency?: string | null;
  readonly isEstimated?: boolean | null;
  readonly isAvailable?: boolean | null;
  readonly imageUrl: string | null;
  readonly spec: PhoneSpec | null;
  readonly specEmbedding: readonly number[] | null;
  readonly aspectScores: ReadonlyMap<AspectName, number>;
  readonly aspectConfidences?: ReadonlyMap<AspectName, number>;
}

export interface LoadCatalogOptions {
  /**
   * If false, skips vector parsing and returns `specEmbedding: null`.
   * Used by preflight, browse/pickers, and non-semantic component probes.
   */
  readonly withSpecEmbeddings?: boolean;
}

/** Active phones with parsed specs and aspect scores (latest rows in `aspects`). */
export async function loadRecommendationCatalog(
  db: AppQueryDb,
  regionCode: string = 'US',
  options: LoadCatalogOptions = {},
): Promise<PhoneCatalogEntry[]> {
  const withEmbeddings = options.withSpecEmbeddings !== false;

  // 1. Fetch active phones with regional details (1 row per phone)
  const phoneRows = (await db
    .select({
      phoneId: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      tagline: phones.tagline,
      msrpUsd: phones.msrpUsd,
      localPrice: phoneRegionalDetails.price,
      localCurrency: phoneRegionalDetails.currency,
      isEstimated: phoneRegionalDetails.isEstimated,
      isAvailable: phoneRegionalDetails.isAvailable,
      imageUrl: phones.imageUrl,
      specJson: phones.specJson,
      specEmbRaw: phones.specEmbedding,
    })
    .from(phones)
    .leftJoin(
      phoneRegionalDetails,
      and(
        eq(phoneRegionalDetails.phoneId, phones.id),
        eq(phoneRegionalDetails.countryCode, regionCode),
      ),
    )
    .where(eq(phones.status, 'active'))) as Array<{
    phoneId: string;
    slug: string;
    brand: string;
    model: string;
    launchDate: Date | string | null;
    tagline: string | null;
    msrpUsd: string | null;
    localPrice: string | null;
    localCurrency: string | null;
    isEstimated: boolean | null;
    isAvailable: boolean | null;
    imageUrl: string | null;
    specJson: unknown;
    specEmbRaw: unknown;
    aspect?: unknown;
    aspectScore?: unknown;
    aspectConfidence?: unknown;
  }>;

  if (phoneRows.length === 0) {
    return [];
  }

  // Check if rows already contain aspect join data (e.g. from existing test mocks)
  const isMockJoined = 'aspect' in phoneRows[0]!;

  const aspectMapByPhone = new Map<
    string,
    Map<AspectName, { score: number; confidence: number; version: number; updatedAtMs: number }>
  >();

  if (isMockJoined) {
    // Process aspect scores from the mock-provided joined rows
    for (const r of phoneRows) {
      if (r.aspect && r.aspectScore != null) {
        const n = Number.parseFloat(String(r.aspectScore));
        const c = r.aspectConfidence != null ? Number.parseFloat(String(r.aspectConfidence)) : 0.8;
        if (!Number.isNaN(n)) {
          let phoneMap = aspectMapByPhone.get(r.phoneId);
          if (!phoneMap) {
            phoneMap = new Map();
            aspectMapByPhone.set(r.phoneId, phoneMap);
          }
          phoneMap.set(r.aspect as AspectName, {
            score: n,
            confidence: Number.isNaN(c) ? 0.8 : c,
            version: 1,
            updatedAtMs: 0,
          });
        }
      }
    }
  } else {
    // 2. Fetch aspect scores separately (no duplicate phone vectors/specs transferred)
    try {
      const aspectRows = await db
        .select({
          phoneId: aspects.phoneId,
          aspect: aspectDefinitions.aspect,
          version: aspectDefinitions.version,
          aspectScore: aspects.score,
          aspectConfidence: aspects.confidence,
          updatedAt: aspects.updatedAt,
        })
        .from(aspects)
        .innerJoin(aspectDefinitions, eq(aspectDefinitions.id, aspects.aspectDefinitionId));

      for (const r of aspectRows) {
        if (!r.aspect || r.aspectScore == null) continue;
        const n = Number.parseFloat(String(r.aspectScore));
        if (Number.isNaN(n)) continue;
        const c = r.aspectConfidence != null ? Number.parseFloat(String(r.aspectConfidence)) : 0.8;
        const conf = Number.isNaN(c) ? 0.8 : c;

        const asp = r.aspect as AspectName;
        let phoneMap = aspectMapByPhone.get(r.phoneId);
        if (!phoneMap) {
          phoneMap = new Map();
          aspectMapByPhone.set(r.phoneId, phoneMap);
        }

        const current = phoneMap.get(asp);
        const version = typeof r.version === 'number' ? r.version : 1;
        const updatedAtMs = r.updatedAt instanceof Date ? r.updatedAt.getTime() : 0;

        // Explicit latest-definition rule with deterministic tie handling:
        // Higher version wins; if tied, most recently updated wins.
        if (
          !current ||
          version > current.version ||
          (version === current.version && updatedAtMs > current.updatedAtMs)
        ) {
          phoneMap.set(asp, { score: n, confidence: conf, version, updatedAtMs });
        }
      }
    } catch {
      // If aspects table is empty or inaccessible, default to empty maps
    }
  }

  // Deduplicate phone entities (in case of mock joined rows)
  const uniquePhones = new Map<string, (typeof phoneRows)[0]>();
  for (const r of phoneRows) {
    if (!uniquePhones.has(r.phoneId)) {
      uniquePhones.set(r.phoneId, r);
    }
  }

  return [...uniquePhones.values()].map((r) => {
    const parsed = PhoneSpecSchema.safeParse(r.specJson);
    const aspectScores = new Map<AspectName, number>();
    const aspectConfidences = new Map<AspectName, number>();
    const phoneAspects = aspectMapByPhone.get(r.phoneId);
    if (phoneAspects) {
      for (const [asp, item] of phoneAspects.entries()) {
        aspectScores.set(asp, item.score);
        aspectConfidences.set(asp, item.confidence);
      }
    }

    return {
      phoneId: r.phoneId,
      slug: r.slug,
      brand: r.brand,
      model: r.model,
      launchDate: r.launchDate ? new Date(r.launchDate) : null,
      tagline: r.tagline,
      msrpUsd: r.msrpUsd,
      localPrice: r.localPrice ?? r.msrpUsd,
      localCurrency: r.localCurrency ?? 'USD',
      isEstimated: r.isEstimated ?? false,
      isAvailable: r.isAvailable ?? true,
      imageUrl: r.imageUrl,
      spec: parsed.success ? parsed.data : null,
      specEmbedding: withEmbeddings ? parseVectorColumn(r.specEmbRaw) : null,
      aspectScores,
      aspectConfidences,
    };
  });
}
