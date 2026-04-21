#!/usr/bin/env tsx
/**
 * Tier-1 retrieval evaluation: hybrid search only (embed + Postgres), no chat.
 *
 * Loads `eval/retrieval-fixtures.json`, runs {@link createHybridRetriever} per
 * fixture, and asserts chunk count + optional substring matches in retrieved
 * passage text.
 *
 * Usage:
 *   pnpm eval:retrieval
 *
 * Exits 1 if any fixture fails or the phone slug is missing. Exits 0 when all
 * assertions pass. Intended for local / staging runs with a real corpus — not
 * for default CI (embeddings cost money).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { createHybridRetriever } from '@/services/retrieval/factory';

interface Fixture {
  readonly id: string;
  readonly phoneSlug: string;
  readonly query: string;
  readonly expect: {
    readonly minChunks: number;
    readonly anyChunkTextIncludes?: readonly string[];
  };
}

interface FixtureFile {
  readonly fixtures: readonly Fixture[];
}

async function main(): Promise<void> {
  const fixturePath = resolve(process.cwd(), 'eval', 'retrieval-fixtures.json');
  const raw = await readFile(fixturePath, 'utf8');
  const { fixtures } = JSON.parse(raw) as FixtureFile;

  const db = getDb();
  const retriever = createHybridRetriever();
  let failed = 0;

  for (const fx of fixtures) {
    const [phone] = await db
      .select({ id: phones.id })
      .from(phones)
      .where(eq(phones.slug, fx.phoneSlug))
      .limit(1);

    if (!phone) {
      console.error(`[eval:retrieval] FAIL ${fx.id}: unknown phone slug ${fx.phoneSlug}`);
      failed += 1;
      continue;
    }

    const result = await retriever.search({
      phoneId: phone.id,
      query: fx.query,
      options: {
        kPerRetriever: 20,
        targetResults: 8,
        minDistinctSources: 1,
      },
    });

    if (result.chunks.length < fx.expect.minChunks) {
      console.error(
        `[eval:retrieval] FAIL ${fx.id}: want >= ${fx.expect.minChunks} chunks, got ${result.chunks.length}`,
      );
      failed += 1;
      continue;
    }

    const subs = fx.expect.anyChunkTextIncludes ?? [];
    const hay = result.chunks.map((c) => c.text.toLowerCase());
    const missing = subs.filter((s) => !hay.some((t) => t.includes(s.toLowerCase())));

    if (missing.length > 0) {
      console.error(
        `[eval:retrieval] FAIL ${fx.id}: substring not found in any chunk: ${missing.join(', ')}`,
      );
      failed += 1;
      continue;
    }

    console.log(`[eval:retrieval] OK ${fx.id} — ${result.chunks.length} chunks`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[eval:retrieval] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
