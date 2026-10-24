/**
 * LLM provider abstraction.
 *
 * Feature code depends exclusively on this interface — never on a concrete
 * provider. Implementations live in sibling files (`gemini.ts`, `groq.ts`)
 * and the cache decorator lives in `cache.ts`.
 */
import type { z } from 'zod';

/** Canonical role tags accepted across providers. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** Semantic classification of tasks for intelligent model routing. */
export type TaskClass =
  | 'EXTRACTION'
  | 'DISAMBIGUATION'
  | 'GROUNDED_SYNTHESIS'
  | 'DEEP_REASONING'
  | 'EMBEDDING';

/** Execution tier for routing. */
export type ExecutionTier = 'fast' | 'balanced' | 'reasoning';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatInput {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  /** 0..1. Lower = more deterministic. Defaults to provider default. */
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Explicit task classification for zero-overhead routing. */
  readonly taskClass?: TaskClass;
  /** Override preferred execution tier. */
  readonly preferredTier?: ExecutionTier;
  /** Optional thinking budget for grounded synthesis (Plan 26 WP-04 / WP-10). */
  readonly thinking?: 'default' | 'low' | 'minimal';
  /** Opaque ids used by the cache key; callers can omit. */
  readonly cacheKeyExtras?: Readonly<Record<string, string | number | boolean>>;
  readonly usageContext?: LlmUsageContext;
  readonly signal?: AbortSignal;
}

export interface LlmUsageContext {
  readonly area: string;
  readonly feature?: string;
  readonly source?: string;
  readonly taskClass?: TaskClass;
  readonly userMode?: 'fast' | 'deep';
  readonly isSubscriber?: boolean;
  readonly userByokKey?: string;
  readonly userByokProvider?: 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'openai' | 'openrouter';
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ChatUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export interface ChatResult {
  readonly text: string;
  readonly usage: ChatUsage;
  readonly model: string;
  readonly cached: boolean;
}

/** A single streamed chunk of assistant output. */
export interface ChatDelta {
  readonly type: 'text-delta' | 'finish';
  readonly textDelta?: string;
  readonly usage?: ChatUsage;
  readonly model?: string;
}

/**
 * Structured-output generation. The response is validated against `schema`
 * and returned as a parsed TS value, never a raw string.
 */
export interface StructuredInput<T> extends Omit<ChatInput, 'messages'> {
  readonly messages: readonly ChatMessage[];
  readonly schema: z.ZodType<T>;
  readonly schemaName: string;
  readonly schemaDescription?: string;
}

export interface StructuredResult<T> {
  readonly value: T;
  readonly usage: ChatUsage;
  readonly model: string;
  readonly cached: boolean;
  /** Number of attempts taken (1 = no retry). */
  readonly attempts: number;
}

export interface EmbedResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly model: string;
  readonly usage: { readonly tokensIn: number };
}

export interface EmbedOptions {
  readonly taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';
  readonly signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: string;
  /** Blocking chat completion. */
  chat(input: ChatInput): Promise<ChatResult>;
  /** Streaming chat completion. Consumers iterate deltas. */
  chatStream(input: ChatInput): AsyncIterable<ChatDelta>;
  /** Look up cached chat response without executing model (Plan 26 WP-06/WP-10). */
  lookupChat?(input: ChatInput): Promise<ChatResult | null>;
  /** Store completed chat response in cache (Plan 26 WP-06/WP-10). */
  storeChat?(input: ChatInput, result: ChatResult): void;
  /** Zod-validated structured output with automatic one-shot retry on schema failures. */
  structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>>;
  /** Batched text embedding. */
  embed(
    texts: readonly string[],
    model?: string,
    usageContext?: LlmUsageContext,
    options?: EmbedOptions,
  ): Promise<EmbedResult>;
}

/** Interface segregation: callers needing only chat, streaming, and structured extraction. */
export type ChatCapable = Pick<LlmProvider, 'name' | 'chat' | 'chatStream' | 'structured'> & {
  lookupChat?(input: ChatInput): Promise<ChatResult | null>;
  storeChat?(input: ChatInput, result: ChatResult): void;
};

/** Interface segregation: callers needing only embedding generation. */
export type EmbedCapable = Pick<LlmProvider, 'name' | 'embed'>;
