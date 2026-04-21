import { z } from 'zod';

import { ASPECT_NAMES, type AspectName } from '@/lib/constants';

const aspectEnum = z.enum(ASPECT_NAMES);

const budgetUsdSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().positive(),
  })
  .nullable();

const priorityItemSchema = z.object({
  aspect: aspectEnum,
  weight: z.number().min(0).max(1),
});

const formFactorSchema = z
  .object({
    screen_size_range_in: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    weight_max_g: z.number().positive().optional(),
    foldable: z.boolean().optional(),
  })
  .optional();

const brandPreferenceSchema = z.object({
  liked: z.array(z.string()).default([]),
  disliked: z.array(z.string()).default([]),
});

/**
 * Structured preference object — Stage A output (§11). Validated after every
 * LLM call and before candidate ranking.
 */
export const userRequirementsSchema = z.object({
  budget_usd: budgetUsdSchema.optional().nullable(),
  priorities: z.array(priorityItemSchema).max(7).default([]),
  must_haves: z.array(z.string()).default([]),
  deal_breakers: z.array(z.string()).default([]),
  use_cases: z.array(z.string()).default([]),
  form_factor: formFactorSchema,
  brand_preference: brandPreferenceSchema.default({ liked: [], disliked: [] }),
  confidence: z.number().min(0).max(1),
  clarifying_question: z.string().max(500).optional(),
});

export type UserRequirements = z.infer<typeof userRequirementsSchema>;

/** Stable JSON for prompts / DB — normalised requirements. */
export function normalizeUserRequirements(raw: UserRequirements): UserRequirements {
  const must_haves = raw.must_haves.map((s) => s.trim()).filter(Boolean);
  const deal_breakers = raw.deal_breakers.map((s) => s.trim()).filter(Boolean);
  const use_cases = raw.use_cases.map((s) => s.trim()).filter(Boolean);

  const liked = raw.brand_preference.liked.map((s) => s.trim()).filter(Boolean);
  const disliked = raw.brand_preference.disliked.map((s) => s.trim()).filter(Boolean);

  const deduped = dedupePriorities(raw.priorities);
  const sumW = deduped.reduce((s, p) => s + p.weight, 0);
  const priorities =
    sumW > 1e-6 ? deduped.map((p) => ({ aspect: p.aspect, weight: p.weight / sumW })) : [];

  let budget_usd = raw.budget_usd ?? null;
  if (budget_usd && budget_usd.min != null && budget_usd.max < budget_usd.min) {
    budget_usd = { min: budget_usd.max, max: budget_usd.min };
  }

  return {
    ...raw,
    budget_usd,
    priorities,
    must_haves,
    deal_breakers,
    use_cases,
    brand_preference: { liked, disliked },
    form_factor: raw.form_factor ?? undefined,
  };
}

function dedupePriorities(items: readonly { aspect: AspectName; weight: number }[]): {
  aspect: AspectName;
  weight: number;
}[] {
  const map = new Map<AspectName, number>();
  for (const p of items) {
    const cur = map.get(p.aspect) ?? 0;
    map.set(p.aspect, Math.max(cur, p.weight));
  }
  return [...map.entries()].map(([aspect, weight]) => ({ aspect, weight }));
}
