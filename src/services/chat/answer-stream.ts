/**
 * True token streaming pipeline for `/api/ask` (Plan 26 WP-06).
 *
 * Streams guarded answer tokens to the client as they arrive from the LLM,
 * while preventing citation hallucinations via CitationStreamGuard.
 */
import { env } from '@/env';
import {
  MAX_CHAT_MESSAGE_BYTES,
  MIN_DISTINCT_SOURCES_IN_CONTEXT,
  MMR_LAMBDA,
  RETRIEVAL_TOP_K_POST_RERANK,
  RETRIEVAL_TOP_K_PRE_RERANK,
} from '@/lib/constants';
import { IntegrationError, LlmTimeoutError, ValidationError } from '@/lib/errors';
import type { ChatInput, ChatUsage } from '@/services/llm/types';
import type { RetrievedChunk } from '@/services/retrieval/types';

import {
  buildMessages,
  buildNoContextMessage,
  chunkTextForStream,
  NO_CONTEXT_MODEL,
  type PhoneQnaInput,
  type PhoneQnaResult,
} from './answer';
import { CitationStreamGuard } from './citation-stream-guard';
import { buildCitationUrl, resolveCitations, type ResolvedCitation } from './citations';

export type QnaStreamEvent =
  | { type: 'status'; stage: 'retrieving' | 'generating' }
  | { type: 'meta'; phoneId: string; retrievedChunkIds: string[] }
  | { type: 'citation'; citation: ResolvedCitation }
  | { type: 'delta'; text: string }
  | { type: 'final'; result: PhoneQnaResult & { streamed: true; citationRepairs: number } };

export const ASK_STREAM_DEADLINES = {
  firstDeltaFastMs: 15_000,
  firstDeltaDeepMs: 30_000,
  idleBetweenDeltasMs: 15_000,
  overallGenerationMaxMs: 45_000,
  settleMarginMs: 5_000,
  functionTotalBudgetMs: 60_000,
} as const;

function resolveSingleCitation(
  chunkId: string,
  chunksById: ReadonlyMap<string, RetrievedChunk>,
): ResolvedCitation | null {
  const ch = chunksById.get(chunkId.toLowerCase());
  if (!ch) return null;
  return {
    chunkId: chunkId.toLowerCase(),
    sourceUrl: buildCitationUrl(ch),
    title: ch.source.title,
    type: ch.source.type,
    anchor: ch.anchor ?? null,
    startTs: ch.startTs ?? null,
  };
}

export async function* runPhoneQnaStream(
  input: PhoneQnaInput,
): AsyncGenerator<QnaStreamEvent, void, undefined> {
  const { phoneId, query, retriever, llm, log, signal, retrievalOptions, timer } = input;

  yield { type: 'status', stage: 'retrieving' };
  input.onStage?.('retrieving');

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

  if (timer && retrieval.debug) {
    if (retrieval.debug.embedding?.ms) {
      timer.record('embed', retrieval.debug.embedding.ms);
    }
    if (retrieval.debug.vector?.ms) {
      timer.record('vector', retrieval.debug.vector.ms);
    }
    if (retrieval.debug.fts?.ms) {
      timer.record('fts', retrieval.debug.fts.ms);
    }
    if (retrieval.debug.mmr?.ms) {
      timer.record('mmrVectors', retrieval.debug.mmr.ms);
    }
  }

  if (retrieval.chunks.length === 0) {
    if (retrieval.debug.vector.error || retrieval.debug.fts.error) {
      throw new IntegrationError('Retrieval failed without usable evidence', {
        phoneId,
        vectorError: retrieval.debug.vector.error,
        ftsError: retrieval.debug.fts.error,
      });
    }
    log.info({ phoneId }, 'no-context short-circuit (0 chunks after hybrid retrieval)');

    yield { type: 'meta', phoneId, retrievedChunkIds: [] };

    const noContextText = buildNoContextMessage(input.phoneMeta);
    for (const piece of chunkTextForStream(noContextText)) {
      yield { type: 'delta', text: piece };
    }

    yield {
      type: 'final',
      result: {
        text: noContextText,
        citations: [],
        retrieval,
        usage: { tokensIn: 0, tokensOut: 0 },
        model: NO_CONTEXT_MODEL,
        generationAccounting: {
          providerCalls: 0,
          cacheHits: 0,
          reportedUsageCalls: 0,
          tokensIn: 0,
          tokensOut: 0,
        },
        streamed: true,
        citationRepairs: 0,
      },
    };
    return;
  }

  yield {
    type: 'meta',
    phoneId,
    retrievedChunkIds: retrieval.chunks.map((c) => c.chunkId),
  };

  yield { type: 'status', stage: 'generating' };
  input.onStage?.('generating');

  const allowed = new Set(retrieval.chunks.map((c) => c.chunkId.toLowerCase()));
  const chunksById = new Map(retrieval.chunks.map((c) => [c.chunkId.toLowerCase(), c]));
  const guard = new CitationStreamGuard(allowed);

  const messages = buildMessages(query, retrieval, undefined);
  const chatInput: ChatInput = {
    model: env.LLM_CHAT_MODEL,
    messages,
    temperature: 0.35,
    maxOutputTokens: 2048,
    thinking: input.thinking,
    usageContext: {
      area: 'Phone Q&A',
      feature: 'Grounded answer',
      source: '/api/ask',
      taskClass: 'GROUNDED_SYNTHESIS',
      userByokKey: input.byok?.apiKey,
      userByokProvider: input.byok?.provider,
      userMode: input.serverMode ?? input.byok?.userMode,
      isSubscriber: input.isSubscriber,
    },
    signal,
  };

  // Cache first
  if (llm.lookupChat) {
    const cached = await llm.lookupChat(chatInput);
    if (cached) {
      log.debug({ phoneId, model: cached.model }, 'chat stream cache hit');
      const { newlyCited } = guard.push(cached.text);
      for (const id of newlyCited) {
        const cit = resolveSingleCitation(id, chunksById);
        if (cit) yield { type: 'citation', citation: cit };
      }
      const { newlyCited: flushCited } = guard.flush();
      for (const id of flushCited) {
        const cit = resolveSingleCitation(id, chunksById);
        if (cit) yield { type: 'citation', citation: cit };
      }

      for (const piece of chunkTextForStream(guard.emitted)) {
        yield { type: 'delta', text: piece };
      }

      const citations = resolveCitations(guard.emitted, retrieval.chunks);
      yield {
        type: 'final',
        result: {
          text: guard.emitted,
          citations,
          retrieval,
          usage: cached.usage,
          model: cached.model,
          generationAccounting: {
            providerCalls: 0,
            cacheHits: 1,
            reportedUsageCalls: 0,
            tokensIn: 0,
            tokensOut: 0,
          },
          streamed: true,
          citationRepairs: guard.stats.strippedTags,
        },
      };
      return;
    }
  }

  // Deadlines setup
  let elapsedMs = 0;
  if (timer) {
    for (const val of Object.values(timer.snapshot())) {
      if (typeof val === 'number') elapsedMs += val;
    }
  }
  const maxAllowedForGeneration = Math.max(
    5_000,
    ASK_STREAM_DEADLINES.functionTotalBudgetMs - elapsedMs - ASK_STREAM_DEADLINES.settleMarginMs,
  );
  const overallDeadlineMs = Math.min(
    ASK_STREAM_DEADLINES.overallGenerationMaxMs,
    maxAllowedForGeneration,
  );
  const firstDeltaDeadlineMs =
    input.serverMode === 'deep'
      ? ASK_STREAM_DEADLINES.firstDeltaDeepMs
      : ASK_STREAM_DEADLINES.firstDeltaFastMs;

  const deadlineController = new AbortController();
  let deadlineReason: string | null = null;

  const triggerDeadline = (reason: string) => {
    deadlineReason = reason;
    deadlineController.abort(new LlmTimeoutError(reason));
  };

  const overallTimer = setTimeout(() => {
    triggerDeadline('Overall generation deadline exceeded');
  }, overallDeadlineMs);

  let firstDeltaTimer: NodeJS.Timeout | null = setTimeout(() => {
    triggerDeadline('First-delta deadline exceeded');
  }, firstDeltaDeadlineMs);

  let idleTimer: NodeJS.Timeout | null = null;

  const effectiveSignal = signal
    ? AbortSignal.any([signal, deadlineController.signal])
    : deadlineController.signal;

  const streamingInput: ChatInput = {
    ...chatInput,
    signal: effectiveSignal,
  };

  let finishUsage: ChatUsage | undefined;
  let finishModel: string | undefined;

  try {
    for await (const delta of llm.chatStream(streamingInput)) {
      if (signal?.aborted) return;
      if (deadlineReason) throw new LlmTimeoutError(deadlineReason);

      if (delta.type === 'text-delta' && delta.textDelta) {
        if (firstDeltaTimer) {
          clearTimeout(firstDeltaTimer);
          firstDeltaTimer = null;
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          triggerDeadline('Idle deadline between deltas exceeded');
        }, ASK_STREAM_DEADLINES.idleBetweenDeltasMs);

        const { text, newlyCited } = guard.push(delta.textDelta);
        for (const id of newlyCited) {
          const cit = resolveSingleCitation(id, chunksById);
          if (cit) yield { type: 'citation', citation: cit };
        }
        if (text.length > 0) {
          yield { type: 'delta', text };
        }
      } else if (delta.type === 'finish') {
        finishUsage = delta.usage;
        finishModel = delta.model;
      }
    }

    if (signal?.aborted) return;
    if (deadlineReason) throw new LlmTimeoutError(deadlineReason);

    const { text: flushText, newlyCited: flushCited } = guard.flush();
    for (const id of flushCited) {
      const cit = resolveSingleCitation(id, chunksById);
      if (cit) yield { type: 'citation', citation: cit };
    }
    if (flushText.length > 0) {
      yield { type: 'delta', text: flushText };
    }
  } catch (err) {
    if (deadlineReason) {
      throw new LlmTimeoutError(deadlineReason);
    }
    throw err;
  } finally {
    clearTimeout(overallTimer);
    if (firstDeltaTimer) clearTimeout(firstDeltaTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }

  const finalCitations = resolveCitations(guard.emitted, retrieval.chunks);
  const usage = finishUsage ?? { tokensIn: 0, tokensOut: 0 };
  const model = finishModel ?? env.LLM_CHAT_MODEL;
  const citationRepairs = guard.stats.strippedTags;

  if (citationRepairs > 0) {
    log.warn({ count: citationRepairs, phoneId }, 'citation_stream_repair');
  } else if (llm.storeChat) {
    llm.storeChat(chatInput, {
      text: guard.emitted,
      usage,
      model,
      cached: false,
    });
  }

  yield {
    type: 'final',
    result: {
      text: guard.emitted,
      citations: finalCitations,
      retrieval,
      usage,
      model,
      generationAccounting: {
        providerCalls: 1,
        cacheHits: 0,
        reportedUsageCalls: usage.tokensIn > 0 && usage.tokensOut > 0 ? 1 : 0,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
      },
      streamed: true,
      citationRepairs,
    },
  };
}
