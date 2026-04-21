/**
 * Optional LLM rerank step (ADR 0004): Gemini Flash picks the final
 * `targetResults` chunk ids from a capped MMR pool. On any failure we
 * return `ok: false` so {@link HybridRetriever} can fall back to pure MMR +
 * coverage with no user-visible error.
 */
import { z } from 'zod';

import { env } from '@/env';
import type { LlmProvider } from '@/services/llm/types';

import type { RetrievedChunk } from './types';

const uuidStr = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export function createRerankChunkOrderSchema(targetResults: number) {
  return z.object({
    orderedChunkIds: z.array(uuidStr).length(targetResults),
  });
}

export interface LlmRerankInput<T extends RetrievedChunk = RetrievedChunk> {
  readonly llm: LlmProvider;
  readonly query: string;
  readonly pool: readonly T[];
  readonly targetResults: number;
  readonly poolSizeCap: number;
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export interface LlmRerankSuccess<T extends RetrievedChunk = RetrievedChunk> {
  readonly orderedChunks: readonly T[];
  readonly ms: number;
}

/**
 * Ask the LLM for a length-`targetResults` permutation of chunk ids drawn
 * only from the capped pool.
 */
export async function llmRerankChunkOrder<T extends RetrievedChunk>(
  input: LlmRerankInput<T>,
): Promise<
  | { readonly ok: true; readonly result: LlmRerankSuccess<T> }
  | { readonly ok: false; readonly reason: string; readonly ms: number }
> {
  const { llm, query, pool, targetResults, poolSizeCap, signal } = input;
  const model = input.model ?? env.LLM_CHAT_MODEL;
  const cap = Math.min(poolSizeCap, pool.length);
  const capped = pool.slice(0, cap);

  if (capped.length < targetResults) {
    return { ok: false, reason: 'pool_smaller_than_target', ms: 0 };
  }

  const excerpts = capped
    .map((c, i) => {
      const snippet = c.text.replace(/\s+/g, ' ').trim().slice(0, 400);
      return `${i + 1}. id=${c.chunkId}\n${snippet}`;
    })
    .join('\n\n');

  const schema = createRerankChunkOrderSchema(targetResults);
  const t0 = performance.now();

  try {
    const out = await llm.structured({
      model,
      temperature: 0,
      maxOutputTokens: 1024,
      signal,
      schema,
      schemaName: 'ChunkRerankOrder',
      schemaDescription: `Exactly ${targetResults} distinct chunk UUIDs from the excerpt list, most relevant first.`,
      messages: [
        {
          role: 'system',
          content: `You pick the ${targetResults} most relevant passage excerpts for the user's question. Output exactly ${targetResults} distinct chunk ids from the provided list only, best match first. Do not invent UUIDs.`,
        },
        {
          role: 'user',
          content: `QUESTION:\n${query}\n\nEXCERPTS:\n${excerpts}`,
        },
      ],
    });

    const ms = performance.now() - t0;
    const byId = new Map(capped.map((c) => [c.chunkId.toLowerCase(), c]));
    const orderedChunks: T[] = [];
    const used = new Set<string>();

    for (const id of out.value.orderedChunkIds) {
      const ch = byId.get(id.toLowerCase());
      if (!ch || used.has(ch.chunkId)) {
        return { ok: false, reason: `unknown_or_duplicate_id:${id}`, ms };
      }
      used.add(ch.chunkId);
      orderedChunks.push(ch);
    }

    if (orderedChunks.length !== targetResults) {
      return { ok: false, reason: 'resolved_count_mismatch', ms };
    }

    return { ok: true, result: { orderedChunks, ms } };
  } catch (err) {
    const ms = performance.now() - t0;
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason, ms };
  }
}

/**
 * Place LLM-chosen chunks first, then append the rest of the MMR list without
 * duplicates — feed this into {@link enforceSourceCoverage}.
 */
export function mergeLlmHeadWithMmrTail<T extends RetrievedChunk>(
  orderedHead: readonly T[],
  mmrFull: readonly T[],
): T[] {
  const seen = new Set(orderedHead.map((c) => c.chunkId));
  const tail: T[] = [];
  for (const c of mmrFull) {
    if (!seen.has(c.chunkId)) {
      tail.push(c);
      seen.add(c.chunkId);
    }
  }
  return [...orderedHead, ...tail];
}
