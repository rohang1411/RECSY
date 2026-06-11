/**
 * Decorator adding Postgres-backed response caching to any `LlmProvider`.
 *
 * Scope:
 *   - `chat` and `structured` results are cached keyed on
 *     `sha256(model || prompt-normalized || params || extras)`.
 *   - `chatStream` intentionally bypasses the cache — streaming responses are
 *     one-shot and the latency saving from caching is negligible vs the
 *     complexity of replaying deltas.
 *   - `embed` bypasses the cache for now; chunk-level embeddings are deduped
 *     at ingestion time by `source.content_hash`, which is a stronger key.
 *
 * Cache hits bump a `hits` counter and refresh `last_hit_at` for observability.
 */
import { eq, sql } from 'drizzle-orm';

import { getDb } from '@/services/db/client';
import { llmCache } from '@/services/db/schema';
import { logger } from '@/services/logger';

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

const log = logger.child({ component: 'llm-cache' });

/** sha256 of the canonicalised request. Browser-safe fallback via subtle crypto. */
async function hashRequest(input: {
  model: string;
  messages: readonly { role: string; content: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  extras?: Readonly<Record<string, string | number | boolean>>;
  schemaName?: string;
}): Promise<string> {
  const canonical = JSON.stringify(input);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class CachedLlmProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly inner: LlmProvider,
    private readonly enabled: boolean,
  ) {
    this.name = `${inner.name}+cache`;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    if (!this.enabled) return this.inner.chat(input);

    const key = await hashRequest({
      model: input.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxOutputTokens !== undefined && { maxOutputTokens: input.maxOutputTokens }),
      ...(input.cacheKeyExtras !== undefined && { extras: input.cacheKeyExtras }),
    });

    const cached = await this.readCache(key);
    if (cached !== null) {
      log.debug({ model: input.model, key: key.slice(0, 12) }, 'chat cache hit');
      return { ...(cached as ChatResult), cached: true };
    }

    const result = await this.inner.chat(input);
    await this.writeCache(key, input.model, serialiseInput(input), result);
    return result;
  }

  chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    // Streaming bypasses the cache (see module docstring).
    return this.inner.chatStream(input);
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    if (!this.enabled) return this.inner.structured(input);

    const key = await hashRequest({
      model: input.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxOutputTokens !== undefined && { maxOutputTokens: input.maxOutputTokens }),
      schemaName: input.schemaName,
      ...(input.cacheKeyExtras !== undefined && { extras: input.cacheKeyExtras }),
    });

    const cached = await this.readCache(key);
    if (cached !== null) {
      log.debug({ model: input.model, key: key.slice(0, 12) }, 'structured cache hit');
      const raw = cached as StructuredResult<unknown>;
      // Re-validate on read so a schema change invalidates the cache.
      const parsed = input.schema.safeParse(raw.value);
      if (parsed.success) {
        return { ...raw, value: parsed.data, cached: true } as StructuredResult<T>;
      }
      log.warn(
        { model: input.model },
        'cached structured response failed revalidation; refetching',
      );
    }

    const result = await this.inner.structured(input);
    await this.writeCache(key, input.model, serialiseStructuredInput(input), result);
    return result;
  }

  embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
  ): Promise<EmbedResult> {
    // Embeddings are not cached at the request level — see module docstring.
    return this.inner.embed(texts, model, usageContext);
  }

  // ---------------------------------------------------------------------
  // Cache plumbing
  // ---------------------------------------------------------------------

  private async readCache(promptHash: string): Promise<unknown | null> {
    try {
      const [row] = await getDb()
        .update(llmCache)
        .set({ hits: sql`${llmCache.hits} + 1`, lastHitAt: new Date() })
        .where(eq(llmCache.promptHash, promptHash))
        .returning({ response: llmCache.response });
      return row?.response ?? null;
    } catch (err) {
      // Cache reads must never break callers — degrade gracefully.
      log.warn({ err }, 'llm cache read failed');
      return null;
    }
  }

  private async writeCache(
    promptHash: string,
    model: string,
    promptRaw: string,
    response: unknown,
  ): Promise<void> {
    try {
      await getDb()
        .insert(llmCache)
        .values({ promptHash, promptRaw, model, response: response as object })
        .onConflictDoNothing({ target: llmCache.promptHash });
    } catch (err) {
      log.warn({ err }, 'llm cache write failed');
    }
  }
}

function serialiseInput(input: ChatInput): string {
  return JSON.stringify({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
  });
}

function serialiseStructuredInput(input: StructuredInput<unknown>): string {
  return JSON.stringify({
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    schemaName: input.schemaName,
  });
}
