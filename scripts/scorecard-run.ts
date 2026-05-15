#!/usr/bin/env tsx
/**
 * Phase 4 — compute aspect scorecard rows for one phone or all active phones.
 *
 * Usage:
 *   pnpm scorecard:run --phone google-pixel-9-pro
 *   pnpm scorecard:run --all
 *
 * Requires `.env.local` (Gemini + DATABASE_URL). Cost: ~7 embedding + ~7
 * structured LLM calls per phone (one per aspect; each call may include SDK-level retries on transient errors).
 */
import { eq } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import { getLlm } from '@/services/llm';
import { logger } from '@/services/logger';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { loadPhoneBySlug, runScorecardForPhone } from '@/services/scorecard/agent';

function parseArgs(argv: string[]): { mode: 'phone' | 'all'; slug?: string } {
  const phoneIdx = argv.indexOf('--phone');
  if (argv.includes('--all')) {
    return { mode: 'all' };
  }
  if (phoneIdx !== -1 && argv[phoneIdx + 1]) {
    return { mode: 'phone', slug: argv[phoneIdx + 1] };
  }
  throw new Error('Usage: pnpm scorecard:run --phone <slug> | pnpm scorecard:run --all');
}

async function main(): Promise<void> {
  const { mode, slug } = parseArgs(process.argv.slice(2));
  const db = getDb();
  const retriever = createHybridRetriever();
  const llm = getLlm();
  const log = logger.child({ script: 'scorecard-run' });

  if (mode === 'phone') {
    const phone = await loadPhoneBySlug(db, slug!);
    if (!phone) {
      console.error(`[scorecard:run] unknown slug: ${slug}`);
      process.exit(1);
    }
    if (phone.status !== 'active') {
      console.error(`[scorecard:run] phone not active: ${slug}`);
      process.exit(1);
    }
    const { updated, failed } = await runScorecardForPhone({
      phoneId: phone.id,
      brand: phone.brand,
      model: phone.model,
      db,
      retriever,
      llm,
      log,
    });
    if (updated === 0) {
      console.warn(
        `[scorecard:run] ${failed} aspect(s) failed, 0 updated for ${slug}. If you see 429/quota in logs, free tier is ~20 generate requests/day per model for gemini-2.5-flash (aspects + SDK retries add up quickly).`,
      );
    } else {
      const tail = failed > 0 ? ` (${failed} failed)` : '';
      console.log(`[scorecard:run] OK — ${updated} aspects for ${slug}${tail}`);
    }
    return;
  }

  const active = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
    })
    .from(phones)
    .where(eq(phones.status, 'active'));

  for (const p of active) {
    log.info({ slug: p.slug }, 'scoring phone');
    const { updated } = await runScorecardForPhone({
      phoneId: p.id,
      brand: p.brand,
      model: p.model,
      db,
      retriever,
      llm,
      log,
    });
    console.log(`[scorecard:run] ${p.slug}: ${updated} aspects`);
  }

  console.log(`[scorecard:run] OK — ${active.length} phones`);
}

main().catch((err) => {
  console.error('[scorecard:run] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
