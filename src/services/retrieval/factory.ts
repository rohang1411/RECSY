/**
 * Hybrid retriever factory — constructs and caches the `HybridRetriever` singleton.
 *
 * `createHybridRetriever(opts?)` wires together `VectorSearch`, `FtsSearch`,
 * and optional `LlmReranker` into a `HybridRetriever`. On first call, the
 * retriever is cached at process scope (one postgres pool, one embedder).
 * Subsequent calls return the cached instance.
 *
 * Call `resetHybridRetriever()` in tests to clear the singleton.
 *
 * Used by: `src/app/api/ask/route.ts`, `src/services/chat/answer.ts`,
 *          `src/services/scorecard/agent.ts`, `scripts/retrieval-smoke.ts`.
 */
import { env } from '@/env';
import { getPostgres } from '@/services/db/client';
import { getLlm } from '@/services/llm';
import { logger } from '@/services/logger';
import { FtsSearch } from './fts';
import { HybridRetriever } from './retriever';
import { VectorSearch } from './vector';

const root = logger.child({ component: 'retrieval' });

/** Process-wide hybrid retriever wired to Postgres + Gemini embeddings. */
export function createHybridRetriever(): HybridRetriever {
  const sql = getPostgres();
  return new HybridRetriever({
    vector: new VectorSearch(
      { sql, log: root.child({ retriever: 'vector' }) },
      { withEmbeddings: true },
    ),
    fts: new FtsSearch({ sql, log: root.child({ retriever: 'fts' }) }),
    llm: getLlm(),
    log: root.child({ component: 'hybrid-retriever' }),
    embeddingModel: env.LLM_EMBEDDING_MODEL,
  });
}
