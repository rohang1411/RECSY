/**
 * Groq Cloud LLM provider implementation.
 *
 * Connects to Groq's high-speed inference engine via its OpenAI-compatible endpoint
 * (https://api.groq.com/openai/v1). Delivers ultra-low latency inference for
 * reasoning-suppressed extractions, intent classification, and high-throughput tasks.
 */
import { env } from '@/env';
import { LlmError, LlmSchemaViolation } from '@/lib/errors';
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
} from './types';

export interface GroqProviderOptions {
  readonly apiKey?: string;
  readonly defaultModel?: string;
  readonly baseUrl?: string;
}

export class GroqProvider implements LlmProvider {
  readonly name = 'groq';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: GroqProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? env.GROQ_API_KEY ?? '';
    this.baseUrl = opts.baseUrl ?? 'https://api.groq.com/openai/v1';
    this.defaultModel = opts.defaultModel ?? 'llama-3.3-70b-versatile';
  }

  private getAuthHeader(): Record<string, string> {
    if (!this.apiKey) {
      throw new LlmError('Groq API key not configured. Set GROQ_API_KEY in environment.');
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const model = input.model || this.defaultModel;
    const body = {
      model,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxOutputTokens ?? 2048,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new LlmError(`Groq API error (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    const text = json.choices[0]?.message?.content ?? '';
    return {
      text,
      usage: {
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
      },
      model: json.model ?? model,
      cached: false,
    };
  }

  async *chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    // Basic streaming fallback for chat
    const result = await this.chat(input);
    yield { type: 'text-delta', textDelta: result.text };
    yield { type: 'finish', usage: result.usage };
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    const model = input.model || this.defaultModel;
    const jsonPrompt = `${input.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}

CRITICAL: Return ONLY valid, minified JSON conforming to schema "${input.schemaName}". No markdown fences, no explanatory text.`;

    const body = {
      model,
      messages: [{ role: 'user', content: jsonPrompt }],
      temperature: input.temperature ?? 0,
      max_tokens: input.maxOutputTokens ?? 2048,
      response_format: { type: 'json_object' },
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new LlmError(`Groq API error (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    const raw = json.choices[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      throw new LlmSchemaViolation(
        `Groq output was not valid JSON for schema ${input.schemaName}`,
        { rawOutput: raw, parseError: String(parseErr) },
      );
    }

    const validated = input.schema.safeParse(parsed);
    if (!validated.success) {
      throw new LlmSchemaViolation(
        `Groq output failed Zod schema validation for ${input.schemaName}: ${validated.error.message}`,
        { rawOutput: raw, zodErrors: validated.error.issues },
      );
    }

    return {
      value: validated.data,
      usage: {
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
      },
      model: json.model ?? model,
      cached: false,
      attempts: 1,
    };
  }

  /**
   * Embeddings are not supported by Groq in RECSY (database requires 768-dim Gemini Matryoshka embeddings).
   * Callers needing embedding capabilities should require `EmbedCapable` and route embeddings to Gemini.
   */
  async embed(
    _texts: readonly string[],
    _model?: string,
    _usageContext?: LlmUsageContext,
    _options?: EmbedOptions,
  ): Promise<EmbedResult> {
    // Embedding is handled by Gemini Matryoshka (vector 768) to match the pgvector schema
    throw new LlmError(
      'Groq provider does not generate 768-dim embeddings; route to Gemini embedding model.',
    );
  }
}
