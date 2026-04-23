/**
 * LLM provider factory.
 *
 * Feature code imports `llm` from this module and receives a provider selected
 * by environment. All callers observe the same interface regardless of which
 * concrete implementation is active.
 */
import { env } from '@/env';

import { CachedLlmProvider } from './cache';
import { GeminiProvider } from './gemini';
import type { LlmProvider } from './types';

let _llm: LlmProvider | null = null;

/** Idempotent factory — returns the process-wide provider instance. */
export function getLlm(): LlmProvider {
  if (_llm !== null) return _llm;

  const base: LlmProvider = (() => {
    switch (env.LLM_PROVIDER) {
      case 'gemini':
        return new GeminiProvider();
      case 'groq':
        // Placeholder until a GroqProvider is added. Explicit failure is
        // preferable to silently falling back to Gemini.
        throw new Error('Groq provider not yet implemented');
      default: {
        const exhaustive: never = env.LLM_PROVIDER;
        throw new Error(`Unknown LLM_PROVIDER: ${String(exhaustive)}`);
      }
    }
  })();

  _llm = new CachedLlmProvider(base, env.LLM_CACHE_ENABLED);
  return _llm;
}

/** Convenience proxy — equivalent to `getLlm()` on first access. */
export const llm = new Proxy({} as LlmProvider, {
  get(_t, prop, receiver) {
    return Reflect.get(getLlm() as object, prop, receiver);
  },
});

export * from './types';
