#!/usr/bin/env tsx
/**
 * Weekly ingest digest.
 *
 * Prints a human-readable summary of what the automated pipeline has done
 * in the last N days (default 7):
 *
 *   - Counts by adapter, tier, and status.
 *   - Top rejected_reason values (curator gating) — so we can catch the
 *     pipeline over-rejecting real content.
 *   - Phones that haven't been ingested in >2× their tier's interval.
 *   - Sources with low relevance / quality that still slipped through.
 *
 * Wire into a GitHub Actions weekly cron or just run locally:
 *   pnpm ingest:report            # last 7 days
 *   pnpm ingest:report --days 14  # last 14 days
 *
 * Output is intentionally console-only; a higher-fidelity dashboard can
 * build on top of the same queries later.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import { summarizeErrorChainForLogs } from '../src/lib/summarize-error';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { ingestRuns, phones, sources } from '../src/services/db/schema';
import { logger } from '../src/services/logger';
import { classifyTier, REFRESH_INTERVAL_DAYS } from '../src/services/ingest';

interface CliArgs {
  readonly days: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { days: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') {
      (args as { days: number }).days = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: pnpm ingest:report [--days N]');
      process.exit(0);
    }
  }
  return args;
}

function hr(title: string): void {
  console.log('');
  console.log(`— ${title} ${'—'.repeat(Math.max(0, 72 - title.length))}`);
}

async function main(): Promise<void> {
  const { days } = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'ingest_runs', columns: ['tier', 'rejected_reason', 'chunks_created', 'started_at'] },
    { table: 'phones', columns: ['last_ingest_at', 'next_ingest_at', 'launch_date'] },
    { table: 'sources', columns: ['relevance', 'quality', 'created_at'] },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('ingest-report', missing));
    process.exit(0);
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`[ingest-report] window: last ${days}d (since ${since.toISOString()})`);

  hr('ingest_runs by adapter × status');
  const byAdapterStatus = await db
    .select({
      adapter: ingestRuns.adapter,
      status: ingestRuns.status,
      n: sql<number>`count(*)::int`,
      chunks: sql<number>`coalesce(sum(${ingestRuns.chunksCreated}), 0)::int`,
    })
    .from(ingestRuns)
    .where(gte(ingestRuns.startedAt, since))
    .groupBy(ingestRuns.adapter, ingestRuns.status)
    .orderBy(ingestRuns.adapter, ingestRuns.status);
  for (const r of byAdapterStatus) {
    console.log(
      `  ${pad(r.adapter, 12)} ${pad(r.status, 10)} runs=${pad(String(r.n), 5)} chunks=${r.chunks}`,
    );
  }

  hr('ingest_runs by tier');
  const byTier = await db
    .select({
      tier: ingestRuns.tier,
      n: sql<number>`count(*)::int`,
    })
    .from(ingestRuns)
    .where(and(gte(ingestRuns.startedAt, since), isNotNull(ingestRuns.tier)))
    .groupBy(ingestRuns.tier)
    .orderBy(ingestRuns.tier);
  for (const r of byTier) {
    console.log(`  ${pad(r.tier ?? 'null', 8)} runs=${r.n}`);
  }

  hr('Top rejected_reason (curator gating)');
  const rejected = await db
    .select({
      reason: ingestRuns.rejectedReason,
      n: sql<number>`count(*)::int`,
    })
    .from(ingestRuns)
    .where(and(gte(ingestRuns.startedAt, since), isNotNull(ingestRuns.rejectedReason)))
    .groupBy(ingestRuns.rejectedReason)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(10);
  if (rejected.length === 0) {
    console.log('  (none — curator kept everything it saw)');
  } else {
    for (const r of rejected) {
      console.log(`  ${pad(r.reason ?? 'null', 32)} n=${r.n}`);
    }
  }

  hr('Source quality snapshot (this window)');
  const qualityRow = await db
    .select({
      n: sql<number>`count(*)::int`,
      avgRelevance: sql<number>`coalesce(avg(${sources.relevance})::float, 0)`,
      avgQuality: sql<number>`coalesce(avg(${sources.quality})::float, 0)`,
    })
    .from(sources)
    .where(gte(sources.createdAt, since));
  const q = qualityRow[0];
  if (q && q.n > 0) {
    console.log(
      `  sources_created=${q.n}  avg_relevance=${q.avgRelevance.toFixed(2)}  avg_quality=${q.avgQuality.toFixed(2)}`,
    );
  } else {
    console.log('  no sources written this window');
  }

  hr('Phones overdue for ingestion');
  const now = new Date();
  const allPhones = await db
    .select({
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(eq(phones.status, 'active'));
  const overdue: typeof allPhones = [];
  for (const p of allPhones) {
    const tier = classifyTier(p.launchDate ?? null);
    const intervalMs = REFRESH_INTERVAL_DAYS[tier] * 24 * 60 * 60 * 1000;
    const overdueAfter = p.nextIngestAt
      ? p.nextIngestAt.getTime() + 2 * intervalMs
      : (p.lastIngestAt?.getTime() ?? 0) + 2 * intervalMs;
    if (overdueAfter < now.getTime()) overdue.push(p);
  }
  if (overdue.length === 0) {
    console.log('  (none)');
  } else {
    for (const p of overdue.slice(0, 20)) {
      console.log(
        `  ${pad(p.slug, 40)} last=${p.lastIngestAt?.toISOString().slice(0, 10) ?? 'never'}  next=${p.nextIngestAt?.toISOString().slice(0, 10) ?? 'null'}`,
      );
    }
    if (overdue.length > 20) {
      console.log(`  … and ${overdue.length - 20} more`);
    }
  }

  hr('Retriable failures (quota / rate-limit)');
  const quotaFailed = await db
    .select({
      phoneSlug: phones.slug,
      adapter: ingestRuns.adapter,
      stage: ingestRuns.stage,
      errorCode: ingestRuns.errorCode,
      n: sql<number>`count(*)::int`,
      latestAt: sql<string>`max(${ingestRuns.startedAt})::text`,
    })
    .from(ingestRuns)
    .leftJoin(phones, eq(ingestRuns.phoneId, phones.id))
    .where(
      and(
        gte(ingestRuns.startedAt, since),
        eq(ingestRuns.status, 'failed'),
        inArray(ingestRuns.errorCode, ['quota_exceeded', 'rate_limit']),
      ),
    )
    .groupBy(phones.slug, ingestRuns.adapter, ingestRuns.stage, ingestRuns.errorCode)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(20);

  if (quotaFailed.length === 0) {
    console.log('  (none — no quota failures this window)');
  } else {
    for (const r of quotaFailed) {
      console.log(
        `  ${pad(r.phoneSlug ?? 'unknown', 36)} ${pad(r.adapter, 12)} stage=${pad(r.stage ?? '?', 8)} ` +
          `code=${pad(r.errorCode ?? '?', 16)} n=${r.n}  last=${r.latestAt?.slice(0, 16) ?? '?'}`,
      );
    }
  }

  hr('phones.last_ingest_status distribution');
  const statusDist = await db
    .select({
      status: phones.lastIngestStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .groupBy(phones.lastIngestStatus)
    .orderBy(desc(sql<number>`count(*)`));
  for (const r of statusDist) {
    console.log(`  ${pad(r.status ?? 'null', 18)} phones=${r.n}`);
  }

  console.log('');
  console.log('[ingest-report] done');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

main().catch((err) => {
  logger.error({ err: summarizeErrorChainForLogs(err) }, 'ingest-report crashed');
  console.error(summarizeErrorChainForLogs(err));
  process.exit(1);
});
