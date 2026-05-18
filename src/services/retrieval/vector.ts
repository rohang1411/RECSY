/**
 * Vector search retriever (cosine similarity via pgvector HNSW).
 *
 * Responsibilities:
 *   - Convert `RetrievalRequest.queryEmbedding` into a ranked set of chunks
 *     scored by `1 - cosine_distance`, phone-scoped.
 *   - Join `sources` in a single query so callers can render citations
 *     without an N+1.
 *
 * Non-responsibilities:
 *   - We do **not** embed the query here. Embedding is a shared concern
 *     between vector search and potential future HyDE / multi-query
 *     variants, so the orchestrator embeds once and passes the vector to
 *     every embedding-consuming retriever.
 *   - We do **not** know about FTS, RRF, MMR, or generation. Those live
 *     one layer up in {@link ../retriever.ts}.
 *
 * Implementation notes:
 *   - The `postgres` driver wants a Postgres vector literal string
 *     (`[0.1,0.2,...]`) when we pass an array through an `::vector` cast.
 *     Building the literal ourselves sidesteps the driver's array handling
 *     which would otherwise send `{0.1,0.2,...}` (Postgres array syntax).
 *   - HNSW cosine ops use the `<=>` operator; distance is in [0, 2] for
 *     vectors that aren't L2-normalised and [0, 2] for any vector pair in
 *     cosine space. We convert to a similarity score `1 - distance`
 *     (higher = better) to match the retriever contract.
 *   - We request the full `embedding` column too so downstream MMR has the
 *     vectors without a second round-trip.
 */
import type { Logger } from 'pino';
import type postgres from 'postgres';

import { ValidationError } from '@/lib/errors';

import { toRetrievedPublishedAt } from './dates';
import type { RetrievalRequest, RetrievedChunk, Retriever } from './types';

const EMBEDDING_DIMS = 768;

/**
 * Build the Postgres vector literal for an array of numbers.
 *
 * `[0.1, 0.2, 0.3]` → `"[0.1,0.2,0.3]"`
 *
 * Exported for direct use by other retrieval primitives and for test
 * reuse. Not part of the public retrieval API.
 */
export function toVectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(',')}]`;
}

interface VectorSearchRow {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly chunk_text: string;
  readonly distance: number;
  readonly start_ts: number | null;
  readonly anchor: string | null;
  readonly embedding: string | null;
  readonly src_url: string;
  readonly src_title: string;
  readonly src_type: 'youtube' | 'reddit' | 'article';
  readonly src_author: string | null;
  readonly src_channel: string | null;
  readonly src_published_at: Date | string | null;
}

export interface VectorSearchDeps {
  readonly sql: postgres.Sql;
  readonly log: Logger;
}

export interface VectorSearchOptions {
  /**
   * If true, return `embedding` on each chunk for downstream MMR. The
   * extra column is ~6 KB per row — small but worth skipping when no
   * downstream step needs it.
   */
  readonly withEmbeddings?: boolean;
}

/**
 * Cosine-nearest chunks for a phone, given a pre-computed query embedding.
 */
export class VectorSearch implements Retriever {
  readonly name = 'vector';

  constructor(
    private readonly deps: VectorSearchDeps,
    private readonly opts: VectorSearchOptions = {},
  ) {}

  async search(request: RetrievalRequest): Promise<readonly RetrievedChunk[]> {
    const { phoneId, k, queryEmbedding } = request;

    if (!queryEmbedding || queryEmbedding.length === 0) {
      throw new ValidationError('VectorSearch requires a precomputed queryEmbedding', {
        phoneId,
      });
    }
    if (queryEmbedding.length !== EMBEDDING_DIMS) {
      throw new ValidationError(
        `queryEmbedding must have ${EMBEDDING_DIMS} dims, got ${queryEmbedding.length}`,
        { phoneId },
      );
    }

    const { sql } = this.deps;
    const vecLit = toVectorLiteral(queryEmbedding);

    // Cast the literal inline with `::vector` so the driver doesn't try to
    // coerce the string into a Postgres text[] (the default for string[] is
    // `text[]`, which would blow up with an operator mismatch on `<=>`).
    //
    // Selecting `embedding::text` (or not) based on `withEmbeddings` keeps
    // the hot path cheap for callers that don't need MMR.
    const rows = this.opts.withEmbeddings
      ? await sql<VectorSearchRow[]>`
          SELECT c.id                         AS chunk_id,
                 c.source_id                  AS source_id,
                 c.text                       AS chunk_text,
                 c.embedding <=> ${vecLit}::vector AS distance,
                 c.start_ts                   AS start_ts,
                 c.anchor                     AS anchor,
                 c.embedding::text            AS embedding,
                 s.url                        AS src_url,
                 s.title                      AS src_title,
                 s.type                       AS src_type,
                 s.author                     AS src_author,
                 s.channel                    AS src_channel,
                 s.published_at               AS src_published_at
            FROM chunks c
            JOIN sources s ON s.id = c.source_id
           WHERE c.phone_id = ${phoneId}
             AND s.status   = 'active'
           ORDER BY c.embedding <=> ${vecLit}::vector
           LIMIT ${k}
        `
      : await sql<VectorSearchRow[]>`
          SELECT c.id                         AS chunk_id,
                 c.source_id                  AS source_id,
                 c.text                       AS chunk_text,
                 c.embedding <=> ${vecLit}::vector AS distance,
                 c.start_ts                   AS start_ts,
                 c.anchor                     AS anchor,
                 NULL::text                   AS embedding,
                 s.url                        AS src_url,
                 s.title                      AS src_title,
                 s.type                       AS src_type,
                 s.author                     AS src_author,
                 s.channel                    AS src_channel,
                 s.published_at               AS src_published_at
            FROM chunks c
            JOIN sources s ON s.id = c.source_id
           WHERE c.phone_id = ${phoneId}
             AND s.status   = 'active'
           ORDER BY c.embedding <=> ${vecLit}::vector
           LIMIT ${k}
        `;

    this.deps.log.debug(
      { phoneId, k, rows: rows.length, retriever: this.name },
      'vector search complete',
    );

    return rows.map<RetrievedChunk>((r) => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      text: r.chunk_text,
      // Cosine distance (0..2, 0 == identical) -> similarity (higher = better).
      // Clamp to [0, 1] for display; scores > 1 would mean antipodal vectors
      // which pgvector won't return for normalised embeddings anyway.
      score: Math.max(0, 1 - Number(r.distance)),
      startTs: r.start_ts,
      anchor: r.anchor,
      embedding: parseVectorLiteral(r.embedding),
      source: {
        id: r.source_id,
        url: r.src_url,
        title: r.src_title,
        type: r.src_type,
        author: r.src_author,
        channel: r.src_channel,
        publishedAt: toRetrievedPublishedAt(r.src_published_at),
      },
    }));
  }
}

/**
 * Parse a Postgres vector literal (`"[0.1,0.2,...]"`) back into numbers.
 *
 * Returns undefined on null / empty string so callers can preserve the
 * optional-ness of {@link RetrievedChunk.embedding}.
 */
function parseVectorLiteral(literal: string | null): readonly number[] | undefined {
  if (!literal) return undefined;
  // Strip surrounding brackets. Defensive against driver quirks.
  const trimmed = literal.startsWith('[') ? literal.slice(1, -1) : literal;
  if (!trimmed) return undefined;
  return trimmed.split(',').map(Number);
}
