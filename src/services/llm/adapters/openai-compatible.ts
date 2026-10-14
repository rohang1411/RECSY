import { AppError, LlmError, LlmSchemaViolation } from '@/lib/errors';
import { sanitizeAndParseJson } from '../gateway/json-sanitizer';
import type {
  ChatDelta,
  ChatInput,
  ChatMessage,
  ChatResult,
  StructuredInput,
  StructuredResult,
} from '../types';
import type { ModelAdapter } from './base-adapter';

export interface OpenAiCompatibleConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly defaultHeaders?: Record<string, string>;
  readonly supportsJsonResponseFormat?: boolean;
}

export class OpenAiCompatibleAdapter implements ModelAdapter {
  readonly providerId: string;
  readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly supportsJsonResponseFormat: boolean;

  constructor(config: OpenAiCompatibleConfig) {
    this.providerId = config.providerId;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.supportsJsonResponseFormat = config.supportsJsonResponseFormat ?? true;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private toOpenAiMessages(
    messages: readonly ChatMessage[],
  ): Array<{ role: string; content: string }> {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async chat(input: ChatInput, model: string, apiKey: string): Promise<ChatResult> {
    const timeoutMs = 45_000;
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages: this.toOpenAiMessages(input.messages),
      temperature: input.temperature ?? 0.2,
    };
    if (input.maxOutputTokens) {
      body.max_tokens = input.maxOutputTokens;
    }

    try {
      const response = await fetch(this.buildUrl('/chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        if (status === 429) {
          throw new LlmError(`[${this.providerId}] Rate limit exceeded (429): ${errorText}`, {
            status,
            model,
            retryable: true,
          });
        }
        if (status >= 500) {
          throw new LlmError(
            `[${this.providerId}] Provider server error (${status}): ${errorText}`,
            {
              status,
              model,
              retryable: true,
            },
          );
        }
        throw new LlmError(`[${this.providerId}] API error (${status}): ${errorText}`, {
          status,
          model,
          retryable: false,
        });
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = data.choices?.[0]?.message?.content ?? '';
      const usage = {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
      };

      return {
        text,
        usage,
        model,
        cached: false,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new AppError(
          'LLM_TIMEOUT',
          `[${this.providerId}] request timed out after ${timeoutMs}ms`,
          {
            cause: err,
          },
        );
      }
      throw new LlmError(
        `[${this.providerId}] Transport error: ${(err as Error).message}`,
        { model },
        err,
      );
    }
  }

  async structured<T>(
    input: StructuredInput<T>,
    model: string,
    apiKey: string,
  ): Promise<StructuredResult<T>> {
    const systemPromptWithSchema: ChatMessage = {
      role: 'system',
      content: [
        'You are a strict structured-data generation engine.',
        `You MUST return ONLY a valid JSON object matching the requested schema: ${input.schemaName}.`,
        input.schemaDescription ? `Schema details: ${input.schemaDescription}` : '',
        'CRITICAL: Output ONLY the raw JSON string. Do NOT wrap in markdown fences (no ```json). Do NOT add preambles, explanations, or trailing commentary.',
      ]
        .filter(Boolean)
        .join('\n'),
    };

    const initialMessages: readonly ChatMessage[] = [systemPromptWithSchema, ...input.messages];

    let lastError: unknown;
    let accumulatedTokensIn = 0;
    let accumulatedTokensOut = 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const messagesToUse =
        attempt === 1
          ? initialMessages
          : [
              ...initialMessages,
              {
                role: 'user' as const,
                content: `Your previous JSON output was invalid. Validation error: ${String(lastError)}. Please fix the JSON and output ONLY the corrected JSON object.`,
              },
            ];

      const chatInput: ChatInput = {
        ...input,
        messages: messagesToUse,
        temperature: 0.0,
      };

      try {
        const chatRes = await this.chat(chatInput, model, apiKey);
        accumulatedTokensIn += chatRes.usage.tokensIn;
        accumulatedTokensOut += chatRes.usage.tokensOut;

        const parsedJson = sanitizeAndParseJson(chatRes.text);
        const validatedValue = input.schema.parse(parsedJson);

        return {
          value: validatedValue,
          usage: {
            tokensIn: accumulatedTokensIn,
            tokensOut: accumulatedTokensOut,
          },
          model,
          cached: false,
          attempts: attempt,
        };
      } catch (err) {
        lastError = err;
        if (attempt === 2) {
          throw new LlmSchemaViolation(
            `[${this.providerId}] Failed to produce schema-valid ${input.schemaName} after 2 attempts: ${(err as Error).message}`,
            {
              model,
              schemaName: input.schemaName,
              attempts: 2,
            },
            err,
          );
        }
      }
    }

    throw lastError;
  }

  async *chatStream(input: ChatInput, model: string, apiKey: string): AsyncIterable<ChatDelta> {
    const body: Record<string, unknown> = {
      model,
      messages: this.toOpenAiMessages(input.messages),
      temperature: input.temperature ?? 0.3,
      stream: true,
    };
    if (input.maxOutputTokens) {
      body.max_tokens = input.maxOutputTokens;
    }

    const response = await fetch(this.buildUrl('/chat/completions'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...this.defaultHeaders,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new LlmError(`[${this.providerId}] Stream error (${response.status}): ${errorText}`, {
        status: response.status,
        model,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') {
            yield { type: 'finish' };
            return;
          }
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6)) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              const deltaText = data.choices?.[0]?.delta?.content;
              if (deltaText) {
                yield { type: 'text-delta', textDelta: deltaText };
              }
            } catch {
              // Ignore incomplete chunk
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'finish' };
  }
}
