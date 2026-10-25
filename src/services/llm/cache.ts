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
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { deferOrRun } from '@/lib/defer';
import { getDb } from '@/services/db/client';
import { llmCache } from '@/services/db/schema';
import { logger } from '@/services/logger';

import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedResult,
  EmbedOptions,
  LlmProvider,
  LlmUsageContext,
  StructuredInput,
  StructuredResult,
} from './types';

const log = logger.child({ component: 'llm-cache' });

const CACHE_KEY_VERSION = 'v2';

/**
 * Derives a canonical sha256 cache key including all inputs that affect the output (Plan 26 WP-10).
 * Excludes sensitive credentials (BYOK key) while incorporating routing parameters (userMode, taskClass).
 */
export function buildCacheKey(input: ChatInput | StructuredInput<unknown>): string {
  const extras: Record<string, string | number | boolean> = {
    ...(input.cacheKeyExtras ?? {}),
  };

  if (input.taskClass) extras.taskClass = input.taskClass;
  if (input.preferredTier) extras.preferredTier = input.preferredTier;
  if (input.usageContext?.userMode) extras.userMode = input.usageContext.userMode;
  if (input.thinking) extras.thinking = input.thinking;
  if (input.usageContext?.userByokProvider) {
    extras.byokProvider = input.usageContext.userByokProvider;
  }

  const payload: Record<string, unknown> = {
    v: CACHE_KEY_VERSION,
    model: input.model,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
  };

  if (input.temperature !== undefined) payload.temperature = input.temperature;
  if (input.maxOutputTokens !== undefined) payload.maxOutputTokens = input.maxOutputTokens;
  if ('schemaName' in input && input.schemaName) payload.schemaName = input.schemaName;

  if (Object.keys(extras).length > 0) {
    const sortedExtras: Record<string, string | number | boolean> = {};
    for (const k of Object.keys(extras).sort()) {
      sortedExtras[k] = extras[k]!;
    }
    payload.extras = sortedExtras;
  }

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export class CachedLlmProvider implements LlmProvider {
  readonly name: string;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly inner: LlmProvider,
    private readonly enabled: boolean,
  ) {
    this.name = `${inner.name}+cache`;
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    if (!this.enabled) return this.inner.chat(input);

    const key = buildCacheKey(input);

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<ChatResult>;

    const promise = (async () => {
      const cached = await this.readCache(key);
      if (cached !== null) {
        log.debug({ model: input.model, key: key.slice(0, 12) }, 'chat cache hit');
        return { ...(cached as ChatResult), cached: true };
      }

      const result = await this.inner.chat(input);
      // Asynchronous cache write after response via deferOrRun (Plan 26 WP-10)
      void deferOrRun('write-llm-cache-chat', async () => {
        await this.writeCache(key, input.model, serialiseInput(input), result);
      });
      return result;
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    // Streaming bypasses the cache (see module docstring).
    return this.inner.chatStream(input);
  }

  /**
   * Looks up cached chat response without executing the model (Plan 26 WP-06 / WP-10).
   */
  async lookupChat(input: ChatInput): Promise<ChatResult | null> {
    if (!this.enabled) return null;
    const key = buildCacheKey(input);
    const cached = await this.readCache(key);
    if (cached !== null) {
      log.debug({ model: input.model, key: key.slice(0, 12) }, 'chat stream lookup hit');
      return { ...(cached as ChatResult), cached: true };
    }
    return null;
  }

  /**
   * Stores completed chat result into cache asynchronously via deferOrRun (Plan 26 WP-06 / WP-10).
   */
  storeChat(input: ChatInput, result: ChatResult): void {
    if (!this.enabled) return;
    const key = buildCacheKey(input);
    void deferOrRun('store-llm-cache-stream', async () => {
      await this.writeCache(key, input.model, serialiseInput(input), result);
    });
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    if (!this.enabled) return this.inner.structured(input);

    const key = buildCacheKey(input);

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<StructuredResult<T>>;

    const promise = (async () => {
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
      // Asynchronous cache write after response via deferOrRun (Plan 26 WP-10)
      void deferOrRun('write-llm-cache-structured', async () => {
        await this.writeCache(key, input.model, serialiseStructuredInput(input), result);
      });
      return result;
    })().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
    options?: EmbedOptions,
  ): Promise<EmbedResult> {
    // Embeddings are not cached at the request level — see module docstring.
    return this.inner.embed(texts, model, usageContext, options);
  }

  // ---------------------------------------------------------------------
  // Cache plumbing
  // ---------------------------------------------------------------------

  private async readCache(promptHash: string): Promise<unknown | null> {
    try {
      const [row] = await getDb()
        .select({
          response: llmCache.response,
          createdAt: llmCache.createdAt,
        })
        .from(llmCache)
        .where(eq(llmCache.promptHash, promptHash))
        .limit(1);

      if (!row) return null;

      // 30-day TTL check
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      if (row.createdAt && Date.now() - new Date(row.createdAt).getTime() > THIRTY_DAYS_MS) {
        log.debug({ key: promptHash.slice(0, 12) }, 'llm cache entry expired (> 30 days)');
        return null;
      }

      return row.response;
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
      const jsonStr = JSON.stringify(response);
      // Byte size limit: bypass storage if response exceeds 1MB (1,048,576 bytes)
      if (new TextEncoder().encode(jsonStr).length > 1_048_576) {
        log.warn(
          { promptHash: promptHash.slice(0, 12) },
          'llm response exceeds 1MB; skipping cache write',
        );
        return;
      }

      // Truncate promptRaw to a bounded debug excerpt (max 500 chars)
      const truncatedPrompt = promptRaw.slice(0, 500);

      await getDb()
        .insert(llmCache)
        .values({
          promptHash,
          promptRaw: truncatedPrompt,
          model,
          response: response as object,
        })
        .onConflictDoUpdate({
          target: llmCache.promptHash,
          set: {
            response: response as object,
            model,
            promptRaw: truncatedPrompt,
            createdAt: new Date(),
          },
        });
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
