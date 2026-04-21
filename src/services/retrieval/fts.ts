/**
 * Full-text search retriever (Postgres tsvector + pg_trgm fallback).
 *
 * Responsibilities:
 *   - Convert a user query into a ranked set of chunks via
 *     `websearch_to_tsquery` against the `chunks.text_tsv` generated
 *     column (English config, GIN-indexed — see `drizzle/fts.sql`).
 *   - Fall back to `pg_trgm similarity()` when tsvector returns zero
 *     rows: handles short tokens, misspellings, and model numbers that
 *     the English stemmer mangles.
 *
 * Non-responsibilities:
 *   - We do not fuse with other retrievers here. That's RRF's job.
 *   - We do not ask the planner to prefer the GIN index — the generated
 *     column + GIN means `websearch_to_tsquery` @@ `text_tsv` is
 *     index-backed by default.
 *
 * Query sanitisation:
 *   - `websearch_to_tsquery` is deliberately forgiving; it accepts "google
 *     pixel or samsung" and friendlier phrase syntax. We still strip
 *     control characters and cap length to 2 KB so we don't ship
 *     pathological inputs to Postgres.
 *   - For trigram fallback, we lowercase + trim. `gin_trgm_ops` handles
 *     the rest.
 */
import type { Logger } from 'pino';
import type postgres from 'postgres';

import { ValidationError } from '@/lib/errors';

import type { RetrievalRequest, RetrievedChunk, Retriever } from './types';

const MAX_QUERY_BYTES = 2048;
/** Trigram similarity floor; rows below this contribute nothing useful. */
const TRIGRAM_MIN_SIMILARITY = 0.2;

interface FtsSearchRow {
  readonly chunk_id: string;
  readonly source_id: string;
  readonly chunk_text: string;
  readonly rank: number;
  readonly start_ts: number | null;
  readonly anchor: string | null;
  readonly src_url: string;
  readonly src_title: string;
  readonly src_type: 'youtube' | 'reddit' | 'article';
  readonly src_author: string | null;
  readonly src_channel: string | null;
  readonly src_published_at: Date | null;
}

export interface FtsSearchDeps {
  readonly sql: postgres.Sql;
  readonly log: Logger;
}

export class FtsSearch implements Retriever {
  readonly name = 'fts';

  constructor(private readonly deps: FtsSearchDeps) {}

  async search(request: RetrievalRequest): Promise<readonly RetrievedChunk[]> {
    const { phoneId, query, k } = request;

    const normalised = sanitiseQuery(query);
    if (!normalised) {
      throw new ValidationError('FtsSearch received an empty query after sanitisation', {
        phoneId,
      });
    }

    const { sql, log } = this.deps;

    // Tier 1: tsvector match via websearch_to_tsquery + ts_rank_cd. Fast
    // path; handles 95% of user intent.
    const tsvRows = await sql<FtsSearchRow[]>`
      WITH q AS (
        SELECT websearch_to_tsquery('english', ${normalised}) AS query
      )
      SELECT c.id                                            AS chunk_id,
             c.source_id                                     AS source_id,
             c.text                                          AS chunk_text,
             ts_rank_cd(c.text_tsv, q.query)                 AS rank,
             c.start_ts                                      AS start_ts,
             c.anchor                                        AS anchor,
             s.url                                           AS src_url,
             s.title                                         AS src_title,
             s.type                                          AS src_type,
             s.author                                        AS src_author,
             s.channel                                       AS src_channel,
             s.published_at                                  AS src_published_at
        FROM chunks c
        JOIN sources s ON s.id = c.source_id,
             q
       WHERE c.phone_id = ${phoneId}
         AND s.status   = 'active'
         AND c.text_tsv @@ q.query
       ORDER BY rank DESC
       LIMIT ${k}
    `;

    if (tsvRows.length > 0) {
      log.debug(
        { phoneId, k, rows: tsvRows.length, mode: 'tsvector', retriever: this.name },
        'FTS search complete',
      );
      return tsvRows.map(rowToChunk);
    }

    // Tier 2: pg_trgm similarity fallback. Only triggered when tsvector
    // returned nothing — typical cause is a one-word query whose stem is
    // too short, or a model-number collision.
    log.debug(
      { phoneId, query: normalised.slice(0, 64) },
      'tsvector empty; falling back to trigram similarity',
    );

    const trgmRows = await sql<FtsSearchRow[]>`
      SELECT c.id                              AS chunk_id,
             c.source_id                       AS source_id,
             c.text                            AS chunk_text,
             similarity(c.text, ${normalised}) AS rank,
             c.start_ts                        AS start_ts,
             c.anchor                          AS anchor,
             s.url                             AS src_url,
             s.title                           AS src_title,
             s.type                            AS src_type,
             s.author                          AS src_author,
             s.channel                         AS src_channel,
             s.published_at                    AS src_published_at
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
       WHERE c.phone_id = ${phoneId}
         AND s.status   = 'active'
         AND similarity(c.text, ${normalised}) > ${TRIGRAM_MIN_SIMILARITY}
       ORDER BY rank DESC
       LIMIT ${k}
    `;

    log.debug(
      { phoneId, k, rows: trgmRows.length, mode: 'trigram', retriever: this.name },
      'FTS search complete',
    );
    return trgmRows.map(rowToChunk);
  }
}

function rowToChunk(r: FtsSearchRow): RetrievedChunk {
  return {
    chunkId: r.chunk_id,
    sourceId: r.source_id,
    text: r.chunk_text,
    score: Number(r.rank),
    startTs: r.start_ts,
    anchor: r.anchor,
    source: {
      id: r.source_id,
      url: r.src_url,
      title: r.src_title,
      type: r.src_type,
      author: r.src_author,
      channel: r.src_channel,
      publishedAt: r.src_published_at,
    },
  };
}

/**
 * Defensive query cleanup.
 *
 * - Strips control characters (C0 + DEL) that `websearch_to_tsquery`
 *   would pass through to `ts_tokenize`, sometimes producing weird
 *   whitespace-only queries.
 * - Clamps to 2 KB. Longer queries are almost always pathology
 *   (copy-pasted articles, etc.) and not meaningful retrieval signal.
 *
 * Exported for test use.
 */
export function sanitiseQuery(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  const bytes = Buffer.byteLength(clean, 'utf8');
  if (bytes > MAX_QUERY_BYTES) {
    // Slice by chars is imperfect for UTF-8 but good enough as a safety net.
    return clean.slice(0, MAX_QUERY_BYTES);
  }
  return clean;
}
