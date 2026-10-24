import { ByokError, LlmError, mapByokError } from '@/lib/errors';
import { logger } from '@/services/logger';
import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedOptions,
  EmbedResult,
  LlmUsageContext,
  StructuredInput,
  StructuredResult,
} from '../types';
import type { CircuitBreakerRegistry } from './circuit-breaker';
import type { MultiProviderQuotaGovernor } from './quota-governor';
import type { KeyPoolRegistry } from '../keys/key-pool';
import type { ModelCandidate } from './task-profiles';
import type { ModelAdapter } from '../adapters/base-adapter';
import { OpenAiCompatibleAdapter } from '../adapters/openai-compatible';
import { GeminiProvider } from '../gemini';

const log = logger.child({ component: 'llm-cascade-executor' });

export class CascadeExecutor {
  private readonly openAiAdapters = new Map<string, OpenAiCompatibleAdapter>();

  constructor(
    private readonly geminiProvider: GeminiProvider,
    private readonly keyPool: KeyPoolRegistry,
    private readonly circuitBreakers: CircuitBreakerRegistry,
    private readonly quotaGovernor: MultiProviderQuotaGovernor,
  ) {
    this.initAdapters();
  }

  private initAdapters(): void {
    this.openAiAdapters.set(
      'groq',
      new OpenAiCompatibleAdapter({
        providerId: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
      }),
    );
    this.openAiAdapters.set(
      'nvidia',
      new OpenAiCompatibleAdapter({
        providerId: 'nvidia',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
      }),
    );
    this.openAiAdapters.set(
      'cerebras',
      new OpenAiCompatibleAdapter({
        providerId: 'cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
      }),
    );
    this.openAiAdapters.set(
      'openai',
      new OpenAiCompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    );
    this.openAiAdapters.set(
      'github',
      new OpenAiCompatibleAdapter({
        providerId: 'github',
        baseUrl: 'https://models.inference.ai.azure.com',
      }),
    );
    this.openAiAdapters.set(
      'openrouter',
      new OpenAiCompatibleAdapter({
        providerId: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    );
  }

  private getAdapter(providerId: string): ModelAdapter | null {
    return this.openAiAdapters.get(providerId) ?? null;
  }

  private async runChatOnByok(
    input: ChatInput,
    byokKey: string,
    byokProvider: string,
  ): Promise<ChatResult> {
    if (byokProvider === 'gemini') {
      return GeminiProvider.withKey(byokKey).chat(input);
    }
    const adapter = this.getAdapter(byokProvider);
    if (!adapter) {
      throw new ByokError('BYOK_UNSUPPORTED', `BYOK provider '${byokProvider}' not supported`, {
        status: 400,
      });
    }
    try {
      return await adapter.chat(input, input.model, byokKey);
    } catch (err) {
      mapByokError(err);
    }
  }

  private async runStructuredOnByok<T>(
    input: StructuredInput<T>,
    byokKey: string,
    byokProvider: string,
  ): Promise<StructuredResult<T>> {
    if (byokProvider === 'gemini') {
      return GeminiProvider.withKey(byokKey).structured(input);
    }
    const adapter = this.getAdapter(byokProvider);
    if (!adapter) {
      throw new ByokError('BYOK_UNSUPPORTED', `BYOK provider '${byokProvider}' not supported`, {
        status: 400,
      });
    }
    try {
      return await adapter.structured(input, input.model, byokKey);
    } catch (err) {
      mapByokError(err);
    }
  }

  private async *runStreamOnByok(
    input: ChatInput,
    byokKey: string,
    byokProvider: string,
  ): AsyncIterable<ChatDelta> {
    if (byokProvider === 'gemini') {
      yield* GeminiProvider.withKey(byokKey).chatStream(input);
      return;
    }
    const adapter = this.getAdapter(byokProvider);
    if (!adapter) {
      throw new ByokError('BYOK_UNSUPPORTED', `BYOK provider '${byokProvider}' not supported`, {
        status: 400,
      });
    }
    try {
      yield* adapter.chatStream(input, input.model, byokKey);
    } catch (err) {
      mapByokError(err);
    }
  }

  async executeChat(
    input: ChatInput,
    candidates: readonly ModelCandidate[],
    byokKey?: string,
    byokProvider?: string,
  ): Promise<ChatResult> {
    // 1. If user supplied BYOK, execute exclusively on their key (never falls through to platform keys)
    if (byokKey) {
      return this.runChatOnByok(input, byokKey, byokProvider ?? 'gemini');
    }

    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const breaker = this.circuitBreakers.getBreaker(candidate.providerId);
      if (!breaker.canAttempt()) continue;

      // Handle Gemini natively via existing GeminiProvider
      if (candidate.providerId === 'gemini') {
        try {
          const res = await this.geminiProvider.chat({
            ...input,
            model: candidate.model,
          });
          breaker.recordSuccess();
          return res;
        } catch (err) {
          lastError = err;
          breaker.recordFailure();
          log.warn(
            { err, candidate: candidate.model },
            'Gemini candidate failed, escalating to next in cascade',
          );
          continue;
        }
      }

      // Handle OpenAI-compatible providers
      const adapter = this.getAdapter(candidate.providerId);
      const keys = this.keyPool.getKeysForProvider(candidate.providerId);
      if (!adapter || keys.length === 0) continue;

      for (const keyEntry of keys) {
        if (this.quotaGovernor.isKeyDepleted(candidate.providerId, keyEntry.keyIndex)) {
          continue;
        }

        const acquired = await this.quotaGovernor.acquire(
          candidate.providerId,
          keyEntry.keyIndex,
          1000,
        );
        if (!acquired) continue;

        try {
          const res = await adapter.chat(input, candidate.model, keyEntry.apiKey);
          this.quotaGovernor.recordMeasured(
            candidate.providerId,
            keyEntry.keyIndex,
            res.usage.tokensIn,
          );
          breaker.recordSuccess();
          return res;
        } catch (err) {
          lastError = err;
          if (err instanceof LlmError && err.status === 429) {
            this.quotaGovernor.markKeyDepleted(candidate.providerId, keyEntry.keyIndex);
            log.warn(
              { candidate: candidate.model, key: keyEntry.id },
              'Candidate key hit 429; rotating to next key',
            );
            continue; // Rotate to next key in key pool for this provider
          }
          log.warn(
            { err, candidate: candidate.model, key: keyEntry.id },
            'Candidate execution failed; escalating candidate',
          );
          break; // Hard model/payload error, advance to next candidate in cascade
        }
      }
      breaker.recordFailure();
    }

    // Ultimate fallback: execute with baseline Gemini
    try {
      return await this.geminiProvider.chat(input);
    } catch {
      throw lastError instanceof LlmError
        ? lastError
        : new LlmError('All providers in cascade exhausted', {}, lastError);
    }
  }

  async executeStructured<T>(
    input: StructuredInput<T>,
    candidates: readonly ModelCandidate[],
    byokKey?: string,
    byokProvider?: string,
  ): Promise<StructuredResult<T>> {
    // 1. If user supplied BYOK, execute directly on their key (never falls through to platform keys)
    if (byokKey) {
      return this.runStructuredOnByok(input, byokKey, byokProvider ?? 'gemini');
    }

    let lastError: unknown;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const breaker = this.circuitBreakers.getBreaker(candidate.providerId);
      if (!breaker.canAttempt()) continue;

      // Handle Gemini natively via existing GeminiProvider
      if (candidate.providerId === 'gemini') {
        try {
          const res = await this.geminiProvider.structured({
            ...input,
            model: candidate.model,
          });
          breaker.recordSuccess();
          return res;
        } catch (err) {
          lastError = err;
          breaker.recordFailure();
          log.warn(
            { err, candidate: candidate.model },
            'Gemini structured failed in cascade, trying next candidate',
          );
          continue;
        }
      }

      // Handle OpenAI-compatible providers
      const adapter = this.getAdapter(candidate.providerId);
      const keys = this.keyPool.getKeysForProvider(candidate.providerId);
      if (!adapter || keys.length === 0) continue;

      for (const keyEntry of keys) {
        if (this.quotaGovernor.isKeyDepleted(candidate.providerId, keyEntry.keyIndex)) {
          continue;
        }

        const acquired = await this.quotaGovernor.acquire(
          candidate.providerId,
          keyEntry.keyIndex,
          1000,
        );
        if (!acquired) continue;

        try {
          const res = await adapter.structured(input, candidate.model, keyEntry.apiKey);
          this.quotaGovernor.recordMeasured(
            candidate.providerId,
            keyEntry.keyIndex,
            res.usage.tokensIn,
          );
          breaker.recordSuccess();

          // Speculative quality check: if result has confidence and confidence < 0.65, escalate!
          const valAny = res.value as Record<string, unknown>;
          if (
            typeof valAny === 'object' &&
            valAny !== null &&
            typeof valAny.confidence === 'number' &&
            valAny.confidence < 0.65 &&
            i + 1 < candidates.length
          ) {
            log.info(
              { confidence: valAny.confidence, model: candidate.model },
              'Fast candidate confidence < 0.65; speculatively escalating to next tier',
            );
            continue; // Escalate to next candidate in cascade
          }

          return res;
        } catch (err) {
          lastError = err;
          if (err instanceof LlmError && err.status === 429) {
            this.quotaGovernor.markKeyDepleted(candidate.providerId, keyEntry.keyIndex);
            log.warn(
              { candidate: candidate.model, key: keyEntry.id },
              'Candidate key hit 429; rotating to next key',
            );
            continue; // Rotate to next key in key pool for this provider
          }
          log.warn(
            { err, candidate: candidate.model, key: keyEntry.id },
            'Candidate structured execution failed; escalating',
          );
          break; // Hard schema/model error; advance to next candidate in cascade
        }
      }
      breaker.recordFailure();
    }

    // Ultimate fallback: execute with baseline Gemini
    try {
      return await this.geminiProvider.structured(input);
    } catch {
      throw lastError instanceof LlmError
        ? lastError
        : new LlmError('All structured providers in cascade exhausted', {}, lastError);
    }
  }

  async *executeStream(
    input: ChatInput,
    candidates: readonly ModelCandidate[],
    byokKey?: string,
    byokProvider?: string,
  ): AsyncIterable<ChatDelta> {
    if (byokKey) {
      yield* this.runStreamOnByok(input, byokKey, byokProvider ?? 'gemini');
      return;
    }

    let lastError: unknown = null;
    let yieldedAny = false;

    // Streaming is best handled by Gemini or top candidate
    for (const candidate of candidates) {
      const breaker = this.circuitBreakers.getBreaker(`${candidate.providerId}:${candidate.model}`);
      if (!breaker.canAttempt()) {
        continue;
      }

      if (candidate.providerId === 'gemini') {
        try {
          for await (const delta of this.geminiProvider.chatStream({
            ...input,
            model: candidate.model,
          })) {
            yieldedAny = true;
            yield delta;
          }
          breaker.recordSuccess();
          return;
        } catch (err) {
          lastError = err;
          breaker.recordFailure();
          if (yieldedAny) {
            throw err;
          }
          log.warn(
            { err, candidate: candidate.model },
            'Gemini stream candidate failed before first token; falling over to next candidate',
          );
          continue;
        }
      }

      const adapter = this.getAdapter(candidate.providerId);
      const keys = this.keyPool.getKeysForProvider(candidate.providerId);
      if (adapter && keys.length > 0) {
        for (const keyEntry of keys) {
          if (this.quotaGovernor.isKeyDepleted(candidate.providerId, keyEntry.keyIndex)) {
            continue;
          }

          const acquired = await this.quotaGovernor.acquire(
            candidate.providerId,
            keyEntry.keyIndex,
            1000,
          );
          if (!acquired) continue;

          let streamTokensIn = 0;
          try {
            for await (const delta of adapter.chatStream(input, candidate.model, keyEntry.apiKey)) {
              yieldedAny = true;
              if (delta.usage) {
                streamTokensIn = delta.usage.tokensIn;
              }
              yield delta;
            }
            if (streamTokensIn > 0) {
              this.quotaGovernor.recordMeasured(
                candidate.providerId,
                keyEntry.keyIndex,
                streamTokensIn,
              );
            }
            breaker.recordSuccess();
            return;
          } catch (err) {
            lastError = err;
            breaker.recordFailure();
            if (yieldedAny) {
              throw err;
            }

            if (err instanceof LlmError && err.status === 429) {
              this.quotaGovernor.markKeyDepleted(candidate.providerId, keyEntry.keyIndex);
              log.warn(
                { candidate: candidate.model, key: keyEntry.id },
                'Stream candidate key hit 429; rotating to next key',
              );
              continue;
            }

            log.warn(
              { err, candidate: candidate.model, key: keyEntry.id },
              'Stream candidate key failed before first token; escalating candidate',
            );
            break;
          }
        }
        breaker.recordFailure();
      }
    }

    // Fallback to Gemini stream
    try {
      for await (const delta of this.geminiProvider.chatStream(input)) {
        yieldedAny = true;
        yield delta;
      }
    } catch (err) {
      if (yieldedAny) {
        throw err;
      }
      throw lastError instanceof LlmError
        ? lastError
        : new LlmError('All stream providers in cascade exhausted', {}, err ?? lastError);
    }
  }

  async executeEmbed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
    options?: EmbedOptions,
  ): Promise<EmbedResult> {
    if (
      usageContext?.userByokKey &&
      (usageContext.userByokProvider === 'gemini' || !usageContext.userByokProvider)
    ) {
      return GeminiProvider.withKey(usageContext.userByokKey).embed(
        texts,
        model,
        usageContext,
        options,
      );
    }
    // Embeddings are locked to Google Generative AI gemini-embedding-001 (768-dim pgvector)
    return this.geminiProvider.embed(texts, model, usageContext, options);
  }
}
