#!/usr/bin/env tsx
/**
 * Phase 2 end-to-end acceptance smoke test.
 *
 * Verifies the full ingestion pipeline:
 *   1. Article adapter discovers+fetches the target URL.
 *   2. Chunker produces ≥ 1 chunk.
 *   3. Embedder returns 768-dim vectors and persists them.
 *   4. `sources` + `chunks` rows exist and are well-formed.
 *   5. A second identical ingestion is recognised as unchanged
 *      (`ingest_runs.status = 'skipped'`, no new chunks inserted).
 *
 * Defaults: ingest the Wikipedia page for the Pixel 9 Pro XL against the
 * seeded `google-pixel-9-pro-xl` phone. Wikipedia is paywall-free, stable,
 * and Readability-friendly — ideal for a hermetic smoke test.
 *
 * Exits non-zero on any failed assertion. Does NOT clean up on success —
 * the ingested rows are useful real data. Pass `--cleanup` to delete them.
 *
 * Usage:
 *   pnpm ingest:smoke
 *   pnpm ingest:smoke --url https://example.com/review --phone pixel-9-pro
 *   pnpm ingest:smoke --cleanup
 */
import { and, eq, sql } from 'drizzle-orm';

import { getDb } from '../src/services/db/client';
import { chunks, ingestRuns, phones, sources } from '../src/services/db/schema';
import { ArticleAdapter, IngestOrchestrator } from '../src/services/ingest';
import { getLlm } from '../src/services/llm';

interface CliArgs {
  phoneSlug: string;
  url: string;
  cleanup: boolean;
}

const DEFAULTS: Readonly<CliArgs> = {
  phoneSlug: 'google-pixel-9-pro-xl',
  url: 'https://en.wikipedia.org/wiki/Pixel_9_Pro',
  cleanup: false,
};

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--phone':
        out.phoneSlug = argv[++i] ?? out.phoneSlug;
        break;
      case '--url':
        out.url = argv[++i] ?? out.url;
        break;
      case '--cleanup':
        out.cleanup = true;
        break;
      case '-h':
      case '--help':
        console.log(
          [
            'Usage: pnpm ingest:smoke [options]',
            '',
            '  --phone <slug>   Phone slug to attach the source to (default: ' +
              `${DEFAULTS.phoneSlug})`,
            `  --url <url>      Article URL to ingest (default: ${DEFAULTS.url})`,
            '  --cleanup        Delete the ingested source + chunks at the end',
            '  --help           Print this message',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        console.error(`[ingest:smoke] unknown flag: ${a}`);
        process.exit(2);
    }
  }
  return out;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const db = getDb();
  const llm = getLlm();
  const orchestrator = new IngestOrchestrator({
    db,
    llm,
    adapters: [new ArticleAdapter()],
  });

  const checks: Check[] = [];

  // --- Phone must exist (seeded) -------------------------------------------
  const phoneRow = await db
    .select({ id: phones.id, slug: phones.slug })
    .from(phones)
    .where(eq(phones.slug, args.phoneSlug))
    .limit(1);

  if (phoneRow.length === 0) {
    fail(
      `phone '${args.phoneSlug}' not found — have you run 'pnpm db:setup'?`,
      'Seeded phones should include ' + DEFAULTS.phoneSlug,
    );
  }
  const phoneId = phoneRow[0]!.id;
  checks.push({
    name: 'phone seeded',
    ok: true,
    detail: `${args.phoneSlug} (${phoneId.slice(0, 8)}…)`,
  });

  // Scrub any prior smoke row so we start deterministic.
  await db.delete(sources).where(and(eq(sources.phoneId, phoneId), eq(sources.url, args.url)));

  // --- Pass 1: fresh ingest ------------------------------------------------
  console.log(`[ingest:smoke] pass 1 (fresh)  → ${args.url}`);
  const pass1 = await orchestrator.ingestPhone(
    {
      id: phoneId,
      slug: args.phoneSlug,
      brand: 'unused',
      model: 'unused',
      launchDate: null,
    },
    {
      adapterTypes: ['article'],
      candidatesByType: {
        article: [
          {
            url: args.url,
            title: 'smoke-test article',
            author: null,
            channel: null,
            language: 'en',
            publishedAt: null,
            raw: { source: 'ingest-smoke' },
          },
        ],
      },
    },
  );

  const pass1Summary = pass1.adapters[0]!;
  checks.push({
    name: 'pass 1 — article written',
    ok: pass1Summary.written.sources === 1 && pass1Summary.errors.length === 0,
    detail:
      `sources=${pass1Summary.written.sources} chunks=${pass1Summary.written.chunks} ` +
      `errors=${pass1Summary.errors.length}`,
  });
  if (pass1Summary.errors.length > 0) {
    for (const e of pass1Summary.errors) {
      console.error(`  ! ${e.url} → ${e.error}`);
    }
  }

  // --- Persistence assertions ---------------------------------------------
  const sourceRows = await db
    .select({
      id: sources.id,
      contentHash: sources.contentHash,
      status: sources.status,
      lastFetchedAt: sources.lastFetchedAt,
    })
    .from(sources)
    .where(and(eq(sources.phoneId, phoneId), eq(sources.url, args.url)))
    .limit(1);

  checks.push({
    name: 'sources row persisted',
    ok: sourceRows.length === 1 && sourceRows[0]!.contentHash.length === 64,
    detail:
      sourceRows.length === 1
        ? `id=${sourceRows[0]!.id.slice(0, 8)}… hash=${sourceRows[0]!.contentHash.slice(0, 12)}…`
        : 'missing',
  });
  if (sourceRows.length !== 1) {
    printAndExit(checks);
  }
  const sourceId = sourceRows[0]!.id;

  const chunkRows = await db
    .select({
      id: chunks.id,
      chunkIndex: chunks.chunkIndex,
      tokens: chunks.tokens,
      model: chunks.embeddingModel,
    })
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId));

  checks.push({
    name: 'chunks persisted',
    ok: chunkRows.length >= 1,
    detail: `${chunkRows.length} chunks`,
  });

  // Embedding dimensionality (pg-vector): pull one row and check via SQL
  // since Drizzle returns the vector as `number[]`.
  if (chunkRows.length > 0) {
    const firstChunk = await db.execute(sql`
      select vector_dims(embedding) as dims
        from chunks
       where id = ${chunkRows[0]!.id}
       limit 1
    `);
    const dims = Number((firstChunk as unknown as Array<{ dims: number }>)[0]?.dims ?? NaN);
    checks.push({
      name: 'embedding dimensionality',
      ok: dims === 768,
      detail: `vector_dims = ${dims} (expected 768)`,
    });
  }

  // Chunk index must be contiguous 0..N-1, no duplicates.
  const indices = chunkRows.map((c) => c.chunkIndex).sort((a, b) => a - b);
  const contiguous = indices.every((n, i) => n === i);
  checks.push({
    name: 'chunk indexes contiguous',
    ok: contiguous,
    detail: contiguous ? `0..${indices.length - 1}` : `gaps: ${JSON.stringify(indices)}`,
  });

  // --- Pass 2: idempotent re-ingest ----------------------------------------
  console.log(`[ingest:smoke] pass 2 (re-run) → ${args.url}`);
  const priorLastFetchedAt = sourceRows[0]!.lastFetchedAt;
  const pass2 = await orchestrator.ingestPhone(
    {
      id: phoneId,
      slug: args.phoneSlug,
      brand: 'unused',
      model: 'unused',
      launchDate: null,
    },
    {
      adapterTypes: ['article'],
      candidatesByType: {
        article: [
          {
            url: args.url,
            title: 'smoke-test article',
            author: null,
            channel: null,
            language: 'en',
            publishedAt: null,
            raw: { source: 'ingest-smoke' },
          },
        ],
      },
    },
  );
  const pass2Summary = pass2.adapters[0]!;
  checks.push({
    name: 'pass 2 — recognised as unchanged',
    ok:
      pass2Summary.written.sources === 0 &&
      pass2Summary.skippedDuplicate === 1 &&
      pass2Summary.errors.length === 0,
    detail:
      `sources=${pass2Summary.written.sources} skipped=${pass2Summary.skippedDuplicate} ` +
      `errors=${pass2Summary.errors.length}`,
  });

  // Chunk count must be unchanged (no delete/re-insert on skip).
  const chunkCountAfter = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.sourceId, sourceId));
  checks.push({
    name: 'chunks unchanged after re-run',
    ok: Number(chunkCountAfter[0]?.count ?? -1) === chunkRows.length,
    detail: `before=${chunkRows.length} after=${chunkCountAfter[0]?.count ?? '?'}`,
  });

  // last_fetched_at MUST advance (the skip path still bumps it).
  const sourceAfter = await db
    .select({ lastFetchedAt: sources.lastFetchedAt })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  const advanced =
    sourceAfter[0] !== undefined &&
    sourceAfter[0].lastFetchedAt.getTime() > priorLastFetchedAt.getTime();
  checks.push({
    name: 'last_fetched_at advanced on skip',
    ok: advanced,
    detail: advanced ? 'yes' : 'no (expected a bump)',
  });

  // --- Ingest-runs telemetry -----------------------------------------------
  const runs = await db
    .select({ status: ingestRuns.status, chunksCreated: ingestRuns.chunksCreated })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.phoneId, phoneId), eq(ingestRuns.sourceUrl, args.url)));
  const successRun = runs.find((r) => r.status === 'success');
  const skipRun = runs.find((r) => r.status === 'skipped');
  checks.push({
    name: 'ingest_runs has success + skipped rows',
    ok: !!successRun && !!skipRun,
    detail:
      `success=${successRun ? successRun.chunksCreated : '∅'} ` +
      `skipped=${skipRun ? 'yes' : '∅'}`,
  });

  // --- Optional cleanup ----------------------------------------------------
  if (args.cleanup) {
    await db.delete(sources).where(and(eq(sources.phoneId, phoneId), eq(sources.url, args.url)));
    console.log('[ingest:smoke] cleaned up smoke-test rows');
  }

  printAndExit(checks);
}

function fail(msg: string, detail: string): never {
  console.error(`[ingest:smoke] FAIL: ${msg}`);
  console.error(`  ${detail}`);
  process.exit(1);
}

function printAndExit(checks: readonly Check[]): never {
  console.log('\n[ingest:smoke] results:');
  for (const c of checks) {
    const tag = c.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${tag}] ${c.name.padEnd(36)} ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  const passed = checks.length - failed;
  console.log(`\n[ingest:smoke] ${passed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[ingest:smoke] CRASHED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
