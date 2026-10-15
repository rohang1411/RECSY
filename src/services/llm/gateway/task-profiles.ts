import type { ExecutionTier, LlmUsageContext, TaskClass } from '../types';

export interface ModelCandidate {
  readonly providerId: 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'github' | 'openrouter';
  readonly model: string;
  readonly maxTokens: number;
  readonly contextWindow: number;
}

/**
 * Resolves the TaskClass from explicit declaration or infers it from LlmUsageContext.
 */
export function resolveTaskClass(
  explicitClass?: TaskClass,
  context?: Partial<LlmUsageContext>,
): TaskClass {
  if (explicitClass) return explicitClass;
  if (context?.taskClass) return context.taskClass;

  const area = (context?.area ?? '').toLowerCase();
  const feature = (context?.feature ?? '').toLowerCase();
  const source = (context?.source ?? '').toLowerCase();

  // 1. Reasoning & Evaluations
  if (
    area.includes('evaluation') ||
    area.includes('benchmark') ||
    area.includes('ablation') ||
    feature.includes('tie-break') ||
    feature.includes('trade-off') ||
    feature.includes('evaluation') ||
    feature.includes('comparison') ||
    source.includes('ablation')
  ) {
    return 'DEEP_REASONING';
  }

  // 2. Grounded Synthesis & Scorecard
  if (
    area.includes('phone q&a') ||
    area.includes('scorecard') ||
    feature.includes('grounded') ||
    feature.includes('aspect') ||
    feature.includes('synthesis') ||
    source.includes('/api/ask')
  ) {
    return 'GROUNDED_SYNTHESIS';
  }

  // 3. Disambiguation
  if (
    area.includes('disambiguation') ||
    feature.includes('disambiguation') ||
    feature.includes('rerank') ||
    source.includes('disambiguator') ||
    source.includes('rerank')
  ) {
    return 'DISAMBIGUATION';
  }

  // 4. Extractions
  if (
    area.includes('catalog') ||
    area.includes('extraction') ||
    feature.includes('spec') ||
    feature.includes('requirement') ||
    feature.includes('curator') ||
    feature.includes('extraction') ||
    feature.includes('scraper') ||
    source.includes('gsmarena') ||
    source.includes('wikipedia') ||
    source.includes('extraction')
  ) {
    return 'EXTRACTION';
  }

  // Default fallback
  return 'GROUNDED_SYNTHESIS';
}

/**
 * Maps task classes to their base execution tier.
 */
export function taskClassToBaseTier(taskClass: TaskClass): ExecutionTier {
  switch (taskClass) {
    case 'EXTRACTION':
      return 'fast';
    case 'DISAMBIGUATION':
    case 'GROUNDED_SYNTHESIS':
      return 'balanced';
    case 'DEEP_REASONING':
      return 'reasoning';
    case 'EMBEDDING':
      return 'fast';
    default:
      return 'balanced';
  }
}

/**
 * Model candidate pools ordered by preference for each execution tier.
 */
export const TIER_MODEL_POOLS: Record<ExecutionTier, readonly ModelCandidate[]> = {
  fast: [
    {
      providerId: 'groq',
      model: 'llama-3.1-8b-instant',
      maxTokens: 4096,
      contextWindow: 128_000,
    },
    {
      providerId: 'cerebras',
      model: 'llama3.1-8b',
      maxTokens: 4096,
      contextWindow: 8_192,
    },
    {
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
      maxTokens: 8192,
      contextWindow: 1_000_000,
    },
  ],
  balanced: [
    {
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
      maxTokens: 8192,
      contextWindow: 1_000_000,
    },
    {
      providerId: 'groq',
      model: 'llama-3.3-70b-versatile',
      maxTokens: 8192,
      contextWindow: 128_000,
    },
    {
      providerId: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
      maxTokens: 4096,
      contextWindow: 128_000,
    },
    {
      providerId: 'github',
      model: 'gpt-4o-mini',
      maxTokens: 4096,
      contextWindow: 128_000,
    },
  ],
  reasoning: [
    {
      providerId: 'gemini',
      model: 'gemini-2.5-pro',
      maxTokens: 8192,
      contextWindow: 1_000_000,
    },
    {
      providerId: 'nvidia',
      model: 'deepseek-ai/deepseek-r1',
      maxTokens: 8192,
      contextWindow: 64_000,
    },
    {
      providerId: 'groq',
      model: 'llama-3.3-70b-versatile',
      maxTokens: 8192,
      contextWindow: 128_000,
    },
    {
      providerId: 'github',
      model: 'Meta-Llama-3.1-70B-Instruct',
      maxTokens: 4096,
      contextWindow: 128_000,
    },
    {
      providerId: 'gemini',
      model: 'gemini-3-flash-preview',
      maxTokens: 8192,
      contextWindow: 1_000_000,
    },
  ],
};
