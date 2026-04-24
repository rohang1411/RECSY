/**
 * Idempotent ingestion writer.
 *
 * Responsibilities:
 *   1. Upsert the `sources` row keyed by `(phone_id, url)`. If the existing
 *      row's `content_hash` matches the candidate's hash, this is a no-op
 *      and the writer returns `{ skipped: true }` — the caller should NOT
 *      re-embed or re-insert chunks.
 *   2. Otherwise, replace the source's chunks atomically: delete-by-source
 *      then insert the new batch with their embeddings.
 *   3. Append an `ingest_runs` row capturing per-source telemetry.
 *
 * All DB work for a single source happens in one transaction so a partial
 * failure leaves no half-written state.
 */
import { eq, sql } from 'drizzle-orm';

import { chunks, ingestRuns, sourcePhoneLinks, sources } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type { getDb } from '../db/client';
import type { RawChunk, RawSource, SourceType } from './types';

export type Db = ReturnType<typeof getDb>;

export interface WriteSourceInput {
  readonly phoneId: string;
  readonly type: SourceType;
  readonly raw: RawSource;
  /** Aligned 1:1 with `raw` chunks emitted by the adapter. */
  readonly preparedChunks: readonly PreparedChunk[];
  readonly embeddingModel: string;
  readonly adapterName: string;
  /**
   * Optional Curator-provided enrichment. Persisted to `sources` alongside
   * the body so downstream code (UI, audits) can filter/sort by quality.
   */
  readonly enrichment?: SourceEnrichment;
  /** Freshness tier this run was part of; mirrored into `ingest_runs.tier`. */
  readonly tier?: 'hot' | 'warm' | 'cold' | null;
  /** Optional discovery strategy label recorded in `ingest_runs.discovery_strategy`. */
  readonly discoveryStrategy?: string | null;
  /**
   * Optional secondary phone links (from Disambiguator). The primary phone is
   * always `phoneId` above; these are additional phones that received real
   * screen time (e.g. comparison videos). Written to `source_phone_links`
   * in the same transaction.
   */
  readonly secondaryPhoneLinks?: readonly {
    readonly phoneId: string;
    readonly relevance?: number | null;
  }[];
  /** Relevance for the primary phone in source_phone_links. */
  readonly primaryRelevance?: number | null;
}

/** Curator-populated source-level metadata. All fields are optional. */
export interface SourceEnrichment {
  readonly relevance?: number;
  readonly quality?: number;
  readonly sentimentSummary?: 'positive' | 'mixed' | 'negative' | 'neutral';
  readonly aspectsCovered?: readonly string[];
  readonly viewCount?: number;
  readonly engagementScore?: number;
  readonly publishedPrecision?: 'day' | 'month' | 'year';
}

export interface PreparedChunk {
  readonly raw: RawChunk;
  readonly embedding: readonly number[];
}

export interface WriteResult {
  readonly skipped: boolean;
  readonly sourceId: string;
  readonly chunkCount: number;
  readonly reason?: 'unchanged-content';
}

export class IngestionWriter {
  private readonly log = logger.child({ component: 'ingest.writer' });

  constructor(private readonly db: Db) {}

  async writeSource(input: WriteSourceInput): Promise<WriteResult> {
    const {
      phoneId,
      type,
      raw,
      preparedChunks,
      embeddingModel,
      adapterName,
      enrichment,
      tier,
      discoveryStrategy,
      secondaryPhoneLinks,
      primaryRelevance,
    } = input;
    const startedAt = new Date();
    const url = raw.candidate.url;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Look for an existing source by (phone_id, url).
        const existing = await tx
          .select({ id: sources.id, contentHash: sources.contentHash })
          .from(sources)
          .where(sql`${sources.phoneId} = ${phoneId} and ${sources.url} = ${url}`)
          .limit(1);

        const sourceRow = {
          phoneId,
          type,
          url,
          title: raw.candidate.title,
          author: raw.candidate.author,
          channel: raw.candidate.channel,
          language: raw.candidate.language,
          publishedAt: raw.candidate.publishedAt ? new Date(raw.candidate.publishedAt) : null,
          lastFetchedAt: new Date(),
          contentHash: raw.contentHash,
          status: 'active' as const,
          rawJson: raw.raw as Record<string, unknown>,
          // Curator-populated enrichment (all optional / nullable columns).
          relevance: enrichment?.relevance !== undefined ? String(enrichment.relevance) : null,
          quality: enrichment?.quality !== undefined ? String(enrichment.quality) : null,
          sentimentSummary: enrichment?.sentimentSummary ?? null,
          aspectsCovered: enrichment?.aspectsCovered ? [...enrichment.aspectsCovered] : [],
          viewCount: enrichment?.viewCount ?? null,
          engagementScore:
            enrichment?.engagementScore !== undefined ? String(enrichment.engagementScore) : null,
          publishedPrecision: enrichment?.publishedPrecision ?? null,
        };

        // 2. If hash matches → bump lastFetchedAt only and return early.
        const prior = existing[0];
        if (prior && prior.contentHash === raw.contentHash) {
          const finishedAt = new Date();
          await tx
            .update(sources)
            .set({ lastFetchedAt: finishedAt, updatedAt: finishedAt })
            .where(eq(sources.id, prior.id));

          await tx.insert(ingestRuns).values({
            adapter: adapterName,
            phoneId,
            sourceUrl: url,
            status: 'skipped',
            chunksCreated: 0,
            tier: tier ?? null,
            discoveryStrategy: discoveryStrategy ?? null,
            rejectedReason: 'unchanged-content',
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          });

          return {
            skipped: true,
            sourceId: prior.id,
            chunkCount: 0,
            reason: 'unchanged-content' as const,
          };
        }

        // 3. Upsert source row.
        const [upserted] = await tx
          .insert(sources)
          .values(sourceRow)
          .onConflictDoUpdate({
            target: [sources.phoneId, sources.url],
            set: {
              title: sql`excluded.title`,
              author: sql`excluded.author`,
              channel: sql`excluded.channel`,
              language: sql`excluded.language`,
              publishedAt: sql`excluded.published_at`,
              lastFetchedAt: sql`excluded.last_fetched_at`,
              contentHash: sql`excluded.content_hash`,
              status: sql`excluded.status`,
              rawJson: sql`excluded.raw_json`,
              relevance: sql`excluded.relevance`,
              quality: sql`excluded.quality`,
              sentimentSummary: sql`excluded.sentiment_summary`,
              aspectsCovered: sql`excluded.aspects_covered`,
              viewCount: sql`excluded.view_count`,
              engagementScore: sql`excluded.engagement_score`,
              publishedPrecision: sql`excluded.published_precision`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: sources.id });

        if (!upserted) {
          throw new Error('source upsert returned no row');
        }
        const sourceId = upserted.id;

        // 4. Replace chunks for this source atomically.
        await tx.delete(chunks).where(eq(chunks.sourceId, sourceId));

        if (preparedChunks.length > 0) {
          await tx.insert(chunks).values(
            preparedChunks.map((pc) => ({
              sourceId,
              phoneId,
              chunkIndex: pc.raw.chunkIndex,
              text: pc.raw.text,
              startTs: pc.raw.startTs ?? null,
              endTs: pc.raw.endTs ?? null,
              anchor: pc.raw.anchor ?? null,
              tokens: pc.raw.tokens,
              embedding: [...pc.embedding],
              embeddingModel,
              metadata: (pc.raw.metadata ?? {}) as Record<string, unknown>,
            })),
          );
        }

        // 5. Replace source_phone_links for this source atomically. One row
        // for the primary phone (role=primary) + one per secondary.
        const linkRows: Array<{
          sourceId: string;
          phoneId: string;
          role: 'primary' | 'secondary';
          relevance: string | null;
        }> = [
          {
            sourceId,
            phoneId,
            role: 'primary',
            relevance: primaryRelevance != null ? String(primaryRelevance) : null,
          },
        ];
        const seenLinkPhones = new Set([phoneId]);
        for (const link of secondaryPhoneLinks ?? []) {
          if (seenLinkPhones.has(link.phoneId)) continue;
          seenLinkPhones.add(link.phoneId);
          linkRows.push({
            sourceId,
            phoneId: link.phoneId,
            role: 'secondary',
            relevance: link.relevance != null ? String(link.relevance) : null,
          });
        }
        await tx.delete(sourcePhoneLinks).where(eq(sourcePhoneLinks.sourceId, sourceId));
        if (linkRows.length > 0) {
          await tx.insert(sourcePhoneLinks).values(linkRows);
        }

        const finishedAt = new Date();
        await tx.insert(ingestRuns).values({
          adapter: adapterName,
          phoneId,
          sourceUrl: url,
          status: 'success',
          chunksCreated: preparedChunks.length,
          tier: tier ?? null,
          discoveryStrategy: discoveryStrategy ?? null,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        });

        return { skipped: false, sourceId, chunkCount: preparedChunks.length };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ url, err: message }, 'writer transaction failed');
      // Best-effort failure record (outside the failed transaction).
      try {
        await this.db.insert(ingestRuns).values({
          adapter: adapterName,
          phoneId,
          sourceUrl: url,
          status: 'failed',
          chunksCreated: 0,
          error: message.slice(0, 2_000),
          startedAt,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        });
      } catch {
        // ignore — DB likely unavailable
      }
      throw err;
    }
  }

  /**
   * Record a run that was filtered out before any DB writes — e.g. the
   * CuratorAgent rejected the source as off-topic/low-quality. We still want
   * this in `ingest_runs` so audits show why a candidate was dropped.
   */
  async recordRejectedRun(input: {
    readonly adapterName: string;
    readonly phoneId: string;
    readonly sourceUrl: string;
    readonly rejectedReason: string;
    readonly tier?: 'hot' | 'warm' | 'cold' | null;
    readonly discoveryStrategy?: string | null;
    readonly error?: string | null;
  }): Promise<void> {
    const startedAt = new Date();
    try {
      await this.db.insert(ingestRuns).values({
        adapter: input.adapterName,
        phoneId: input.phoneId,
        sourceUrl: input.sourceUrl,
        status: 'skipped',
        chunksCreated: 0,
        rejectedReason: input.rejectedReason,
        tier: input.tier ?? null,
        discoveryStrategy: input.discoveryStrategy ?? null,
        error: input.error ? input.error.slice(0, 2_000) : null,
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ url: input.sourceUrl, err: message }, 'failed to record rejected ingest run');
    }
  }
}
