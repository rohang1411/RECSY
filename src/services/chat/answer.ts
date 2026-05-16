/**
 * Phone Q&A answer pipeline — the core of `/api/ask`.
 *
 * `runPhoneQna(input)` orchestrates:
 *   1. Input sanitisation and byte-length guard.
 *   2. Query embedding via Gemini.
 *   3. Hybrid retrieval (vector + FTS) scoped to the phone.
 *   4. Optional LLM rerank + MMR deduplication.
 *   5. Citation validation — strips inline `[c:<uuid>]` tags that don't
 *      reference a retrieved chunk so the model never fabricates sources.
 *   6. Streaming via Vercel AI SDK `streamText`; yields NDJSON chunks.
 *
 * `persistChatQuery` writes the query + answer + chunk refs to
 * `chat_queries` after the stream is fully consumed.
 *
 * `chunkTextForStream` splits text into NDJSON stream chunks for manual
 * flush (used by the empty-corpus message path).
 *
 * Used by: `src/services/chat/index.ts`, `src/app/api/ask/route.ts`.
 */
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
  /**
   * Optional phone metadata used to produce a time-aware, user-friendly
   * message on the empty-corpus short-circuit. All fields are best-effort
   * — unknown values fall back to the generic wording.
   */
  readonly phoneMeta?: {
    readonly brand?: string | null;
    readonly model?: string | null;
    readonly lastIngestAt?: Date | string | null;
    readonly nextIngestAt?: Date | string | null;
  };
}

export interface PhoneQnaResult {
  readonly text: string;
  readonly citations: ResolvedCitation[];
  readonly retrieval: RetrievalResult;
  readonly usage: ChatUsage;
  readonly model: string;
}

const SYSTEM_PREAMBLE = `You are RECSY — concise, neutral, and honest about smartphones.

Context: SOURCE EXCERPTS come from reviews and articles about **one phone** — the product page the user is viewing. They are not a full catalog and may not mention other models, prices, or generations (e.g. "iPhone 17") at all.

Rules:
- Use ONLY the SOURCE EXCERPTS below. If they do not support an answer, say briefly what is missing. If the user asks to compare this phone to another model, a budget pick across models, or pricing not in the excerpts, explain that these excerpts are scoped to this device and point them to the site recommender or browse flow (you may say "try the recommender" or "browse the catalog" — no URL required).
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
 * Returned by {@link runPhoneQna} when hybrid retrieval finds **zero chunks**
 * for the current phone. Set as the `model` field so downstream analytics (and
 * the client UI) can tell apart "empty corpus" from a real LLM response. This
 * is intentional: if the corpus is empty we should not burn an LLM call just
 * to emit a generic refusal that looks like a model failure.
 */
export const NO_CONTEXT_MODEL = 'no-context@v1';

const GENERIC_NO_CONTEXT_MESSAGE =
  "We haven't collected reviews for this phone yet, so I can't answer questions about it from real sources right now. " +
  'Our ingestion pipeline refreshes phones automatically (new launches first, older devices on a slower cadence), so this page should populate on its own soon. ' +
  'In the meantime, try the recommender for cross-device picks, or Compare for side-by-side specs.';

/**
 * Build a user-friendly, time-aware empty-corpus message. We prefer brand +
 * model when known, and surface when the next automated refresh is expected
 * so users (and support) don't mistake an ops-state for a bug.
 */
export function buildNoContextMessage(phoneMeta: PhoneQnaInput['phoneMeta'] | undefined): string {
  if (!phoneMeta) return GENERIC_NO_CONTEXT_MESSAGE;
  const label =
    phoneMeta.brand && phoneMeta.model ? `${phoneMeta.brand} ${phoneMeta.model}` : 'this phone';

  const lastAt = toDate(phoneMeta.lastIngestAt);
  const nextAt = toDate(phoneMeta.nextIngestAt);
  const now = Date.now();

  const parts: string[] = [];
  parts.push(`We don't have ingested reviews for ${label} yet.`);

  if (lastAt) {
    const daysAgo = Math.max(0, Math.round((now - lastAt.getTime()) / (24 * 60 * 60 * 1000)));
    if (daysAgo <= 1) {
      parts.push(
        "Our last ingestion run didn't surface any long-form reviews — the phone may still be new or niche.",
      );
    } else {
      parts.push(
        `Our last ingestion for it ran ${daysAgo === 1 ? '1 day' : `${daysAgo} days`} ago and didn't find usable reviews.`,
      );
    }
  } else {
    parts.push(
      "We haven't run an ingestion pass for it yet — it will be picked up on the next scheduled crawl.",
    );
  }

  if (nextAt && nextAt.getTime() > now) {
    const hours = Math.max(1, Math.round((nextAt.getTime() - now) / (60 * 60 * 1000)));
    if (hours < 48) {
      parts.push(`Next refresh is scheduled in about ${hours}h.`);
    } else {
      const days = Math.round(hours / 24);
      parts.push(`Next refresh is scheduled in about ${days} day${days === 1 ? '' : 's'}.`);
    }
  }

  parts.push(
    'In the meantime, try the recommender for cross-device picks or Compare for side-by-side specs.',
  );

  return parts.join(' ');
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Retrieves context, generates an answer with the LLM, validates citation tags,
 * and retries once with a stricter prompt if the model hallucinates chunk ids.
 *
 * Short-circuits with a transparent explanatory message (no LLM call) when
 * retrieval returns **zero chunks** — the phone has no corpus, so the honest
 * answer is "nothing has been ingested yet". This avoids paying for a model
 * refusal that reads like a bug to end users.
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

  if (retrieval.chunks.length === 0) {
    log.info({ phoneId }, 'no-context short-circuit (0 chunks after hybrid retrieval)');
    return {
      text: buildNoContextMessage(input.phoneMeta),
      citations: [],
      retrieval,
      usage: { tokensIn: 0, tokensOut: 0 },
      model: NO_CONTEXT_MODEL,
    };
  }

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
