#!/usr/bin/env tsx
/**
 * Backfill Recommendation Session Titles (Plan 27 Section 10 & WP-06).
 *
 * Derives deterministic heuristic titles for existing sessions with title_source = 'default'.
 * Runs in safe dry-run mode by default unless --apply is passed.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-session-titles.ts [--dry-run] [--apply] [--batch-size=500]
 */
import { parseArgs } from 'node:util';
import { getPostgres } from '../src/services/db/client';
import { buildSessionTitle } from '../src/services/recommender/session-title';
import type { UserRequirements } from '../src/services/recommender/requirements-schema';

export interface BackfillOptions {
  readonly apply?: boolean;
  readonly batchSize?: number;
  readonly limit?: number;
}

export async function backfillSessionTitles(
  sql: ReturnType<typeof getPostgres>,
  options: BackfillOptions = {},
): Promise<{
  processed: number;
  updated: number;
  sample: Array<{ id: string; oldTitle: string; newTitle: string }>;
}> {
  const isApply = Boolean(options.apply);
  const batchSize = Math.max(10, options.batchSize ?? 500);
  const limitTotal = options.limit ?? 10_000;

  console.log(`[backfill-session-titles] Mode: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[backfill-session-titles] Batch size: ${batchSize}, Limit: ${limitTotal}`);

  let totalProcessed = 0;
  let totalUpdated = 0;
  const sample: Array<{ id: string; oldTitle: string; newTitle: string }> = [];

  while (totalProcessed < limitTotal) {
    const currentLimit = Math.min(batchSize, limitTotal - totalProcessed);

    // Fetch batch of sessions with title_source = 'default' and their latest turn data
    const rows = await sql<
      Array<{
        id: string;
        title: string;
        firstMessage: string | null;
        metadata: { regionCode?: string } | null;
        extractedRequirements: UserRequirements | null;
        latestUserMessage: string | null;
      }>
    >`
      SELECT s.id,
             s.title,
             s.first_message AS "firstMessage",
             s.metadata,
             t.extracted_requirements AS "extractedRequirements",
             t.user_message AS "latestUserMessage"
        FROM recommendation_sessions s
        LEFT JOIN LATERAL (
          SELECT extracted_requirements, user_message
            FROM recommendation_turns
           WHERE session_id = s.id
           ORDER BY turn_index DESC
           LIMIT 1
        ) t ON true
       WHERE s.title_source = 'default'
       ORDER BY s.created_at DESC
       LIMIT ${currentLimit};
    `;

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const regionCode = row.metadata?.regionCode ?? 'US';
      const prompt = row.latestUserMessage || row.firstMessage || '';
      const newTitle = buildSessionTitle(row.extractedRequirements, prompt, regionCode);

      if (sample.length < 20) {
        sample.push({
          id: row.id,
          oldTitle: row.title,
          newTitle,
        });
      }

      if (isApply && newTitle && newTitle !== row.title) {
        await sql`
          UPDATE recommendation_sessions
             SET title = ${newTitle},
                 title_source = 'heuristic',
                 updated_at = now()
           WHERE id = ${row.id}::uuid
             AND title_source = 'default';
        `;
        totalUpdated++;
      }

      totalProcessed++;
    }

    if (rows.length < currentLimit) {
      break;
    }
  }

  return { processed: totalProcessed, updated: totalUpdated, sample };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: true },
      'batch-size': { type: 'string', default: '500' },
      limit: { type: 'string' },
    },
    allowPositionals: false,
  });

  const isApply = Boolean(values.apply) && !values['dry-run'];
  const batchSize = Number.parseInt(values['batch-size'] || '500', 10);
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;

  const sql = getPostgres();

  try {
    const res = await backfillSessionTitles(sql, {
      apply: isApply,
      batchSize,
      limit,
    });

    console.log('\n--- Sample derived titles (up to 20) ---');
    for (const item of res.sample) {
      console.log(`[${item.id.slice(0, 8)}] "${item.oldTitle}" -> "${item.newTitle}"`);
    }

    console.log(
      `\n[backfill-session-titles] Done. Processed: ${res.processed}, Updated: ${res.updated}`,
    );
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error('Fatal error in backfill-session-titles:', err);
    process.exit(1);
  });
}
