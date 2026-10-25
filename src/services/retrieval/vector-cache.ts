/**
 * Bounded Chunk Embedding Cache & Batch Fetcher.
 *
 * Prevents fetching large 768-dim embeddings in stage-one vector search,
 * fetching them only on demand for the exact bounded prefix used by MMR.
 *
 * Implements Phase C (DB-03) of the database optimization plan.
 */
import type postgres from 'postgres';

interface CacheEntry {
  readonly embedding: readonly number[];
  readonly expiresAt: number;
}

const CHUNK_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_SIZE = 1000; // Cap memory at ~3 MB

const chunkEmbeddingCache = new Map<string, CacheEntry>();

let hits = 0;
let misses = 0;

export function getCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

export function resetCacheStatsForTest(): void {
  hits = 0;
  misses = 0;
}

/**
 * Parse a Postgres vector literal (`"[0.1,0.2,...]"`) into an array of numbers.
 */
export function parseVectorLiteral(literal: string | null): readonly number[] | undefined {
  if (!literal) return undefined;
  const trimmed = literal.startsWith('[') ? literal.slice(1, -1) : literal;
  if (!trimmed) return undefined;
  return trimmed.split(',').map(Number);
}

/**
 * Batch-fetch embeddings for a bounded list of chunk IDs with in-memory caching.
 */
export async function batchFetchChunkEmbeddings(
  sql: postgres.Sql,
  chunkIds: readonly string[],
): Promise<Map<string, readonly number[]>> {
  const result = new Map<string, readonly number[]>();
  if (chunkIds.length === 0) return result;

  const missingIds: string[] = [];
  const now = Date.now();

  for (const id of chunkIds) {
    const cached = chunkEmbeddingCache.get(id);
    if (cached && now < cached.expiresAt) {
      hits++;
      result.set(id, cached.embedding);
    } else {
      misses++;
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    const rows = await sql<Array<{ id: string; embedding: string | null }>>`
      SELECT id, embedding::text AS embedding
      FROM chunks
      WHERE id IN ${sql(missingIds)}
        AND embedding IS NOT NULL
    `;

    for (const r of rows) {
      const parsed = parseVectorLiteral(r.embedding);
      if (parsed) {
        result.set(r.id, parsed);
        // Evict if cache exceeds maximum size
        if (chunkEmbeddingCache.size >= MAX_CACHE_SIZE) {
          const firstKey = chunkEmbeddingCache.keys().next().value;
          if (firstKey) chunkEmbeddingCache.delete(firstKey);
        }
        chunkEmbeddingCache.set(r.id, {
          embedding: parsed,
          expiresAt: now + CHUNK_CACHE_TTL_MS,
        });
      }
    }
  }

  return result;
}

/**
 * Invalidate chunk embedding cache (e.g. after ingest/source replacement).
 */
export function clearChunkEmbeddingCache(): void {
  chunkEmbeddingCache.clear();
}
