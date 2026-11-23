/**
 * Corrective RAG (CRAG) Pre-Inference Grounding Gate (Plan 31 WP-03).
 *
 * Evaluates semantic retrieval confidence before invoking the LLM synthesis engine.
 * Short-circuits with an honest abstention when evidence is insufficient (max similarity < 0.72
 * and 0 FTS hits), preventing parametric hallucination and saving 100% of generation tokens.
 */

import type { RetrievalResult } from '@/services/retrieval/types';

export const CRAG_SIMILARITY_THRESHOLD = 0.72;

export interface CragGateResult {
  readonly action: 'synthesize' | 'abstain';
  readonly maxSimilarity: number;
  readonly reason?: string;
}

export function evaluateRetrievalConfidence(retrieval: RetrievalResult): CragGateResult {
  if (retrieval.chunks.length === 0) {
    return { action: 'abstain', maxSimilarity: 0, reason: 'zero_chunks' };
  }

  // Preserved vector similarity from debug telemetry or retrieved chunks
  const maxSim =
    retrieval.debug?.vector?.maxSimilarity ??
    Math.max(
      ...retrieval.chunks.map((c) => {
        const withVec = c as { vectorSimilarity?: number };
        return typeof withVec.vectorSimilarity === 'number'
          ? withVec.vectorSimilarity
          : c.score > 0.05
            ? c.score
            : 0;
      }),
      0,
    );

  const ftsHits = retrieval.debug?.fts?.count ?? 0;

  if (maxSim >= CRAG_SIMILARITY_THRESHOLD || ftsHits > 0) {
    return { action: 'synthesize', maxSimilarity: maxSim };
  }

  return {
    action: 'abstain',
    maxSimilarity: maxSim,
    reason: `insufficient_semantic_confidence (max=${maxSim.toFixed(3)} < ${CRAG_SIMILARITY_THRESHOLD})`,
  };
}
