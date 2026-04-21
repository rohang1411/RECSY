/**
 * Gemini provider implementation.
 *
 * Wraps the Vercel AI SDK's `@ai-sdk/google` integration. We deliberately hide
 * all SDK types behind our own `LlmProvider` interface so that swapping
 * providers (Groq, OpenRouter, self-hosted) is a trivial file change.
 *
 * Retry policy: schema-violating structured outputs are retried once with an
 * error-feedback message appended, as specified in `LlmProvider.structured`.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany, generateObject, generateText, streamText, type ModelMessage } from 'ai';
import type { z } from 'zod';

import { env } from '@/env';
import { LlmError, LlmSchemaViolation } from '@/lib/errors';

import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedResult,
  LlmProvider,
  StructuredInput,
  StructuredResult,
} from './types';

/**
 * Output dimensionality for `gemini-embedding-001` (Matryoshka truncation).
 * Locked to 768 to match the `vector(768)` column in `chunks.embedding` —
 * changing it requires a DB migration + a full re-embed of every chunk,
 * so we keep it as a compile-time constant rather than an env knob.
 */
const EMBEDDING_DIMENSIONS = 768;

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });

  async chat(input: ChatInput): Promise<ChatResult> {
    try {
      const result = await generateText({
        model: this.google(input.model),
        messages: toModelMessages(input.messages),
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        abortSignal: input.signal,
      });
      return {
        text: result.text,
        usage: {
          tokensIn: result.usage.inputTokens ?? 0,
          tokensOut: result.usage.outputTokens ?? 0,
        },
        model: input.model,
        cached: false,
      };
    } catch (err) {
      throw new LlmError('Gemini chat failed', { model: input.model }, err);
    }
  }

  async *chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    const stream = streamText({
      model: this.google(input.model),
      messages: toModelMessages(input.messages),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.signal,
    });

    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'text-delta', textDelta: part.text };
      } else if (part.type === 'error') {
        throw new LlmError('Gemini stream error', { model: input.model }, part.error);
      }
    }

    const finalUsage = await stream.usage;
    yield {
      type: 'finish',
      usage: {
        tokensIn: finalUsage.inputTokens ?? 0,
        tokensOut: finalUsage.outputTokens ?? 0,
      },
    };
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    let attempts = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let lastError: unknown;

    const runOnce = async (
      messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
    ): Promise<T> => {
      attempts += 1;
      const result = await generateObject({
        model: this.google(input.model),
        messages: toModelMessages(messages),
        schema: input.schema as z.ZodType<T>,
        schemaName: input.schemaName,
        schemaDescription: input.schemaDescription,
        temperature: input.temperature ?? 0,
        maxOutputTokens: input.maxOutputTokens,
        abortSignal: input.signal,
      });
      tokensIn += result.usage.inputTokens ?? 0;
      tokensOut += result.usage.outputTokens ?? 0;
      return result.object;
    };

    try {
      const value = await runOnce(input.messages);
      return {
        value,
        usage: { tokensIn, tokensOut },
        model: input.model,
        cached: false,
        attempts,
      };
    } catch (err) {
      lastError = err;
      // Retry once with an explicit "your output was malformed" nudge.
      try {
        const retryMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
          ...input.messages,
          {
            role: 'system',
            content:
              'Your previous response failed schema validation. Emit a JSON object that exactly matches the required schema — no prose, no code fences.',
          },
        ];
        const value = await runOnce(retryMessages);
        return {
          value,
          usage: { tokensIn, tokensOut },
          model: input.model,
          cached: false,
          attempts,
        };
      } catch (retryErr) {
        throw new LlmSchemaViolation(
          'Gemini structured output failed validation twice',
          { model: input.model, schemaName: input.schemaName, attempts },
          retryErr ?? lastError,
        );
      }
    }
  }

  async embed(texts: readonly string[], model?: string): Promise<EmbedResult> {
    const embedModel = model ?? env.LLM_EMBEDDING_MODEL;
    // `RETRIEVAL_DOCUMENT` is the correct task type for indexing passages
    // (queries will use `RETRIEVAL_QUERY`). Sending a distinct task type
    // yields embeddings better aligned for retrieval recall than the default
    // `SEMANTIC_SIMILARITY`, per Google's embedding docs.
    const googleOptions: { outputDimensionality: number; taskType: string } = {
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: 'RETRIEVAL_DOCUMENT',
    };
    try {
      const result = await embedMany({
        model: this.google.embedding(embedModel),
        values: [...texts],
        providerOptions: { google: googleOptions },
      });
      return {
        embeddings: result.embeddings,
        model: embedModel,
        usage: { tokensIn: result.usage?.tokens ?? 0 },
      };
    } catch (err) {
      // Preserve the underlying SDK message so callers (and retry logs) see
      // the actual HTTP / schema problem rather than a generic wrap.
      const causeMsg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
      throw new LlmError(
        `Gemini embedding failed: ${causeMsg}`,
        { model: embedModel, options: googleOptions },
        err,
      );
    }
  }
}

function toModelMessages(
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
): ModelMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage);
}
