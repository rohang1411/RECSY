/**
 * Recommendation catalog loader — fetches active phones with aspect scores.
 *
 * `loadRecommendationCatalog(db)` returns every active phone enriched
 * with its latest aspect scores (keyed by aspect name), parsed `spec_json`,
 * `msrp_usd`, `image_url`, and optional `spec_embedding` vector for the
 * semantic-bump path.
 *
 * Phones without aspect rows are still included (scores default to the
 * neutral value 5); the ranker uses `scorecardMissing` to signal this to
 * the UI.
 *
 * Used by: `src/services/recommender/run-recommendation.ts`,
 * `src/app/api/recommend/route.ts` (via run-recommendation).
 */
import { eq } from 'drizzle-orm';

import type { AspectName } from '@/lib/constants';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import type { AppDb } from '@/services/db/client';
import { aspectDefinitions, aspects, phones } from '@/services/db/schema';

import { parseVectorColumn } from './vector-utils';

export interface PhoneCatalogEntry {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly msrpUsd: string | null;
  /** Press render URL when seeded or ingested. */
  readonly imageUrl: string | null;
  readonly spec: PhoneSpec | null;
  /** Populated when `phones.spec_embedding` is set (e.g. after `pnpm spec-embed:backfill`). */
  readonly specEmbedding: readonly number[] | null;
  readonly aspectScores: ReadonlyMap<AspectName, number>;
}

/** Active phones with parsed specs and aspect scores (latest rows in `aspects`). */
export async function loadRecommendationCatalog(db: AppDb): Promise<PhoneCatalogEntry[]> {
  const rows = await db
    .select({
      phoneId: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      tagline: phones.tagline,
      msrpUsd: phones.msrpUsd,
      imageUrl: phones.imageUrl,
      specJson: phones.specJson,
      specEmbRaw: phones.specEmbedding,
      aspect: aspectDefinitions.aspect,
      aspectScore: aspects.score,
    })
    .from(phones)
    .leftJoin(aspects, eq(aspects.phoneId, phones.id))
    .leftJoin(aspectDefinitions, eq(aspectDefinitions.id, aspects.aspectDefinitionId))
    .where(eq(phones.status, 'active'));

  const byId = new Map<
    string,
    {
      phoneId: string;
      slug: string;
      brand: string;
      model: string;
      tagline: string | null;
      msrpUsd: string | null;
      imageUrl: string | null;
      specJson: unknown;
      specEmbedding: readonly number[] | null;
      aspectScores: Map<AspectName, number>;
    }
  >();

  for (const r of rows) {
    let e = byId.get(r.phoneId);
    if (!e) {
      e = {
        phoneId: r.phoneId,
        slug: r.slug,
        brand: r.brand,
        model: r.model,
        tagline: r.tagline,
        msrpUsd: r.msrpUsd,
        imageUrl: r.imageUrl,
        specJson: r.specJson,
        specEmbedding: parseVectorColumn(r.specEmbRaw),
        aspectScores: new Map(),
      };
      byId.set(r.phoneId, e);
    }
    if (r.aspect && r.aspectScore != null) {
      const n = Number.parseFloat(r.aspectScore);
      if (!Number.isNaN(n)) {
        e.aspectScores.set(r.aspect as AspectName, n);
      }
    }
  }

  return [...byId.values()].map((e) => {
    const parsed = PhoneSpecSchema.safeParse(e.specJson);
    return {
      phoneId: e.phoneId,
      slug: e.slug,
      brand: e.brand,
      model: e.model,
      tagline: e.tagline,
      msrpUsd: e.msrpUsd,
      imageUrl: e.imageUrl,
      spec: parsed.success ? parsed.data : null,
      specEmbedding: e.specEmbedding,
      aspectScores: e.aspectScores,
    };
  });
}
