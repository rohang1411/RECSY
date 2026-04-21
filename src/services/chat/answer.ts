import type { Logger } from 'pino';

import { env } from '@/env';
import {
  MAX_CHAT_MESSAGE_BYTES,
  MIN_DISTINCT_SOURCES_IN_CONTEXT,
  MMR_LAMBDA,
  RETRIEVAL_TOP_K_POST_RERANK,
  RETRIEVAL_TOP_K_PRE_RERANK,
} from '@/lib/constants';
import { LlmError, ValidationError } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { chatQueries } from '@/services/db/schema';
import type { ChatMessage, ChatUsage, LlmProvider } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievalOptions, RetrievalResult } from '@/services/retrieval/types';

import { resolveCitations, validateCitationTags } from './citations';
import type { ResolvedCitation } from './citations';

export interface PhoneQnaInput {
  readonly phoneId: string;
  readonly query: string;
  readonly retriever: HybridRetriever;
  readonly llm: LlmProvider;
  readonly log: Logger;
  readonly signal?: AbortSignal;
  /** Overrides default retrieval knobs (e.g. tests or experiments). */
  readonly retrievalOptions?: RetrievalOptions;
}

export interface PhoneQnaResult {
  readonly text: string;
  readonly citations: ResolvedCitation[];
  readonly retrieval: RetrievalResult;
  readonly usage: ChatUsage;
  readonly model: string;
}

const SYSTEM_PREAMBLE = `You are RECSY — concise, neutral, and honest about smartphones.

Rules:
- Use ONLY the SOURCE EXCERPTS below. If they do not support an answer, say so.
- Every substantive factual claim needs an inline citation tag exactly like [c:CHUNK_UUID] where CHUNK_UUID is one of the ids shown in the excerpts.
- Place tags immediately after the sentence or clause they support.
- Do not invent chunk ids or facts.`;

function buildSourcesBlock(retrieval: RetrievalResult): string {
  return retrieval.chunks
    .map((c, i) => {
      const excerpt = c.text.replace(/\s+/g, ' ').trim();
      return [
        `### Excerpt ${i + 1}`,
        `id: ${c.chunkId}`,
        `source: ${c.source.title} (${c.source.type})`,
        excerpt,
      ].join('\n');
    })
    .join('\n\n');
}

function buildMessages(
  query: string,
  retrieval: RetrievalResult,
  retryInvalidAnswer: string | undefined,
): ChatMessage[] {
  const sources = buildSourcesBlock(retrieval);
  const userMain = `SOURCE EXCERPTS:\n${sources}\n\nQUESTION:\n${query}`;

  if (!retryInvalidAnswer) {
    return [
      { role: 'system', content: SYSTEM_PREAMBLE },
      { role: 'user', content: userMain },
    ];
  }

  const allowed = [...new Set(retrieval.chunks.map((c) => c.chunkId))].join(', ');
  return [
    {
      role: 'system',
      content: `${SYSTEM_PREAMBLE}\n\nCRITICAL: Your previous answer used invalid citation ids. Rewrite the full answer using ONLY these ids in [c:...] tags: ${allowed}`,
    },
    {
      role: 'user',
      content: `${userMain}\n\nINVALID_PRIOR_ANSWER:\n${retryInvalidAnswer}\n\nProduce a corrected answer with only valid [c:...] tags.`,
    },
  ];
}

async function chatAnswer(
  llm: LlmProvider,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
): Promise<{ text: string; usage: ChatUsage; model: string }> {
  const result = await llm.chat({
    model: env.LLM_CHAT_MODEL,
    messages,
    temperature: 0.35,
    maxOutputTokens: 2048,
    signal,
  });
  return { text: result.text, usage: result.usage, model: result.model };
}

/**
 * Retrieves context, generates an answer with the LLM, validates citation tags,
 * and retries once with a stricter prompt if the model hallucinates chunk ids.
 */
export async function runPhoneQna(input: PhoneQnaInput): Promise<PhoneQnaResult> {
  const { phoneId, query, retriever, llm, log, signal, retrievalOptions } = input;

  const qBytes = new TextEncoder().encode(query).length;
  if (qBytes > MAX_CHAT_MESSAGE_BYTES) {
    throw new ValidationError(`query exceeds ${MAX_CHAT_MESSAGE_BYTES} bytes`, { phoneId });
  }

  const retrieval = await retriever.search({
    phoneId,
    query,
    options: {
      kPerRetriever: RETRIEVAL_TOP_K_PRE_RERANK,
      targetResults: RETRIEVAL_TOP_K_POST_RERANK,
      minDistinctSources: MIN_DISTINCT_SOURCES_IN_CONTEXT,
      mmrLambda: MMR_LAMBDA,
      ...(retrievalOptions ?? {}),
    },
  });

  const allowed = new Set(retrieval.chunks.map((c) => c.chunkId.toLowerCase()));

  let messages = buildMessages(query, retrieval, undefined);
  let { text, usage, model } = await chatAnswer(llm, messages, signal);

  let validated = validateCitationTags(text, allowed);
  if (!validated.ok) {
    log.warn({ invalid: validated.invalid }, 'citation validation failed; retrying');
    messages = buildMessages(query, retrieval, text);
    ({ text, usage, model } = await chatAnswer(llm, messages, signal));
    validated = validateCitationTags(text, allowed);
  }

  if (!validated.ok) {
    throw new LlmError('Answer contained invalid citation tags after retry', {
      phoneId,
      invalid: validated.invalid,
    });
  }

  const citations = resolveCitations(text, retrieval.chunks);
  return { text, citations, retrieval, usage, model };
}

/** Split final text into small chunks for NDJSON streaming replay. */
export function chunkTextForStream(text: string, size = 56): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

export async function persistChatQuery(input: {
  readonly phoneId: string;
  readonly query: string;
  readonly answer: string;
  readonly citations: ResolvedCitation[];
  readonly retrievedChunkIds: readonly string[];
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(chatQueries).values({
    phoneId: input.phoneId,
    query: input.query,
    answer: input.answer,
    citations: input.citations,
    retrievedChunkIds: [...input.retrievedChunkIds],
    latencyMs: input.latencyMs,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    model: input.model,
  });
}
