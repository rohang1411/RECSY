/**
 * LLM provider factory and Model Gateway.
 *
 * Feature code imports `llm` from this module and receives a provider selected
 * by environment. All callers observe the same interface regardless of which
 * concrete implementation is active.
 *
 * Supports:
 *   - 'gemini': Native Google Gemini provider (Flash / Pro).
 *   - 'groq': Groq Cloud provider for ultra-low latency inference.
 *   - 'nvidia': NVIDIA NIM provider for enterprise deep reasoning.
 *   - 'gateway': Dynamic Model Gateway routing tasks across Gemini, Groq, and NVIDIA NIM by reasoning effort.
 *   - 'controlled': Deterministic controlled provider for offline testing.
 */
import { env } from '@/env';

import { CachedLlmProvider } from './cache';
import { GeminiProvider } from './gemini';
import { ControlledProvider } from './controlled';
import { GroqProvider } from './groq';
import { NvidiaNimProvider } from './nvidia-nim';
import { ModelGateway } from './model-gateway';
import { ModelGatewayProvider } from './gateway';
import type { LlmProvider } from './types';

let _llm: LlmProvider | null = null;
let _gateway: ModelGateway | null = null;

/** Idempotent factory — returns the process-wide Model Gateway instance. */
export function getModelGateway(): ModelGateway {
  if (_gateway !== null) return _gateway;
  _gateway = new ModelGateway();
  return _gateway;
}

/** Idempotent factory — returns the process-wide provider instance. */
export function getLlm(): LlmProvider {
  if (_llm !== null) return _llm;

  const base: LlmProvider = (() => {
    switch (env.LLM_PROVIDER) {
      case 'gemini':
        if (env.LLM_ROUTER_ENABLED) {
          return new ModelGatewayProvider();
        }
        return new GeminiProvider();
      case 'gateway':
        return new ModelGatewayProvider();
      case 'controlled':
        return new ControlledProvider();
      case 'groq':
        return new GroqProvider();
      case 'nvidia':
        return new NvidiaNimProvider();
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
export { GeminiProvider } from './gemini';
export { GroqProvider } from './groq';
export { NvidiaNimProvider } from './nvidia-nim';
export { ModelGateway, type ReasoningEffort, type RouteDecision } from './model-gateway';
export { ModelGatewayProvider } from './gateway';
