#!/usr/bin/env tsx
/**
 * Run EXPLAIN (ANALYZE, BUFFERS) directly inside PostgreSQL
 * to measure actual database engine execution time (excluding network RTT).
 */
import { getPostgres } from '@/services/db/client';

async function main(): Promise<void> {
  const sql = getPostgres();

  // Find a phone with chunks
  const [sample] = await sql`
    SELECT phone_id, embedding FROM chunks WHERE embedding IS NOT NULL LIMIT 1;
  `;

  if (!sample) {
    console.error('No embedded chunk found in DB');
    process.exit(1);
  }

  const phoneId = sample.phone_id;
  const embedding = sample.embedding;

  console.log(`[db-server-latency] Running EXPLAIN ANALYZE on live PostgreSQL...`);

  // 1. Vector Search Query Execution Time inside Postgres
  const vectorExplain = await sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, phone_id, text, (1 - (embedding <=> ${embedding}::vector)) AS similarity
    FROM chunks
    WHERE phone_id = ${phoneId}
    ORDER BY embedding <=> ${embedding}::vector
    LIMIT 30;
  `;

  console.log('\n--- VECTOR SEARCH (HNSW) POSTGRES EXPLAIN ANALYZE ---');
  for (const row of vectorExplain) {
    console.log(row['QUERY PLAN']);
  }

  // 2. Full-Text Search Query Execution Time inside Postgres
  const ftsExplain = await sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, phone_id, text, ts_rank_cd(text_tsv, websearch_to_tsquery('english', 'battery life screen')) AS rank
    FROM chunks
    WHERE phone_id = ${phoneId}
      AND text_tsv @@ websearch_to_tsquery('english', 'battery life screen')
    ORDER BY rank DESC
    LIMIT 30;
  `;

  console.log('\n--- FULL-TEXT SEARCH (GIN tsvector) POSTGRES EXPLAIN ANALYZE ---');
  for (const row of ftsExplain) {
    console.log(row['QUERY PLAN']);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
