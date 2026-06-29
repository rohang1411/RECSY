/**
 * Crawl queue scheduler.
 *
 * `creator-watch` is intentionally cheap: it only discovers likely source URLs
 * and writes them here. The ingestion cron is responsible for claiming due
 * rows and turning them into injected adapter candidates.
 */
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import { crawlQueue, phones } from '@/services/db/schema';

import type { SourceCandidate, SourceType } from '../types';
import type { Db } from '../writer';
import { shardIndex, type PickedPhone } from './pick-phones';
import { classifyTier, type IngestTier } from './tiers';

const MAX_QUEUE_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface QueuedCrawlItem {
  readonly id: string;
  readonly adapter: SourceType;
  readonly url: string;
  readonly title: string;
  readonly tier: IngestTier;
  readonly attempts: number;
  readonly phone: PickedPhone;
}

export interface PickQueuedCrawlItemsOptions {
  readonly tiers?: readonly IngestTier[];
  readonly limit?: number;
  readonly shard?: number;
  readonly totalShards?: number;
  readonly now?: Date;
}

export async function pickQueuedCrawlItems(
  db: Db,
  opts: PickQueuedCrawlItemsOptions = {},
): Promise<QueuedCrawlItem[]> {
  const now = opts.now ?? new Date();
  const allowedTiers = new Set<IngestTier>(opts.tiers ?? ['hot', 'warm', 'cold']);
  const totalShards = Math.max(1, opts.totalShards ?? 1);
  const shard = Math.max(0, Math.min(opts.shard ?? 0, totalShards - 1));
  const limit = opts.limit ?? 50;
  const scanLimit = Math.max(limit, limit * totalShards * 4);

  const rows = await db
    .select({
      id: crawlQueue.id,
      adapter: crawlQueue.adapter,
      url: crawlQueue.url,
      tier: crawlQueue.tier,
      attempts: crawlQueue.attempts,
      scheduledFor: crawlQueue.scheduledFor,
      phoneId: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(crawlQueue)
    .innerJoin(phones, eq(crawlQueue.phoneId, phones.id))
    .where(
      and(
        eq(crawlQueue.status, 'queued'),
        lte(crawlQueue.scheduledFor, now),
        sql`${crawlQueue.url} is not null`,
        sql`${phones.status} in ('active', 'upcoming')`,
      ),
    )
    .orderBy(asc(crawlQueue.scheduledFor))
    .limit(scanLimit);

  return rows
    .filter((row) => row.url)
    .map((row) => {
      const phoneTier = classifyTier(row.launchDate ?? null);
      return {
        id: row.id,
        adapter: row.adapter as SourceType,
        url: row.url!,
        title: `${row.brand} ${row.model}`,
        tier: row.tier,
        attempts: row.attempts,
        phone: {
          id: row.phoneId,
          slug: row.slug,
          brand: row.brand,
          model: row.model,
          launchDate: row.launchDate ? row.launchDate.toISOString().slice(0, 10) : null,
          tier: phoneTier,
          lastIngestAt: row.lastIngestAt,
          nextIngestAt: row.nextIngestAt,
        },
      };
    })
    .filter((item) => allowedTiers.has(item.tier))
    .filter((item) => shardIndex(item.phone.id, totalShards) === shard)
    .slice(0, limit);
}

export function queuedItemsToCandidates(
  items: readonly QueuedCrawlItem[],
): Partial<Record<SourceType, SourceCandidate[]>> {
  const byType: Partial<Record<SourceType, SourceCandidate[]>> = {};
  for (const item of items) {
    if (!byType[item.adapter]) byType[item.adapter] = [];
    byType[item.adapter]!.push({
      url: item.url,
      title: item.title,
      author: null,
      channel: null,
      language: 'en',
      publishedAt: null,
      raw: { crawlQueueId: item.id },
    });
  }
  return byType;
}

export async function markCrawlQueueStarted(db: Db, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await db
    .update(crawlQueue)
    .set({
      status: 'in_progress',
      attempts: sql`${crawlQueue.attempts} + 1`,
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(crawlQueue.id, [...itemIds]), eq(crawlQueue.status, 'queued')));
}

export async function markCrawlQueueDone(db: Db, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await db
    .update(crawlQueue)
    .set({
      status: 'done',
      scheduledFor: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(inArray(crawlQueue.id, [...itemIds]));
}

export async function markCrawlQueueFailed(
  db: Db,
  items: readonly QueuedCrawlItem[],
  error: string,
): Promise<void> {
  if (items.length === 0) return;
  for (const item of items) {
    const attemptsAfterThisRun = item.attempts + 1;
    const shouldRetry = attemptsAfterThisRun < MAX_QUEUE_ATTEMPTS;
    const retryAt = new Date(Date.now() + queueBackoffMs(attemptsAfterThisRun));
    await db
      .update(crawlQueue)
      .set({
        status: shouldRetry ? 'queued' : 'failed',
        scheduledFor: shouldRetry ? retryAt : sql`now()`,
        lastError: error.slice(0, 2_000),
        updatedAt: sql`now()`,
      })
      .where(eq(crawlQueue.id, item.id));
  }
}

function queueBackoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}
