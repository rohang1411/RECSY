/**
 * Resume scheduling — pick phones and candidates with recent retriable failures,
 * incomplete ingest outcomes, or empty corpus (no chunks).
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';

import { ingestRuns, phones } from '@/services/db/schema';

import type { Db } from '../writer';
import type { PickedPhone } from './pick-phones';
import { shardIndex } from './pick-phones';
import { classifyTier, type IngestTier } from './tiers';

const DEFAULT_RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RETRIABLE_ERROR_CODES = ['quota_exceeded', 'rate_limit'] as const;
const INCOMPLETE_INGEST_STATUSES = ['partial', 'quota_exhausted', 'failed'] as const;

/** Matches quota/rate-limit failures recorded before `error_code` existed. */
const LEGACY_RETRIABLE_ERROR_SQL = sql`${ingestRuns.error} ~* '(resource_exhausted|exceeded your current quota|quota exceeded|daily request budget|rate.?limit|(^|[^0-9])429([^0-9]|$))'`;

export interface PickResumePhonesOptions {
  /** Only look at failures within this window. Default: last 7 days. */
  readonly windowMs?: number;
  /** Error codes to target. Default: quota_exceeded + rate_limit. */
  readonly errorCodes?: readonly string[];
  readonly limit?: number;
  readonly shard?: number;
  readonly totalShards?: number;
  /** Include active phones with zero chunks (ignores next_ingest_at). Default true. */
  readonly includeEmptyCorpus?: boolean;
}

export interface FailedCandidate {
  readonly sourceUrl: string;
  readonly adapter: string;
  readonly stage: string;
  readonly errorCode: string;
  readonly title: string;
}

function retriableFailureWhere(since: Date, now: Date, errorCodes: readonly string[]) {
  return and(
    eq(ingestRuns.status, 'failed'),
    or(inArray(ingestRuns.errorCode, [...errorCodes]), LEGACY_RETRIABLE_ERROR_SQL),
    gte(ingestRuns.startedAt, since),
    isNotNull(ingestRuns.phoneId),
    or(isNull(ingestRuns.retryAfter), lte(ingestRuns.retryAfter, now)),
  );
}

function toPickedPhone(r: {
  id: string;
  slug: string;
  brand: string;
  model: string;
  launchDate: Date | null;
  lastIngestAt: Date | null;
  nextIngestAt: Date | null;
}): PickedPhone {
  return {
    id: r.id,
    slug: r.slug,
    brand: r.brand,
    model: r.model,
    launchDate: r.launchDate ? r.launchDate.toISOString().slice(0, 10) : null,
    tier: classifyTier(r.launchDate ?? null),
    lastIngestAt: r.lastIngestAt,
    nextIngestAt: r.nextIngestAt,
  };
}

function applyShardAndLimit(rows: PickedPhone[], opts: PickResumePhonesOptions): PickedPhone[] {
  const totalShards = Math.max(1, opts.totalShards ?? 1);
  const shard = Math.max(0, Math.min(opts.shard ?? 0, totalShards - 1));
  return rows.filter((r) => shardIndex(r.id, totalShards) === shard).slice(0, opts.limit ?? 50);
}

/**
 * Active/upcoming phones with no chunks in the DB (empty corpus).
 * Ignores `next_ingest_at` so a failed overnight batch can be retried immediately.
 */
export async function pickPhonesEmptyCorpus(
  db: Db,
  opts: {
    tiers?: readonly IngestTier[];
    limit?: number;
    shard?: number;
    totalShards?: number;
  } = {},
): Promise<PickedPhone[]> {
  const allowedTiers = new Set<IngestTier>(opts.tiers ?? ['hot', 'warm', 'cold']);

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(
      and(
        sql`${phones.status} in ('active', 'upcoming')`,
        sql`not exists (select 1 from chunks c where c.phone_id = ${phones.id})`,
      ),
    )
    .orderBy(sql`coalesce(${phones.lastIngestAt}, '1970-01-01'::timestamptz) asc nulls first`);

  const ranked = rows
    .map((r) => ({ ...r, tier: classifyTier(r.launchDate ?? null) }))
    .filter((r) => allowedTiers.has(r.tier))
    .map((r) => toPickedPhone(r));

  return applyShardAndLimit(ranked, opts);
}

/**
 * Returns phones that should be retried: recent retriable failures (including
 * legacy rows without error_code), incomplete last_ingest_status, and/or
 * empty corpus.
 */
export async function pickResumePhones(
  db: Db,
  opts: PickResumePhonesOptions = {},
): Promise<PickedPhone[]> {
  const windowMs = opts.windowMs ?? DEFAULT_RESUME_WINDOW_MS;
  const errorCodes = opts.errorCodes ?? [...RETRIABLE_ERROR_CODES];
  const includeEmptyCorpus = opts.includeEmptyCorpus ?? true;
  const since = new Date(Date.now() - windowMs);
  const now = new Date();

  const phoneIdSet = new Set<string>();
  const priority = new Map<string, number>();

  const bump = (id: string, score: number) => {
    phoneIdSet.add(id);
    const prev = priority.get(id) ?? 0;
    if (score > prev) priority.set(id, score);
  };

  const failedRows = await db
    .selectDistinct({ phoneId: ingestRuns.phoneId })
    .from(ingestRuns)
    .where(retriableFailureWhere(since, now, errorCodes));

  for (const r of failedRows) {
    if (r.phoneId) bump(r.phoneId, 3);
  }

  const incompleteRows = await db
    .select({ id: phones.id })
    .from(phones)
    .where(
      and(
        sql`${phones.status} in ('active', 'upcoming')`,
        inArray(phones.lastIngestStatus, [...INCOMPLETE_INGEST_STATUSES]),
      ),
    );

  for (const r of incompleteRows) {
    bump(r.id, 2);
  }

  if (includeEmptyCorpus) {
    const emptyRows = await db
      .select({ id: phones.id })
      .from(phones)
      .where(
        and(
          sql`${phones.status} in ('active', 'upcoming')`,
          sql`not exists (select 1 from chunks c where c.phone_id = ${phones.id})`,
        ),
      );
    for (const r of emptyRows) {
      bump(r.id, 1);
    }
  }

  if (phoneIdSet.size === 0) return [];

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(inArray(phones.id, [...phoneIdSet]));

  const ranked = rows
    .map((r) => toPickedPhone(r))
    .sort((a, b) => (priority.get(b.id) ?? 0) - (priority.get(a.id) ?? 0));

  return applyShardAndLimit(ranked, opts);
}

/**
 * Source URLs that failed for a phone in the recent window (retriable codes +
 * legacy error text).
 */
export async function getFailedCandidatesForPhone(
  db: Db,
  phoneId: string,
  opts: { windowMs?: number; errorCodes?: readonly string[] } = {},
): Promise<FailedCandidate[]> {
  const windowMs = opts.windowMs ?? DEFAULT_RESUME_WINDOW_MS;
  const errorCodes = opts.errorCodes ?? [...RETRIABLE_ERROR_CODES];
  const since = new Date(Date.now() - windowMs);
  const now = new Date();

  const rows = await db
    .select({
      sourceUrl: ingestRuns.sourceUrl,
      adapter: ingestRuns.adapter,
      stage: ingestRuns.stage,
      errorCode: ingestRuns.errorCode,
      candidateTitle: ingestRuns.candidateTitle,
    })
    .from(ingestRuns)
    .where(
      and(
        eq(ingestRuns.phoneId, phoneId),
        retriableFailureWhere(since, now, errorCodes),
        isNotNull(ingestRuns.sourceUrl),
      ),
    );

  const seen = new Set<string>();
  const out: FailedCandidate[] = [];
  for (const r of rows) {
    if (!r.sourceUrl || seen.has(r.sourceUrl)) continue;
    seen.add(r.sourceUrl);
    out.push({
      sourceUrl: r.sourceUrl,
      adapter: r.adapter,
      stage: r.stage ?? 'unknown',
      errorCode: r.errorCode ?? 'unknown',
      title: r.candidateTitle ?? r.sourceUrl,
    });
  }
  return out;
}
