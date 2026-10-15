import type {
  ChatDelta,
  ChatInput,
  ChatResult,
  EmbedOptions,
  EmbedResult,
  StructuredInput,
  StructuredResult,
} from '../types';

export interface ModelAdapter {
  readonly providerId: string;
  readonly defaultBaseUrl?: string;

  chat(input: ChatInput, model: string, apiKey: string): Promise<ChatResult>;
  chatStream(input: ChatInput, model: string, apiKey: string): AsyncIterable<ChatDelta>;
  structured<T>(
    input: StructuredInput<T>,
    model: string,
    apiKey: string,
  ): Promise<StructuredResult<T>>;
  embed?(
    texts: readonly string[],
    model: string,
    apiKey: string,
    options?: EmbedOptions,
  ): Promise<EmbedResult>;
}
