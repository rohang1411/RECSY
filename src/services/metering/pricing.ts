/**
 * Static model pricing map in micro-USD per 1M tokens.
 * Normative reference: Section 7.9 of plan 25.
 *
 * 1 USD = 1,000,000 micro-USD.
 * e.g. $0.15 per 1M input tokens = 150,000 micro-USD.
 */

export interface ModelPricing {
  readonly inPerMTok: number; // micro-USD per 1M input tokens
  readonly outPerMTok: number; // micro-USD per 1M output tokens
}

export const MODEL_PRICING_MAP: Record<string, ModelPricing> = {
  // Fast tier
  'llama-3.1-8b-instant': { inPerMTok: 50_000, outPerMTok: 80_000 },
  'llama3.1-8b': { inPerMTok: 100_000, outPerMTok: 100_000 },
  'gpt-4o-mini': { inPerMTok: 150_000, outPerMTok: 600_000 },
  'gemini-3-flash-preview': { inPerMTok: 75_000, outPerMTok: 300_000 },
  'gemini-2.5-flash': { inPerMTok: 75_000, outPerMTok: 300_000 },

  // Balanced tier
  'llama-3.3-70b-versatile': { inPerMTok: 590_000, outPerMTok: 790_000 },
  'meta/llama-3.3-70b-instruct': { inPerMTok: 700_000, outPerMTok: 900_000 },

  // Reasoning tier
  'gemini-2.5-pro': { inPerMTok: 1_250_000, outPerMTok: 5_000_000 },
  'gpt-4o': { inPerMTok: 2_500_000, outPerMTok: 10_000_000 },
  'deepseek-ai/deepseek-r1': { inPerMTok: 550_000, outPerMTok: 2_190_000 },
  'Meta-Llama-3.1-70B-Instruct': { inPerMTok: 700_000, outPerMTok: 900_000 },

  // Embedding models
  'gemini-embedding-001': { inPerMTok: 20_000, outPerMTok: 0 },
  'text-embedding-004': { inPerMTok: 20_000, outPerMTok: 0 },
};

const DEFAULT_PRICING: ModelPricing = { inPerMTok: 75_000, outPerMTok: 300_000 };

/**
 * Calculates estimated query cost in micro-USD.
 */
export function estimateQueryCostMicros(
  model?: string | null,
  tokensIn?: number | null,
  tokensOut?: number | null,
): number {
  const tin = Math.max(tokensIn ?? 0, 0);
  const tout = Math.max(tokensOut ?? 0, 0);
  if (tin === 0 && tout === 0) return 0;

  const pricing = (model && MODEL_PRICING_MAP[model]) || DEFAULT_PRICING;
  const inCost = (tin * pricing.inPerMTok) / 1_000_000;
  const outCost = (tout * pricing.outPerMTok) / 1_000_000;

  return Math.round(inCost + outCost);
}
