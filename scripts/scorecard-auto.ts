#!/usr/bin/env tsx
/**
 * Automated Scorecard Runner
 *
 * Usage: pnpm scorecard:auto [options]
 *
 * Options:
 *   --limit N          Max phones per run (default: 20)
 *   --shard K          Shard index (default: 0)
 *   --total-shards N   Total shards (default: 1)
 *   --force            Ignore staleness guard
 *   --dry-run          Print which phones would be scored, skip LLM calls
 *   --help
 */
import { parseArgs } from 'node:util';
import { ASPECT_NAMES } from '../src/lib/constants';
import { getDb } from '../src/services/db/client';
import { scorecardRuns } from '../src/services/db/schema';
import { findMissingPublicSchema, describeMissingSchema } from '../src/services/db/schema-guard';
import { logger } from '../src/services/logger';
import { getLlm } from '../src/services/llm';
import { createHybridRetriever } from '../src/services/retrieval/factory';
import { pickScorecardPhones, markScorecardComplete } from '../src/services/scorecard/scheduler';
import {
  computeChunkFingerprint,
  getLastScorecardFingerprint,
} from '../src/services/scorecard/staleness';
import {
  isScorecardQuotaExhaustedError,
  runScorecardForPhone,
} from '../src/services/scorecard/agent';

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      limit: { type: 'string', short: 'l' },
      shard: { type: 'string', short: 's' },
      'total-shards': { type: 'string', short: 't' },
      force: { type: 'boolean', short: 'f' },
      'dry-run': { type: 'boolean', short: 'd' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (args.help) {
    console.log(`
Usage: pnpm scorecard:auto [options]

Options:
  --limit N          Max phones per run (default: 20)
  --shard K          Shard index (default: 0)
  --total-shards N   Total shards (default: 1)
  --force            Ignore staleness guard
  --dry-run          Print which phones would be scored, skip LLM calls
  --help
    `);
    process.exit(0);
  }

  const limit = args.limit ? parseInt(args.limit, 10) : 20;
  const shard = args.shard ? parseInt(args.shard, 10) : 0;
  const totalShards = args['total-shards'] ? parseInt(args['total-shards'], 10) : 1;

  const db = getDb();

  // Schema guard — exit 0 if DB not ready
  const missing = await findMissingPublicSchema(db, [
    { table: 'phones', columns: ['last_scorecard_at', 'next_scorecard_at'] },
    { table: 'scorecard_runs' },
  ]);

  if (missing.length > 0) {
    console.warn(describeMissingSchema('scorecard:auto', missing));
    process.exit(0);
  }

  const picked = await pickScorecardPhones(db, {
    limit,
    shard,
    totalShards,
  });

  if (picked.length === 0) {
    console.log('[scorecard:auto] no phones due');
    process.exit(0);
  }

  if (args['dry-run']) {
    for (const p of picked) console.log(`  would score: ${p.slug}`);
    process.exit(0);
  }

  const retriever = createHybridRetriever();
  const llm = getLlm();
  const log = logger.child({ script: 'scorecard-auto' });
  let scored = 0,
    skipped = 0,
    failures = 0;
  let quotaExhausted = false;

  for (const phone of picked) {
    try {
      const fingerprint = await computeChunkFingerprint(db, phone.id);

      if (!args.force) {
        const last = await getLastScorecardFingerprint(db, phone.id);
        if (last !== null && last === fingerprint) {
          console.log(`  ${phone.slug}: skipped (chunks_unchanged)`);

          const now = new Date();
          await db.insert(scorecardRuns).values(
            ASPECT_NAMES.map((aspect) => ({
              phoneId: phone.id,
              aspect,
              status: 'skipped' as const,
              skipReason: 'chunks_unchanged',
              chunkFingerprint: fingerprint,
              startedAt: now,
              finishedAt: now,
              durationMs: 0,
            })),
          );

          await markScorecardComplete(db, { phoneId: phone.id });
          skipped++;
          continue;
        }
      }

      const result = await runScorecardForPhone({
        phoneId: phone.id,
        brand: phone.brand,
        model: phone.model,
        db,
        retriever,
        llm,
        log,
        chunkFingerprint: fingerprint,
        aspectDelayMs: 4500, // 4.5s pacing for free tier
      });

      console.log(
        `  ${phone.slug}: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed`,
      );
      if (result.updated + result.skipped >= ASPECT_NAMES.length && result.failed === 0) {
        await markScorecardComplete(db, { phoneId: phone.id });
        if (result.updated > 0) scored++;
        else skipped++;
      } else {
        failures++;
        log.warn(
          { phone: phone.slug, updated: result.updated, failed: result.failed },
          'no aspects updated; leaving phone due for retry (not rescheduling)',
        );
      }
    } catch (err) {
      if (isScorecardQuotaExhaustedError(err)) {
        quotaExhausted = true;
        log.warn(
          { phone: phone.slug, err: err instanceof Error ? err.message : String(err) },
          'Gemini quota exhausted; stopping scorecard batch',
        );
        console.warn(
          `[scorecard:auto] Gemini quota exhausted while scoring ${phone.slug}; stopping now so the next scheduled run can resume pending phones.`,
        );
        break;
      }

      failures++;
      log.error(
        { phone: phone.slug, err: err instanceof Error ? err.message : String(err) },
        'scorecard failed',
      );
    }
  }

  console.log(
    `[scorecard:auto] done scored=${scored} skipped=${skipped} failures=${failures} quotaExhausted=${quotaExhausted}`,
  );
  process.exit(quotaExhausted ? 0 : failures > 0 && scored === 0 && skipped === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
