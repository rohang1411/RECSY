import { z } from 'zod';

import { ASPECT_NAMES, type AspectName } from '@/lib/constants';

/**
 * LLMs often emit title case ("Camera") or synonyms; we normalise to our enum
 * so `generateObject` + Zod validation does not hard-fail the whole request.
 */
const aspectNameFromLlm: z.ZodType<AspectName> = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(ASPECT_NAMES));

function parseUsdAmount(v: unknown): unknown {
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

const budgetObjectSchema = z.object({
  min: z
    .preprocess(
      (v) => (v == null || v === undefined ? undefined : parseUsdAmount(v)),
      z.coerce.number().nonnegative(),
    )
    .optional(),
  max: z.preprocess(parseUsdAmount, z.coerce.number().positive()),
});

/**
 * `budget_usd` may be a bare number (800) or strings from JSON; sometimes only
 * `max` is needed for "under $800".
 */
const budgetUsdSchema = z.preprocess((v) => {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { max: v };
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[$,]/g, ''));
    if (Number.isFinite(n) && n > 0) return { max: n };
  }
  return v;
}, budgetObjectSchema.nullable());

const priorityItemSchema = z.object({
  aspect: aspectNameFromLlm,
  /** 0–1 relative weights, or 0–100 style; `normalizeUserRequirements` rescales. */
  weight: z.coerce.number().min(0).max(100),
});

/**
 * `z.tuple` / fixed-length JSON arrays for `form_factor` break Gemini's
 * `responseSchema` (protobuf rejects some `items` shapes). We use two number
 * fields; `normalizeUserRequirements` maps to `screen_size_range_in` for
 * `match.ts`. Preprocess also accepts a legacy 2-tuple from the model or DB
 * and maps it to min/max.
 */
const formFactorObjectSchema = z.object({
  screen_size_min_in: z.coerce.number().positive().optional(),
  screen_size_max_in: z.coerce.number().positive().optional(),
  weight_max_g: z.coerce.number().positive().optional(),
  foldable: z.preprocess((v) => {
    if (v == null) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(s)) return true;
      if (['false', '0', 'no'].includes(s)) return false;
    }
    return undefined;
  }, z.boolean().optional()),
});

const formFactorSchema = z.preprocess((v) => {
  if (v === null || v === false) return undefined;
  if (typeof v !== 'object' || v == null) return v;
  const o = { ...v } as Record<string, unknown>;
  if (Array.isArray(o.screen_size_range_in) && o.screen_size_range_in.length >= 2) {
    const a = Number(o.screen_size_range_in[0]);
    const b = Number(o.screen_size_range_in[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      o.screen_size_min_in = Math.min(a, b);
      o.screen_size_max_in = Math.max(a, b);
    }
    delete o.screen_size_range_in;
  }
  return o;
}, formFactorObjectSchema.optional());

const stringArray = z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string()));

const brandPreferenceSchema = z.object({
  liked: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string())),
  disliked: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string())),
});

const confidenceFromLlm = z.preprocess((v) => {
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  if (typeof v === 'number' && v > 1 && v <= 100) return v / 100;
  return v;
}, z.coerce.number().min(0).max(1));

/**
 * Structured preference object — Stage A output (§11). Validated after every
 * LLM call and before candidate ranking.
 *
 * Tuned for real Gemini/JSON output: nulls, loose numbers, and aspect casing
 * are normalised; `normalizeUserRequirements` then applies app semantics.
 */
export const userRequirementsSchema = z.object({
  budget_usd: budgetUsdSchema.optional().nullable(),
  priorities: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(priorityItemSchema).max(7))
    .default([]),
  must_haves: stringArray.default([]),
  deal_breakers: stringArray.default([]),
  use_cases: stringArray.default([]),
  form_factor: z.preprocess((v) => (v === null || v === false ? undefined : v), formFactorSchema),
  brand_preference: z.preprocess(
    (v) => (v == null || typeof v !== 'object' ? { liked: [], disliked: [] } : v),
    brandPreferenceSchema,
  ),
  confidence: confidenceFromLlm,
  clarifying_question: z
    .string()
    .max(500)
    .nullish()
    .transform((q) => (q == null || q.trim() === '' ? undefined : q)),
});

/** Parsed shape (may include Llm field names such as `screen_size_min_in`). */
export type UserRequirementsLlm = z.infer<typeof userRequirementsSchema>;

/** Normalised for ranking / DB: `form_factor.screen_size_range_in` tuple. */
export type UserRequirements = Omit<
  UserRequirementsLlm,
  'form_factor' | 'priorities' | 'budget_usd'
> & {
  budget_usd: { min?: number; max: number } | null;
  readonly priorities: readonly { aspect: AspectName; weight: number }[];
  form_factor?: {
    screen_size_range_in?: [number, number];
    weight_max_g?: number;
    foldable?: boolean;
  };
};

function formFactorLlmToApp(
  raw: z.infer<typeof formFactorObjectSchema> | undefined,
): UserRequirements['form_factor'] {
  if (raw == null) return undefined;
  const a = raw.screen_size_min_in;
  const b = raw.screen_size_max_in;
  const screen_size_range_in =
    a != null && b != null && a > 0 && b > 0
      ? ([Math.min(a, b), Math.max(a, b)] as [number, number])
      : undefined;
  return {
    ...(raw.weight_max_g != null ? { weight_max_g: raw.weight_max_g } : {}),
    ...(raw.foldable !== undefined ? { foldable: raw.foldable } : {}),
    ...(screen_size_range_in ? { screen_size_range_in } : {}),
  };
}

/** Stable JSON for prompts / DB — normalised requirements. */
export function normalizeUserRequirements(raw: UserRequirementsLlm): UserRequirements {
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
    form_factor: formFactorLlmToApp(raw.form_factor),
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
