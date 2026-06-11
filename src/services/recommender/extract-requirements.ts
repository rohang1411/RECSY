/**
 * User requirement extraction via structured LLM output.
 *
 * `extractUserRequirements(llm, message)` sends the user's free-text message
 * to Gemini Flash using a Zod-backed structured-output schema
 * (`userRequirementsSchema`). Returns normalised `UserRequirements` including
 * budget range, brand preferences, must-haves, deal-breakers, and aspect
 * weights (camera, battery, etc.).
 *
 * The system prompt is built from `ASPECT_NAMES` so adding a new axis only
 * requires a constants change, not a prompt string change.
 *
 * Used by: `src/services/recommender/run-recommendation.ts`.
 */
import { env } from '@/env';
import type { LlmProvider } from '@/services/llm/types';
import { getRegionConfig, type RegionConfig } from '@/lib/regions';

import {
  normalizeUserRequirements,
  userRequirementsSchema,
  type UserRequirements,
} from './requirements-schema';
import { mergeUserRequirements, shouldResetRequirementState } from './requirements-merge';

function buildMessages(input: {
  readonly userMessage: string;
  readonly previous: UserRequirements | null;
  readonly regionConfig: RegionConfig;
}): { role: 'system' | 'user'; content: string }[] {
  const { label, currency, symbol, budgetExampleMax } = input.regionConfig;
  const system = `You are RECSY's preference extractor for phone shoppers.
The user is shopping in ${label}. The local currency is ${currency} (${symbol}).
Read the user's message and output structured JSON matching the schema.

Rules:
- Infer budget_local in ${currency} when the user mentions price.
  Examples of local price expressions: "under ${symbol}${budgetExampleMax}", "about ${budgetExampleMax} ${currency}", "${(budgetExampleMax / 1000).toFixed(0)}k", "around ${budgetExampleMax / 1000}K".
- If currency is ambiguous (no symbol, no unit), default to ${currency}.
- If the user explicitly states a foreign currency (e.g. "200 dollars" when in India), convert it to ${currency} at the approximate market rate.
- budget_local: { min?: number, max: number, currency: "${currency}" }
- budget_usd: Set this only if the user explicitly mentions USD or dollars.
- priorities: up to 7 entries, one per aspect you can infer. Use these exact lowercase slugs: camera, battery, performance, display, build, software, value. Weights may be 0–1 or 0–100 (relative); they are renormalised to sum to 1.
- must_haves: concrete requirements (e.g. "wireless charging", "3.5mm jack").
- deal_breakers: things that disqualify a phone for this user.
- use_cases: short phrases (e.g. "travel photos", "gaming", "one-handed use").
- form_factor: foldable true only if they want a foldable. If they give a screen size range in inches, use screen_size_min_in and screen_size_max_in (two numbers, not an array). weight_max_g only if stated.
- brand_preference: liked / disliked brand names as the user implied.
- If the user says Android, iPhone, or iOS, preserve that as a concrete platform preference in must_haves. Do not ask them to repeat the platform choice.
- An intake is actionable when it has both a budget/price constraint and at least one real preference (camera, battery, gaming, brand, Android/iPhone, size, etc.).
- Do NOT ask for Android vs iPhone, brand, screen size, zoom, or other nice-to-have details when the user already supplied an actionable intake. The recommender can rank with sensible defaults.
- confidence: how complete and actionable the requirements are (0-1). Use below 0.6 only when critical info (budget or the main priority/use case) is missing.
- clarifying_question: one short question ONLY if confidence would be below ~0.6 without asking; otherwise omit.

When PREVIOUS_STATE_JSON is present, merge the new message into it and return the full updated object. Preserve facts already present unless the new message explicitly changes them. Never ask for information that is already present in PREVIOUS_STATE_JSON.`;

  const user = input.previous
    ? `PREVIOUS_STATE_JSON:\n${JSON.stringify(input.previous)}\n\nNEW_USER_MESSAGE:\n${input.userMessage}`
    : `USER_MESSAGE:\n${input.userMessage}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export async function extractUserRequirements(input: {
  readonly llm: LlmProvider;
  readonly userMessage: string;
  readonly previous: UserRequirements | null;
  readonly regionCode?: string;
}): Promise<UserRequirements> {
  const previous = shouldResetRequirementState(input.userMessage) ? null : input.previous;
  const config = getRegionConfig(input.regionCode ?? 'US');
  const out = await input.llm.structured({
    model: env.LLM_CHAT_MODEL,
    messages: buildMessages({ userMessage: input.userMessage, previous, regionConfig: config }),
    schema: userRequirementsSchema,
    schemaName: 'UserRequirements',
    schemaDescription: 'Merged phone shopper preferences for RECSY recommender Stage A.',
    temperature: 0.15,
    maxOutputTokens: 1024,
    usageContext: {
      area: 'Recommendation',
      feature: 'Requirement extraction',
      source: '/api/recommend',
    },
  });
  return mergeUserRequirements({
    previous,
    extracted: normalizeUserRequirements(out.value),
    userMessage: input.userMessage,
  });
}
