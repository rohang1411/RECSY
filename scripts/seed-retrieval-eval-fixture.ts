#!/usr/bin/env tsx
/**
 * Inserts a minimal `sources` + `chunks` row for `apple-iphone-16-pro` so
 * `pnpm eval:retrieval` can pass in CI (hybrid retriever needs indexed text +
 * a valid embedding; FTS matches `fixtures/eval/retrieval-fixtures.json` queries).
 *
 * Idempotent: upserts the source by (phone_id, url) and replaces chunks for
 * that source.
 */
import { eq, sql } from 'drizzle-orm';

import { getDb } from '../src/services/db/client';
import { chunks, phones, sources } from '../src/services/db/schema';

const EVAL_PHONE_SLUG = 'apple-iphone-16-pro';
const SOURCE_URL = 'https://recsy.ci/retrieval-eval/v1/iphone-16-pro';
const CONTENT_HASH = 'retrieval-eval-v1-iphone-16-pro';
const CHUNK_TEXT =
  'The iPhone 16 Pro offers strong battery life in real-world mixed use. ' +
  'Wired charging and MagSafe are supported, with reliable battery and charging experience for most daily routines.';

function unitVector(axis: number, dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i === axis ? 1 : 0));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const db = getDb();
  const embedding = unitVector(0, 768);

  const [phone] = await db
    .select({ id: phones.id })
    .from(phones)
    .where(eq(phones.slug, EVAL_PHONE_SLUG))
    .limit(1);

  if (!phone) {
    throw new Error(
      `Seed phone ${EVAL_PHONE_SLUG} is missing. Run pnpm db:setup before this script.`,
    );
  }

  const [source] = await db
    .insert(sources)
    .values({
      phoneId: phone.id,
      type: 'article',
      url: SOURCE_URL,
      title: 'RECSY CI retrieval eval (fixture)',
      contentHash: CONTENT_HASH,
    })
    .onConflictDoUpdate({
      target: [sources.phoneId, sources.url],
      set: {
        title: sql`excluded.title`,
        contentHash: sql`excluded.content_hash`,
        status: sql`'active'`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: sources.id });

  if (!source) {
    throw new Error('Failed to upsert eval source');
  }

  await db.delete(chunks).where(eq(chunks.sourceId, source.id));

  await db.insert(chunks).values({
    sourceId: source.id,
    phoneId: phone.id,
    chunkIndex: 0,
    text: CHUNK_TEXT,
    tokens: 32,
    embedding,
    embeddingModel: 'gemini-embedding-001',
  });

  console.log('[ci:retrieval-fixture] OK — chunk inserted for', EVAL_PHONE_SLUG);
}

main().catch((err) => {
  console.error('[ci:retrieval-fixture] FAILED', err);
  process.exit(1);
});
