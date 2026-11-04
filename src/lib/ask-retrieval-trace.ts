import type { RetrievedChunk, RetrievalResult } from '@/services/retrieval/types';
import { buildCitationUrl, type ResolvedCitation } from '@/services/chat/citations';

/**
 * An individual evidence chunk retained in the hybrid retrieval context
 * with complete provenance and attribution metadata.
 */
export interface EvidenceChunkTrace {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourceType: RetrievedChunk['source']['type'];
  readonly sourceUrl: string;
  readonly author?: string | null;
  readonly channel?: string | null;
  readonly text: string;
  readonly score: number;
  readonly startTs?: number | null;
  readonly anchor?: string | null;
  readonly isCited: boolean;
  readonly citationIndices: readonly number[];
  readonly whyReferenced: string;
}

export interface AskTraceSource {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly url: string;
  readonly author?: string | null;
  readonly channel?: string | null;
  readonly whyReferenced: string;
}

export interface AskTraceStage {
  readonly id: string;
  readonly name: string;
  readonly ms: number;
  readonly count?: number;
  readonly detail?: string;
}

/**
 * Serializable summary for the `/api/ask` client — how hybrid retrieval composed
 * the context (stages, distinct sources, and full evidence chunks for the provenance observatory).
 */
export interface AskRetrievalTrace {
  readonly chunkCount: number;
  readonly distinctSourceCount: number;
  /** `true` when the diversity floor could not be met with available sources. */
  readonly coverageRelaxed: boolean;
  readonly totalMs: number;
  readonly degradedStages: readonly string[];
  readonly excludedSourceChunkIds?: readonly string[];
  readonly stages: readonly AskTraceStage[];
  readonly sources: readonly AskTraceSource[];
  readonly evidenceChunks: readonly EvidenceChunkTrace[];
}

export function determineWhyReferenced(source: RetrievedChunk['source']): string {
  const t = source.type;
  if (t === 'youtube') {
    return source.channel
      ? `Hands-on video analysis & camera testing by ${source.channel}`
      : 'Hands-on reviewer video analysis & real-world camera testing';
  }
  if (t === 'reddit') {
    return 'Real-world owner discussions & long-term community feedback';
  }
  if (
    (t as string) === 'gsmarena' ||
    source.title.toLowerCase().includes('gsmarena') ||
    source.url.toLowerCase().includes('gsmarena')
  ) {
    return 'Laboratory bench testing & standardized sensor/battery metrics';
  }
  return source.author
    ? `Editorial hardware evaluation by ${source.author}`
    : 'Technical review, build quality & specification deep-dive';
}

function dedupeSources(chunks: readonly RetrievedChunk[]): AskTraceSource[] {
  const seen = new Set<string>();
  const out: AskTraceSource[] = [];
  for (const c of chunks) {
    const k = c.sourceId;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: c.source.id,
      title: c.source.title,
      type: c.source.type,
      url: c.source.url,
      author: c.source.author ?? null,
      channel: c.source.channel ?? null,
      whyReferenced: determineWhyReferenced(c.source),
    });
  }
  return out;
}

export function buildAskRetrievalTrace(
  retrieval: RetrievalResult,
  citations?: readonly ResolvedCitation[],
): AskRetrievalTrace {
  const { debug, chunks } = retrieval;

  // Build citation index map if citations were provided
  const chunkToIndices = new Map<string, number[]>();
  if (citations && citations.length > 0) {
    citations.forEach((c, idx) => {
      const key = c.chunkId.toLowerCase();
      const existing = chunkToIndices.get(key) ?? [];
      existing.push(idx + 1);
      chunkToIndices.set(key, existing);
    });
  }

  const stages: AskTraceStage[] = [
    {
      id: 'embedding',
      name: 'Query embedding',
      ms: Math.round(debug.embedding?.ms ?? 0),
      detail: 'Dense 768-dimensional semantic embedding via Gemini model',
    },
    {
      id: 'vector',
      name: debug.vector.error ? 'Vector search (unavailable)' : 'Vector cosine search',
      ms: Math.round(debug.vector.ms),
      count: debug.vector.count,
      detail: 'Nearest-neighbor cosine distance lookup across phone review chunks',
    },
    {
      id: 'fts',
      name: 'Full-text search',
      ms: Math.round(debug.fts.ms),
      count: debug.fts.count,
      detail: 'PostgreSQL ts_rank_cd full-text search for exact query keywords',
    },
    {
      id: 'rrf',
      name: 'RRF fusion',
      ms: Math.round(debug.rrf.ms),
      count: debug.rrf.count,
      detail: 'Reciprocal Rank Fusion merging dense semantic and lexical candidate lists',
    },
    {
      id: 'mmr',
      name: 'MMR diversify',
      ms: Math.round(debug.mmr.ms),
      count: debug.mmr.count,
      detail: 'Maximal Marginal Relevance penalizing duplicate coverage to ensure balanced sources',
    },
  ];

  if (debug.llmRerank) {
    stages.push({
      id: 'rerank',
      name: debug.llmRerank.applied ? 'LLM rerank' : 'LLM rerank (skipped)',
      ms: Math.round(debug.llmRerank.ms),
      count: debug.llmRerank.poolSize,
      detail: 'Targeted reranking of candidate excerpts against grounded prompt',
    });
  }

  if (debug.sourceQuality) {
    stages.push({
      id: 'source-quality',
      name: 'Known source-conflict filter',
      ms: Math.round(debug.sourceQuality.ms),
      count: debug.sourceQuality.excludedChunkIds.length,
      detail: 'Exclusion of known stale or conflicting community claims',
    });
  }

  const evidenceChunks: EvidenceChunkTrace[] = chunks.map((c) => {
    const indices = chunkToIndices.get(c.chunkId.toLowerCase()) ?? [];
    return {
      chunkId: c.chunkId,
      sourceId: c.sourceId,
      sourceTitle: c.source.title,
      sourceType: c.source.type,
      sourceUrl: buildCitationUrl(c),
      author: c.source.author ?? null,
      channel: c.source.channel ?? null,
      text: c.text.trim(),
      score: Math.round(c.score * 100) / 100,
      startTs: c.startTs ?? null,
      anchor: c.anchor ?? null,
      isCited: indices.length > 0,
      citationIndices: indices,
      whyReferenced: determineWhyReferenced(c.source),
    };
  });

  return {
    chunkCount: chunks.length,
    ...(debug.sourceQuality
      ? { excludedSourceChunkIds: debug.sourceQuality.excludedChunkIds }
      : {}),
    distinctSourceCount: dedupeSources(chunks).length,
    coverageRelaxed: debug.coverage.relaxed,
    totalMs: Math.round(debug.totalMs),
    degradedStages: [
      ...(debug.vector.error ? ['vector'] : []),
      ...(debug.fts.error ? ['fts'] : []),
    ],
    stages,
    sources: dedupeSources(chunks),
    evidenceChunks,
  };
}
