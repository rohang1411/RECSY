/**
 * Gemini provider implementation.
 *
 * Wraps the Vercel AI SDK's `@ai-sdk/google` integration. We deliberately hide
 * all SDK types behind our own `LlmProvider` interface so that swapping
 * providers (Groq, OpenRouter, self-hosted) is a trivial file change.
 *
 * Retry policy: schema-violating structured outputs are retried once with an
 * error-feedback message appended, as specified in `LlmProvider.structured`.
 *
 * Optional backup API keys (`GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `GEMINI_API_KEY_4`)
 * and client-side pacing
 * (`GEMINI_RATE_LIMIT_PROFILE=google_ai_studio_free`) support Google AI Studio
 * free-tier style caps; authoritative limits remain on Google's side.
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

import {
  estimateTokensFromMessages,
  estimateTokensFromTexts,
  GeminiRequestGovernor,
  isLikelyGeminiQuotaExhaustedError,
} from './gemini-request-governor';
import { recordLlmUsageEvent } from './usage';
import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedResult,
  LlmProvider,
  LlmUsageContext,
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

type GoogleGenAI = ReturnType<typeof createGoogleGenerativeAI>;

type GeminiExecuteResult<T> = {
  readonly value: T;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly keyIndex: number;
};

type GeminiOperationResult<T> = Omit<GeminiExecuteResult<T>, 'keyIndex'>;

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
  if (err instanceof Error && err.name === 'AI_RetryError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded/i.test(msg);
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly clients: readonly GoogleGenAI[];
  private readonly governor: GeminiRequestGovernor | null;
  private preferredKeyIndex = 0;

  constructor() {
    const keys = [
      env.GEMINI_API_KEY,
      env.GEMINI_API_KEY_2,
      env.GEMINI_API_KEY_3,
      env.GEMINI_API_KEY_4,
    ].filter((k): k is string => typeof k === 'string' && k.length > 0);
    this.clients = keys.map((apiKey) => createGoogleGenerativeAI({ apiKey }));
    this.governor =
      env.GEMINI_RATE_LIMIT_PROFILE === 'google_ai_studio_free'
        ? new GeminiRequestGovernor(this.clients.length, {
            profile: 'google_ai_studio_free',
            rpm: env.GEMINI_FREE_RPM,
            tpmInput: env.GEMINI_FREE_TPM_INPUT,
            rpd: env.GEMINI_FREE_RPD,
          })
        : null;
  }

  /**
   * Runs `op` against successive API keys when Google returns quota-style errors.
   * When `GEMINI_RATE_LIMIT_PROFILE=google_ai_studio_free`, enforces per-key RPM/TPM/RPD
   * before each outbound call (in-process; use `off` on multi-instance paid deploys).
   */
  private async executeWithGeminiKeys<T>(params: {
    readonly model: string;
    readonly estimateInputTokens: number;
    readonly op: (google: GoogleGenAI, keyIndex: number) => Promise<GeminiOperationResult<T>>;
  }): Promise<GeminiExecuteResult<T>> {
    if (this.clients.length === 0) {
      throw new LlmError('Gemini misconfigured: no API keys', { model: params.model });
    }

    const start = this.preferredKeyIndex;
    let lastErr: unknown;

    for (let step = 0; step < this.clients.length; step++) {
      const keyIndex = (start + step) % this.clients.length;

      if (this.governor) {
        const ok = await this.governor.acquireForKey(keyIndex, params.estimateInputTokens);
        if (!ok) {
          const h = Math.round(this.governor.msUntilNextUtcDay() / 3_600_000);
          lastErr = new Error(
            `Gemini free-tier daily request budget reached for API key #${keyIndex + 1} (resets next UTC day, ~${h}h).`,
          );
          continue;
        }
      }

      try {
        const google = this.clients[keyIndex]!;
        const { value, inputTokens, outputTokens } = await params.op(google, keyIndex);
        this.preferredKeyIndex = keyIndex;
        if (this.governor) {
          await this.governor.recordMeasuredForKey(keyIndex, inputTokens);
        }
        return { value, inputTokens, outputTokens, keyIndex };
      } catch (err) {
        lastErr = err;
        if (this.clients.length > 1 && isLikelyGeminiQuotaExhaustedError(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new LlmError(
      'Gemini API call failed (all configured API keys exhausted)',
      { model: params.model },
      lastErr,
    );
  }

  private async resolveStreamKeyIndex(estimateInputTokens: number): Promise<number> {
    if (!this.governor) return this.preferredKeyIndex;

    for (let step = 0; step < this.clients.length; step++) {
      const keyIndex = (this.preferredKeyIndex + step) % this.clients.length;
      if (await this.governor.acquireForKey(keyIndex, estimateInputTokens)) {
        return keyIndex;
      }
    }

    const h = Math.round(this.governor.msUntilNextUtcDay() / 3_600_000);
    throw new LlmError(
      `Gemini free-tier daily request budget reached for all API keys (~${h}h until UTC day rollover).`,
      { model: 'stream' },
    );
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const startedAt = performance.now();
    try {
      const { value, inputTokens, outputTokens, keyIndex } = await this.executeWithGeminiKeys({
        model: input.model,
        estimateInputTokens: estimateTokensFromMessages(input.messages),
        op: async (google) => {
          const result = await generateText({
            model: google(input.model),
            messages: toModelMessages(input.messages),
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
            abortSignal: input.signal,
          });
          return {
            value: {
              text: result.text,
              usage: {
                tokensIn: result.usage.inputTokens ?? 0,
                tokensOut: result.usage.outputTokens ?? 0,
              },
              model: input.model,
              cached: false,
            },
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
          };
        },
      });
      await this.recordUsage({
        model: input.model,
        operation: 'chat',
        usageContext: input.usageContext,
        inputTokens,
        outputTokens,
        apiKeyIndex: keyIndex,
        latencyMs: performance.now() - startedAt,
      });
      return value;
    } catch (err) {
      throw new LlmError('Gemini chat failed', { model: input.model }, err);
    }
  }

  async *chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    const startedAt = performance.now();
    const est = estimateTokensFromMessages(input.messages);
    const keyIndex = await this.resolveStreamKeyIndex(est);
    const google = this.clients[keyIndex]!;

    const stream = streamText({
      model: google(input.model),
      messages: toModelMessages(input.messages),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.signal,
    });

    try {
      for await (const part of stream.fullStream) {
        if (part.type === 'text-delta') {
          yield { type: 'text-delta', textDelta: part.text };
        } else if (part.type === 'error') {
          throw new LlmError('Gemini stream error', { model: input.model }, part.error);
        }
      }

      const finalUsage = await stream.usage;
      const tokensIn = finalUsage.inputTokens ?? 0;
      const tokensOut = finalUsage.outputTokens ?? 0;
      if (this.governor) {
        await this.governor.recordMeasuredForKey(keyIndex, tokensIn);
      }
      this.preferredKeyIndex = keyIndex;
      await this.recordUsage({
        model: input.model,
        operation: 'stream',
        usageContext: input.usageContext,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        apiKeyIndex: keyIndex,
        latencyMs: performance.now() - startedAt,
      });

      yield {
        type: 'finish',
        usage: {
          tokensIn,
          tokensOut,
        },
      };
    } catch (err) {
      if (this.clients.length > 1 && isLikelyGeminiQuotaExhaustedError(err)) {
        throw new LlmError(
          'Gemini stream failed (quota). Streaming cannot fail over to a backup key mid-flight; retry the request.',
          { model: input.model },
          err,
        );
      }
      throw err instanceof LlmError
        ? err
        : new LlmError('Gemini stream failed', { model: input.model }, err);
    }
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
      const startedAt = performance.now();
      const { value, inputTokens, outputTokens, keyIndex } = await this.executeWithGeminiKeys({
        model: input.model,
        estimateInputTokens: estimateTokensFromMessages(messages),
        op: async (google) => {
          const result = await generateObject({
            model: google(input.model),
            messages: toModelMessages(messages),
            schema: input.schema as z.ZodType<T>,
            schemaName: input.schemaName,
            schemaDescription: input.schemaDescription,
            temperature: input.temperature ?? 0,
            maxOutputTokens: input.maxOutputTokens,
            abortSignal: input.signal,
          });
          return {
            value: result.object,
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
          };
        },
      });
      tokensIn += inputTokens;
      tokensOut += outputTokens;
      await this.recordUsage({
        model: input.model,
        operation: 'structured',
        usageContext: {
          area: input.usageContext?.area ?? 'Structured LLM',
          feature: input.usageContext?.feature ?? input.schemaName,
          source: input.usageContext?.source,
          metadata: input.usageContext?.metadata,
        },
        inputTokens,
        outputTokens,
        apiKeyIndex: keyIndex,
        latencyMs: performance.now() - startedAt,
      });
      return value;
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

      try {
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

  async embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
  ): Promise<EmbedResult> {
    const embedModel = model ?? env.LLM_EMBEDDING_MODEL;
    const startedAt = performance.now();
    const googleOptions: { outputDimensionality: number; taskType: string } = {
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: 'RETRIEVAL_DOCUMENT',
    };
    try {
      const { value, inputTokens, keyIndex } = await this.executeWithGeminiKeys({
        model: embedModel,
        estimateInputTokens: estimateTokensFromTexts(texts),
        op: async (google) => {
          const result = await embedMany({
            model: google.embedding(embedModel),
            values: [...texts],
            providerOptions: { google: googleOptions },
          });
          const tokensIn = result.usage?.tokens ?? 0;
          return {
            value: {
              embeddings: result.embeddings,
              model: embedModel,
              usage: { tokensIn },
            },
            inputTokens: tokensIn,
            outputTokens: 0,
          };
        },
      });
      await this.recordUsage({
        model: embedModel,
        operation: 'embed',
        usageContext,
        inputTokens,
        outputTokens: 0,
        apiKeyIndex: keyIndex,
        latencyMs: performance.now() - startedAt,
      });
      return value;
    } catch (err) {
      const causeMsg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
      throw new LlmError(
        `Gemini embedding failed: ${causeMsg}`,
        { model: embedModel, options: googleOptions },
        err,
      );
    }
  }

  private recordUsage(input: {
    readonly model: string;
    readonly operation: 'chat' | 'stream' | 'structured' | 'embed';
    readonly usageContext?: LlmUsageContext;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly apiKeyIndex: number;
    readonly latencyMs: number;
  }): Promise<void> {
    return recordLlmUsageEvent({
      provider: this.name,
      model: input.model,
      operation: input.operation,
      usageContext: input.usageContext,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      apiKeyIndex: input.apiKeyIndex,
      latencyMs: Math.round(input.latencyMs),
    });
  }
}

function toModelMessages(
  messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[],
): ModelMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage);
}
