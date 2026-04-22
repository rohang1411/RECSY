import type { RetrievedChunk, RetrievalResult } from '@/services/retrieval/types';

/**
 * Serializable summary for the `/api/ask` client — how hybrid retrieval composed
 * the context (stages + distinct sources). No chunk text (too large for JSON).
 */
export interface AskRetrievalTrace {
  readonly chunkCount: number;
  readonly distinctSourceCount: number;
  /** `true` when the diversity floor could not be met with available sources. */
  readonly coverageRelaxed: boolean;
  readonly totalMs: number;
  readonly stages: readonly {
    readonly name: string;
    readonly ms: number;
    readonly count?: number;
  }[];
  readonly sources: readonly {
    readonly title: string;
    readonly type: string;
    readonly url: string;
  }[];
}

function dedupeSources(chunks: readonly RetrievedChunk[]) {
  const seen = new Set<string>();
  const out: { title: string; type: string; url: string }[] = [];
  for (const c of chunks) {
    const k = c.sourceId;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      title: c.source.title,
      type: c.source.type,
      url: c.source.url,
    });
  }
  return out;
}

export function buildAskRetrievalTrace(retrieval: RetrievalResult): AskRetrievalTrace {
  const { debug, chunks } = retrieval;
  const stages: {
    name: string;
    ms: number;
    count?: number;
  }[] = [
    { name: 'Vector (embed + cosine)', ms: Math.round(debug.vector.ms), count: debug.vector.count },
    { name: 'Full-text search', ms: Math.round(debug.fts.ms), count: debug.fts.count },
    { name: 'RRF fusion', ms: Math.round(debug.rrf.ms), count: debug.rrf.count },
    { name: 'MMR diversify', ms: Math.round(debug.mmr.ms), count: debug.mmr.count },
  ];
  if (debug.llmRerank) {
    stages.push({
      name: debug.llmRerank.applied ? 'LLM rerank' : 'LLM rerank (skipped)',
      ms: Math.round(debug.llmRerank.ms),
      count: debug.llmRerank.poolSize,
    });
  }

  return {
    chunkCount: chunks.length,
    distinctSourceCount: dedupeSources(chunks).length,
    coverageRelaxed: debug.coverage.relaxed,
    totalMs: Math.round(debug.totalMs),
    stages: stages as AskRetrievalTrace['stages'],
    sources: dedupeSources(chunks),
  };
}
