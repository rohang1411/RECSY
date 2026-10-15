import { GeminiProvider } from '../gemini';
import { recordLlmUsageEvent } from '../usage';
import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedOptions,
  EmbedResult,
  LlmProvider,
  LlmUsageContext,
  StructuredInput,
  StructuredResult,
} from '../types';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { getKeyPool } from '../keys/key-pool';
import { getQuotaGovernor } from './quota-governor';
import { ModelRouter } from './router';
import { CascadeExecutor } from './cascade-executor';

export class ModelGatewayProvider implements LlmProvider {
  readonly name = 'model-gateway-router';
  private readonly geminiProvider: GeminiProvider;
  private readonly keyPool = getKeyPool();
  private readonly circuitBreakers = new CircuitBreakerRegistry();
  private readonly quotaGovernor = getQuotaGovernor();
  private readonly router: ModelRouter;
  private readonly executor: CascadeExecutor;

  constructor() {
    this.geminiProvider = new GeminiProvider();
    this.router = new ModelRouter(this.keyPool, this.circuitBreakers, this.quotaGovernor);
    this.executor = new CascadeExecutor(
      this.geminiProvider,
      this.keyPool,
      this.circuitBreakers,
      this.quotaGovernor,
    );
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const startedAt = performance.now();
    const resolution = this.router.resolveExecutionChain({
      explicitTaskClass: input.taskClass,
      explicitTier: input.preferredTier,
      messages: input.messages,
      usageContext: input.usageContext,
    });

    const result = await this.executor.executeChat(
      input,
      resolution.candidates,
      input.usageContext?.userByokKey,
      input.usageContext?.userByokProvider,
    );

    const latencyMs = performance.now() - startedAt;

    await recordLlmUsageEvent({
      provider: result.model.startsWith('gemini') ? 'gemini' : 'openai-compatible',
      model: result.model,
      operation: 'chat',
      usageContext: {
        ...input.usageContext,
        area: input.usageContext?.area ?? 'gateway',
        metadata: {
          ...input.usageContext?.metadata,
          taskClass: resolution.taskClass,
          tier: resolution.targetTier,
        },
      },
      inputTokens: result.usage.tokensIn,
      outputTokens: result.usage.tokensOut,
      latencyMs,
    });

    return result;
  }

  async *chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    const resolution = this.router.resolveExecutionChain({
      explicitTaskClass: input.taskClass,
      explicitTier: input.preferredTier,
      messages: input.messages,
      usageContext: input.usageContext,
    });

    yield* this.executor.executeStream(
      input,
      resolution.candidates,
      input.usageContext?.userByokKey,
      input.usageContext?.userByokProvider,
    );
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    const startedAt = performance.now();
    const resolution = this.router.resolveExecutionChain({
      explicitTaskClass: input.taskClass,
      explicitTier: input.preferredTier,
      messages: input.messages,
      usageContext: input.usageContext,
    });

    const result = await this.executor.executeStructured<T>(
      input,
      resolution.candidates,
      input.usageContext?.userByokKey,
      input.usageContext?.userByokProvider,
    );

    const latencyMs = performance.now() - startedAt;

    await recordLlmUsageEvent({
      provider: result.model.startsWith('gemini') ? 'gemini' : 'openai-compatible',
      model: result.model,
      operation: 'structured',
      usageContext: {
        ...input.usageContext,
        area: input.usageContext?.area ?? 'gateway',
        metadata: {
          ...input.usageContext?.metadata,
          taskClass: resolution.taskClass,
          tier: resolution.targetTier,
          attempts: result.attempts,
        },
      },
      inputTokens: result.usage.tokensIn,
      outputTokens: result.usage.tokensOut,
      latencyMs,
    });

    return result;
  }

  async embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
    options?: EmbedOptions,
  ): Promise<EmbedResult> {
    return this.executor.executeEmbed(texts, model, usageContext, options);
  }
}
