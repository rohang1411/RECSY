/**
 * Automated Semantic Titling Engine for RECSY recommendation sessions.
 *
 * Implements deterministic fast-path titling using extracted constraints
 * (budget, top aspects, brands, form factor) with an asynchronous LLM fallback
 * for nuanced/conversational queries.
 */
import { env } from '@/env';
import type { LlmProvider } from '@/services/llm/types';
import type { UserRequirements } from './requirements-schema';

export function generateDeterministicTitle(req: UserRequirements): string | null {
  const currencySymbol =
    req.budget_local?.currency === 'INR'
      ? '₹'
      : req.budget_local?.currency === 'EUR'
        ? '€'
        : req.budget_local?.currency === 'GBP'
          ? '£'
          : '$';

  const budget = req.budget_local?.max
    ? `Under ${currencySymbol}${req.budget_local.max.toLocaleString()}`
    : req.budget_usd?.max
      ? `Under $${req.budget_usd.max.toLocaleString()}`
      : null;

  const aspects = req.priorities
    .slice(0, 2)
    .map((p) => p.aspect.charAt(0).toUpperCase() + p.aspect.slice(1))
    .join(' & ');

  const likedBrand = req.brand_preference?.liked?.[0]
    ? req.brand_preference.liked[0].charAt(0).toUpperCase() + req.brand_preference.liked[0].slice(1)
    : null;

  const keyFeature = req.must_haves?.[0]
    ? req.must_haves[0].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  if (budget && aspects) return `${budget} • ${aspects}`;
  if (likedBrand && budget) return `${likedBrand} • ${budget}`;
  if (likedBrand && aspects) return `${likedBrand} • ${aspects}`;
  if (keyFeature && budget) return `${keyFeature} • ${budget}`;
  if (keyFeature && aspects) return `${keyFeature} • ${aspects}`;
  if (aspects) return `${aspects} Focus`;
  if (budget) return `${budget} Search`;
  if (likedBrand) return `${likedBrand} Phones`;
  if (keyFeature) return `${keyFeature} Search`;

  return null;
}

export async function generateSessionTitle(options: {
  readonly requirements?: UserRequirements | null;
  readonly userMessage: string;
  readonly llm?: LlmProvider | null;
}): Promise<string> {
  const { requirements, userMessage, llm } = options;

  if (requirements) {
    const fastTitle = generateDeterministicTitle(requirements);
    if (fastTitle) return fastTitle;
  }

  if (llm && userMessage.trim().length > 0) {
    try {
      const prompt =
        'Generate a concise, elegant 2 to 4 word title for a smartphone shopping conversation based on this request. ' +
        'Examples: "Flagship Camera Focus", "Compact Budget Android", "College Student Upgrade", "Long Battery Gaming". ' +
        'Return ONLY the title text. Do not wrap in quotes or add periods.\n\n' +
        `User Request: "${userMessage.trim().slice(0, 300)}"`;

      const res = await llm.chat({
        model: env.LLM_CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        maxOutputTokens: 20,
        usageContext: {
          area: 'Recommendation',
          feature: 'Session titling',
          source: '/api/recommend',
        },
      });

      const cleaned = res.text
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/[.\n\r]+$/, '')
        .trim();

      if (cleaned.length > 0 && cleaned.length <= 50) {
        return cleaned;
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Graceful fallback from message words
  const trimmed = userMessage.trim();
  if (trimmed.length > 0) {
    const words = trimmed.split(/\s+/).slice(0, 4).join(' ');
    const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
    return capitalized.length > 35 ? `${capitalized.slice(0, 32)}…` : capitalized;
  }

  return 'New Recommendation';
}
