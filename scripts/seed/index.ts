/**
 * Idempotent database seeder.
 *
 * Re-runs are safe: every insert uses `ON CONFLICT DO UPDATE` against a
 * stable natural key (slug for phones, (aspect, version) for aspect
 * definitions). Embeddings are intentionally NOT computed here — they are
 * generated lazily by the ingestion pipeline (Phase 2+) for chunks and on
 * demand for `phones.spec_embedding` (run `pnpm spec-embed:backfill` after seed).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { aspectDefinitions, phones } from '../../src/services/db/schema';
import { ASPECT_DEFINITION_SEEDS, validateAspectSeedWeights } from './aspect-definitions';
import { PHONE_SEEDS } from './phones-starter';

export interface SeedSummary {
  aspects: { upserted: number };
  phones: { upserted: number };
}

/**
 * Seed both aspect definitions and the starter phone corpus.
 *
 * @param db Drizzle client connected with schema-modifying privileges
 *           (i.e. the `postgres` role on Supabase).
 */
export async function runSeeds(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<SeedSummary> {
  const aspects = await seedAspectDefinitions(db);
  const phonesUp = await seedPhones(db);
  return { aspects, phones: phonesUp };
}

async function seedAspectDefinitions(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<SeedSummary['aspects']> {
  validateAspectSeedWeights(ASPECT_DEFINITION_SEEDS);

  const rows = ASPECT_DEFINITION_SEEDS.map((seed) => ({
    aspect: seed.aspect,
    version: seed.version,
    description: seed.description,
    queryPrompts: [...seed.queryPrompts],
    defaultWeight: seed.defaultWeight,
  }));

  const result = await db
    .insert(aspectDefinitions)
    .values(rows)
    .onConflictDoUpdate({
      target: [aspectDefinitions.aspect, aspectDefinitions.version],
      set: {
        description: sql`excluded.description`,
        queryPrompts: sql`excluded.query_prompts`,
        defaultWeight: sql`excluded.default_weight`,
      },
    })
    .returning({ id: aspectDefinitions.id });

  return { upserted: result.length };
}

async function seedPhones(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<SeedSummary['phones']> {
  const rows = PHONE_SEEDS.map((seed) => ({
    slug: seed.slug,
    brand: seed.brand,
    model: seed.model,
    variant: seed.variant ?? null,
    tagline: seed.tagline,
    launchDate: new Date(seed.launchDate),
    msrpUsd: seed.msrpUsd,
    imageUrl: seed.imageUrl ?? null,
    status: seed.status,
    specJson: seed.specJson as unknown as Record<string, unknown>,
    regionAvailability: [...seed.regionAvailability],
  }));

  const result = await db
    .insert(phones)
    .values(rows)
    .onConflictDoUpdate({
      target: phones.slug,
      set: {
        brand: sql`excluded.brand`,
        model: sql`excluded.model`,
        variant: sql`excluded.variant`,
        tagline: sql`excluded.tagline`,
        launchDate: sql`excluded.launch_date`,
        msrpUsd: sql`excluded.msrp_usd`,
        imageUrl: sql`excluded.image_url`,
        status: sql`excluded.status`,
        specJson: sql`excluded.spec_json`,
        regionAvailability: sql`excluded.region_availability`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: phones.id });

  return { upserted: result.length };
}
