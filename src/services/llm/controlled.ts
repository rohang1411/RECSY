import { env } from '@/env';
import { AppError, LlmError } from '@/lib/errors';
import type {
  ChatInput,
  ChatResult,
  EmbedOptions,
  EmbedResult,
  LlmProvider,
  LlmUsageContext,
  StructuredInput,
  StructuredResult,
} from './types';

export function isLoopbackDbUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** Local fault-injection transport, enabled only in a named evaluation schema. */
export class ControlledProvider implements LlmProvider {
  readonly name = 'controlled-test-provider';
  private readonly url: string;

  constructor() {
    const url = env.EVAL_CONTROLLED_PROVIDER_URL ? new URL(env.EVAL_CONTROLLED_PROVIDER_URL) : null;
    const isDev = env.NODE_ENV === 'development';
    const isProdAllowed =
      env.NODE_ENV === 'production' &&
      env.EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD === '1' &&
      isLoopbackDbUrl(env.DATABASE_URL);

    if (
      (!isDev && !isProdAllowed) ||
      !env.DATABASE_SCHEMA.startsWith('eval_') ||
      !url ||
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !env.EVAL_CONTROLLED_PROVIDER_TOKEN
    )
      throw new Error(
        'Controlled provider requires development mode (or controlled production build on loopback DB), eval_ schema, loopback HTTP URL, and a token',
      );
    this.url = url.origin;
  }

  private async call<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
    try {
      const response = await fetch(`${this.url}/${operation}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-eval-token': env.EVAL_CONTROLLED_PROVIDER_TOKEN!,
        },
        body: JSON.stringify(input),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(1000)])
          : AbortSignal.timeout(1000),
      });
      if (!response.ok)
        throw new LlmError(`Controlled ${operation} failed (HTTP ${response.status})`);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new AppError('LLM_TIMEOUT', `Controlled ${operation} timed out or was cancelled`, {
          cause: error,
        });
      throw error instanceof LlmError
        ? error
        : new LlmError(`Controlled ${operation} transport failed`, {}, error);
    }
  }

  chat(input: ChatInput): Promise<ChatResult> {
    return this.call('chat', input, input.signal);
  }

  async *chatStream(input: ChatInput) {
    const ttft = Number(env.EVAL_CONTROLLED_TTFT_MS ?? 0);
    const delay = Number(env.EVAL_CONTROLLED_STREAM_DELAY_MS ?? 0);
    const timeoutMs = Math.max(2000, ttft + delay * 50 + 2000);

    try {
      const response = await fetch(`${this.url}/stream`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-eval-token': env.EVAL_CONTROLLED_PROVIDER_TOKEN!,
        },
        body: JSON.stringify(input),
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok || !response.body) {
        // Fallback to chat if /stream not supported
        const result = await this.chat(input);
        yield { type: 'text-delta' as const, textDelta: result.text };
        yield { type: 'finish' as const, usage: result.usage };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'text-delta') {
            yield { type: 'text-delta' as const, textDelta: parsed.textDelta as string };
          } else if (parsed.type === 'finish') {
            yield { type: 'finish' as const, usage: parsed.usage };
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new AppError('LLM_TIMEOUT', 'Controlled chatStream timed out or was cancelled', {
          cause: err,
        });
      }
      // Fallback to chat
      const result = await this.chat(input);
      yield { type: 'text-delta' as const, textDelta: result.text };
      yield { type: 'finish' as const, usage: result.usage };
    }
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    const { schema, ...request } = input;
    const result = await this.call<StructuredResult<unknown>>('structured', request, input.signal);
    return { ...result, value: schema.parse(result.value) };
  }

  embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
    options?: EmbedOptions,
  ): Promise<EmbedResult> {
    return this.call(
      'embed',
      { texts, model, usageContext, taskType: options?.taskType },
      options?.signal,
    );
  }
}
