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

import { chunks, ingestRuns, sources } from '@/services/db/schema';
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
    const { phoneId, type, raw, preparedChunks, embeddingModel, adapterName } = input;
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

        const finishedAt = new Date();
        await tx.insert(ingestRuns).values({
          adapter: adapterName,
          phoneId,
          sourceUrl: url,
          status: 'success',
          chunksCreated: preparedChunks.length,
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
}
