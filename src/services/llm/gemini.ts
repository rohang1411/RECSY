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
import {
  APICallError,
  embedMany,
  generateObject,
  generateText,
  streamText,
  type ModelMessage,
} from 'ai';
import type { z } from 'zod';
import { ZodError } from 'zod';

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

function briefStructuredFailure(err: unknown, max = 500): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((i) => {
        const p = i.path.length ? i.path.map(String).join('.') : 'root';
        return `${p}: ${i.message}`;
      })
      .join('; ')
      .slice(0, max);
  }
  if (err instanceof Error) {
    return err.message.slice(0, max);
  }
  return String(err).slice(0, max);
}

/**
 * Schema-repair retry only helps when the model returned parseable-ish output
 * that failed Zod. When the SDK has already exhausted HTTP retries (often
 * 429 quota) or the provider returned a hard API error, a second `generateObject`
 * call wastes quota and surfaces misleading "validation twice" messages.
 */
function shouldSkipStructuredSchemaRepair(err: unknown): boolean {
  if (err instanceof APICallError) return true;
  if (err instanceof Error && err.name === 'AI_APICallError') return true;
  // SDK wraps the last HTTP failure after internal retries; not a Zod issue.
  if (err instanceof Error && err.name === 'AI_RetryError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i.test(msg);
}

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

      if (shouldSkipStructuredSchemaRepair(err)) {
        throw new LlmError('Gemini API call failed', { model: input.model }, err);
      }

      // Retry once with an explicit "your output was malformed" nudge.
      try {
        // Gemini 2.x allows `system` only as the first message; do not append a
        // second system turn (API error: "system messages are only supported
        // at the beginning of the conversation").
        const retryMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
          ...input.messages,
          {
            role: 'user',
            content:
              'Schema repair: your previous struct failed validation. Output one JSON object only, matching the required schema, no markdown fences, no extra commentary.',
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
        console.error('--- GEMINI VALIDATION ERROR ---');
        console.error('First Attempt:', briefStructuredFailure(lastError));
        console.error('Second Attempt:', briefStructuredFailure(retryErr));
        console.error('Raw Retry Error:', retryErr);
        console.error('--------------------------------');
        throw new LlmSchemaViolation(
          'Gemini structured output failed validation twice',
          {
            model: input.model,
            schemaName: input.schemaName,
            attempts,
            firstAttempt: briefStructuredFailure(lastError),
            secondAttempt: briefStructuredFailure(retryErr),
          },
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
