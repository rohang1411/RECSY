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
