#!/usr/bin/env tsx
/**
 * Phase 3 — hybrid retrieval smoke test against a live Postgres database.
 *
 * Picks an active phone that has at least one chunk, runs
 * {@link createHybridRetriever}, and asserts a non-empty ranked list.
 *
 * Usage:
 *   pnpm retrieval:smoke
 *
 * Requires `DATABASE_URL` (see `.env.local`). Does not call the LLM beyond
 * a single query embedding inside the hybrid retriever.
 */
import { eq } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { chunks, phones } from '@/services/db/schema';
import { createHybridRetriever } from '@/services/retrieval/factory';

async function main(): Promise<void> {
  const db = getDb();

  const [sample] = await db
    .select({
      phoneId: chunks.phoneId,
    })
    .from(chunks)
    .limit(1);

  if (!sample) {
    console.error('[retrieval:smoke] No chunks in database — run ingestion first.');
    process.exit(1);
  }

  const [phone] = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      status: phones.status,
    })
    .from(phones)
    .where(eq(phones.id, sample.phoneId))
    .limit(1);

  if (!phone || phone.status !== 'active') {
    console.error('[retrieval:smoke] Phone for sample chunk is missing or not active.');
    process.exit(1);
  }

  const retriever = createHybridRetriever();
  const result = await retriever.search({
    phoneId: phone.id,
    query: 'battery life and display quality',
    options: {
      kPerRetriever: 15,
      targetResults: 6,
      minDistinctSources: 1,
    },
  });

  if (result.chunks.length === 0) {
    console.error('[retrieval:smoke] Hybrid search returned zero chunks.');
    process.exit(1);
  }

  console.log(
    `[retrieval:smoke] OK — ${result.chunks.length} chunks for ${phone.slug} (${Math.round(result.debug.totalMs)} ms total)`,
  );
}

main().catch((err) => {
  console.error('[retrieval:smoke] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
