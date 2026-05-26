#!/usr/bin/env tsx
/**
 * Fill `phones.spec_embedding` (768-dim) for recommender semantic ranking.
 * Uses the same `gemini-embedding-001` model as chunk ingestion.
 *
 * Usage:
 *   pnpm spec-embed:backfill           # only rows where spec_embedding IS NULL
 *   pnpm spec-embed:backfill --force   # re-embed all active phones
 */
import { and, eq, isNull } from 'drizzle-orm';

import { PhoneSpecSchema } from '@/features/phones/schema';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { isLikelyGeminiQuotaExhaustedError } from '@/services/llm/gemini-request-governor';
import { logger } from '@/services/logger';
import { buildSpecDocumentForEmbedding } from '@/services/recommender/spec-embedding-text';
const BATCH = 16;

function parseArgs(argv: string[]): { force: boolean } {
  return { force: argv.includes('--force') };
}

async function main(): Promise<void> {
  const { force } = parseArgs(process.argv.slice(2));
  const log = logger.child({ script: 'backfill-spec-embeddings' });
  const db = getDb();
  const llm = getLlm();

  const baseSelect = {
    id: phones.id,
    slug: phones.slug,
    brand: phones.brand,
    model: phones.model,
    tagline: phones.tagline,
    specJson: phones.specJson,
  };

  const rows = force
    ? await db.select(baseSelect).from(phones).where(eq(phones.status, 'active'))
    : await db
        .select(baseSelect)
        .from(phones)
        .where(and(eq(phones.status, 'active'), isNull(phones.specEmbedding)));

  const work: { id: string; slug: string; text: string }[] = [];
  for (const r of rows) {
    const parsed = PhoneSpecSchema.safeParse(r.specJson);
    if (!parsed.success) {
      log.warn({ slug: r.slug }, 'skip: invalid spec_json');
      continue;
    }
    const text = buildSpecDocumentForEmbedding({
      brand: r.brand,
      model: r.model,
      tagline: r.tagline,
      spec: parsed.data,
    });
    work.push({ id: r.id, slug: r.slug, text });
  }

  if (work.length === 0) {
    console.log('[spec-embed:backfill] nothing to do');
    return;
  }

  let ok = 0;
  let quotaExhausted = false;
  for (let i = 0; i < work.length; i += BATCH) {
    const batch = work.slice(i, i + BATCH);
    let result: Awaited<ReturnType<typeof llm.embed>>;
    try {
      result = await llm.embed(batch.map((b) => b.text));
    } catch (err) {
      if (isLikelyGeminiQuotaExhaustedError(err)) {
        quotaExhausted = true;
        log.warn(
          { remaining: work.length - i, err: err instanceof Error ? err.message : String(err) },
          'Gemini quota exhausted; leaving remaining spec embeddings pending',
        );
        break;
      }
      throw err;
    }
    const { embeddings, model } = result;
    for (let j = 0; j < batch.length; j++) {
      const emb = embeddings[j];
      if (!emb?.length) {
        log.error({ slug: batch[j]!.slug }, 'missing embedding');
        continue;
      }
      await db
        .update(phones)
        .set({
          specEmbedding: [...emb],
          updatedAt: new Date(),
        })
        .where(eq(phones.id, batch[j]!.id));
      ok += 1;
    }
    log.info({ batch: Math.floor(i / BATCH) + 1, model, count: batch.length }, 'batch embedded');
  }

  console.log(
    `[spec-embed:backfill] OK — ${ok}/${work.length} phones (force=${force}, quotaExhausted=${quotaExhausted})`,
  );
}

main().catch((err) => {
  console.error('[spec-embed:backfill] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
