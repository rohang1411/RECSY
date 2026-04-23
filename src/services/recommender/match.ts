import { ASPECT_NAMES, type AspectName } from '@/lib/constants';

import {
  RECOMMEND_BUDGET_RELAX_FACTOR,
  RECOMMEND_LIKED_BRAND_BONUS,
  RECOMMEND_MAX_PER_BRAND,
  RECOMMEND_SPEC_SIMANTIC_BUMP,
  RECOMMEND_TOP_PICKS,
} from './constants';
import type { PhoneCatalogEntry } from './catalog';
import type { UserRequirements } from './requirements-schema';
import { cosineSimilarity } from './vector-utils';

export interface ScoredCandidate {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly tagline: string | null;
  readonly msrpUsd: string | null;
  readonly imageUrl: string | null;
  readonly score: number;
  readonly summary: string;
}

export interface FilterPassOptions {
  readonly relaxBudgetMax: boolean;
  readonly ignoreFoldable: boolean;
  /** When set, overrides `requirements.budget_usd.max` for this pass (e.g. after relax). */
  readonly budgetMaxOverride?: number;
}

export function buildSearchHaystack(entry: PhoneCatalogEntry): string {
  const spec = entry.spec;
  const parts = [
    entry.brand,
    entry.model,
    entry.tagline ?? '',
    spec?.chipset ?? '',
    spec?.os ?? '',
    ...(spec?.highlights ?? []),
  ];
  return parts.join(' ').toLowerCase();
}

export function dealBreakerHit(haystack: string, dealBreakers: readonly string[]): boolean {
  for (const d of dealBreakers) {
    const t = d.trim().toLowerCase();
    if (t && haystack.includes(t)) return true;
  }
  return false;
}

export function mustHaveMatchRatio(haystack: string, mustHaves: readonly string[]): number {
  if (mustHaves.length === 0) return 1;
  let ok = 0;
  for (const m of mustHaves) {
    const t = m.trim().toLowerCase();
    if (t && haystack.includes(t)) ok++;
  }
  return ok / mustHaves.length;
}

export function passesHardFilters(
  entry: PhoneCatalogEntry,
  requirements: UserRequirements,
  opts: FilterPassOptions,
): boolean {
  if (requirements.brand_preference.disliked.length > 0) {
    const b = entry.brand.toLowerCase();
    for (const d of requirements.brand_preference.disliked) {
      const t = d.trim().toLowerCase();
      if (!t) continue;
      if (b.includes(t) || t.includes(b)) return false;
    }
  }

  const spec = entry.spec;
  const ff = requirements.form_factor;

  if (ff?.foldable === true && !opts.ignoreFoldable) {
    if (!spec?.foldable) return false;
  }

  if (ff?.weight_max_g != null && spec != null) {
    if (spec.weight_g > ff.weight_max_g) return false;
  }

  if (ff?.screen_size_range_in && spec != null) {
    const [a, b] = ff.screen_size_range_in;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const sz = spec.display.size_in;
    if (sz < lo || sz > hi) return false;
  }

  const budget = requirements.budget_usd;
  if (budget?.max != null) {
    const max =
      opts.budgetMaxOverride ??
      (opts.relaxBudgetMax ? budget.max * RECOMMEND_BUDGET_RELAX_FACTOR : budget.max);
    if (entry.msrpUsd != null) {
      const price = Number.parseFloat(entry.msrpUsd);
      if (!Number.isNaN(price) && price > max) return false;
    }
  }

  if (budget?.min != null && entry.msrpUsd != null) {
    const price = Number.parseFloat(entry.msrpUsd);
    if (!Number.isNaN(price) && price < budget.min) return false;
  }

  return true;
}

export function resolveAspectWeights(
  requirements: UserRequirements,
  defaultWeights: ReadonlyMap<AspectName, number>,
): Map<AspectName, number> {
  const raw = new Map<AspectName, number>();
  for (const name of ASPECT_NAMES) {
    const p = requirements.priorities.find((x) => x.aspect === name);
    raw.set(name, p?.weight ?? defaultWeights.get(name) ?? 1 / ASPECT_NAMES.length);
  }
  const sum = [...raw.values()].reduce((a, b) => a + b, 0);
  if (sum <= 1e-9) {
    return new Map(ASPECT_NAMES.map((n) => [n, 1 / ASPECT_NAMES.length]));
  }
  return new Map([...raw].map(([k, v]) => [k, v / sum]));
}

export function weightedAspectScore(
  scores: ReadonlyMap<AspectName, number>,
  weights: ReadonlyMap<AspectName, number>,
): number {
  let acc = 0;
  for (const name of ASPECT_NAMES) {
    const w = weights.get(name) ?? 0;
    const s = scores.get(name) ?? 5;
    acc += w * s;
  }
  return acc;
}

export function topWeightedAspect(
  weights: ReadonlyMap<AspectName, number>,
  scores: ReadonlyMap<AspectName, number>,
): { aspect: AspectName; value: number } {
  let best: AspectName = 'value';
  let bestW = -1;
  for (const name of ASPECT_NAMES) {
    const w = weights.get(name) ?? 0;
    if (w > bestW) {
      bestW = w;
      best = name;
    }
  }
  return { aspect: best, value: scores.get(best) ?? 5 };
}

export function pickSummaryLine(
  entry: PhoneCatalogEntry,
  weights: ReadonlyMap<AspectName, number>,
): string {
  const { aspect, value } = topWeightedAspect(weights, entry.aspectScores);
  return `Strongest on ${aspect} for what you said matters (aspect score ${value.toFixed(1)}/10).`;
}

/** Additive 0..`RECOMMEND_SPEC_SIMANTIC_BUMP` from cosine(query, spec_embedding). */
export function specSemanticBonus(
  entry: PhoneCatalogEntry,
  queryEmbedding: readonly number[] | undefined,
): number {
  if (!queryEmbedding?.length || !entry.specEmbedding?.length) return 0;
  if (queryEmbedding.length !== entry.specEmbedding.length) return 0;
  const cos = cosineSimilarity(queryEmbedding, entry.specEmbedding);
  const t = (cos + 1) / 2;
  return t * RECOMMEND_SPEC_SIMANTIC_BUMP;
}

export function pickDiverseTop(
  ranked: readonly ScoredCandidate[],
  limit: number,
  maxPerBrand: number,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const brandCounts = new Map<string, number>();
  const picked = new Set<string>();

  for (const c of ranked) {
    const key = c.brand.toLowerCase();
    const n = brandCounts.get(key) ?? 0;
    if (n >= maxPerBrand) continue;
    brandCounts.set(key, n + 1);
    out.push(c);
    picked.add(c.slug);
    if (out.length >= limit) return out;
  }

  for (const c of ranked) {
    if (picked.has(c.slug)) continue;
    out.push(c);
    picked.add(c.slug);
    if (out.length >= limit) break;
  }

  return out;
}

function scoreEntry(
  entry: PhoneCatalogEntry,
  requirements: UserRequirements,
  weights: ReadonlyMap<AspectName, number>,
  queryEmbedding: readonly number[] | undefined,
): ScoredCandidate {
  const haystack = buildSearchHaystack(entry);
  let score = weightedAspectScore(entry.aspectScores, weights);
  const ratio = mustHaveMatchRatio(haystack, requirements.must_haves);
  score = score * (0.72 + 0.28 * ratio);
  score += specSemanticBonus(entry, queryEmbedding);

  for (const l of requirements.brand_preference.liked) {
    const t = l.trim().toLowerCase();
    if (t && haystack.includes(t)) {
      score += RECOMMEND_LIKED_BRAND_BONUS;
      break;
    }
  }

  return {
    phoneId: entry.phoneId,
    slug: entry.slug,
    brand: entry.brand,
    model: entry.model,
    tagline: entry.tagline,
    msrpUsd: entry.msrpUsd,
    imageUrl: entry.imageUrl,
    score,
    summary: pickSummaryLine(entry, weights),
  };
}

function collectScored(
  catalog: readonly PhoneCatalogEntry[],
  requirements: UserRequirements,
  weights: ReadonlyMap<AspectName, number>,
  opts: FilterPassOptions,
  queryEmbedding: readonly number[] | undefined,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const entry of catalog) {
    if (!passesHardFilters(entry, requirements, opts)) continue;
    const haystack = buildSearchHaystack(entry);
    if (dealBreakerHit(haystack, requirements.deal_breakers)) continue;
    out.push(scoreEntry(entry, requirements, weights, queryEmbedding));
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function rankCandidates(
  catalog: readonly PhoneCatalogEntry[],
  requirements: UserRequirements,
  defaultWeights: ReadonlyMap<AspectName, number>,
  options?: { readonly queryEmbedding?: readonly number[] },
): { picks: ScoredCandidate[]; relaxed: string[] } {
  const queryEmbedding = options?.queryEmbedding;
  const weights = resolveAspectWeights(requirements, defaultWeights);
  const relaxed: string[] = [];

  let ranked = collectScored(
    catalog,
    requirements,
    weights,
    {
      relaxBudgetMax: false,
      ignoreFoldable: false,
    },
    queryEmbedding,
  );

  if (ranked.length === 0 && requirements.budget_usd?.max != null) {
    ranked = collectScored(
      catalog,
      requirements,
      weights,
      {
        relaxBudgetMax: true,
        ignoreFoldable: false,
      },
      queryEmbedding,
    );
    if (ranked.length > 0) relaxed.push('budget_max_widened');
  }

  if (ranked.length === 0 && requirements.form_factor?.foldable === true) {
    ranked = collectScored(
      catalog,
      requirements,
      weights,
      {
        relaxBudgetMax: true,
        ignoreFoldable: true,
      },
      queryEmbedding,
    );
    if (ranked.length > 0) relaxed.push('foldable_preference_ignored');
  }

  if (ranked.length === 0) {
    for (const entry of catalog) {
      const haystack = buildSearchHaystack(entry);
      if (dealBreakerHit(haystack, requirements.deal_breakers)) continue;
      ranked.push(scoreEntry(entry, requirements, weights, queryEmbedding));
    }
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length > 0) relaxed.push('fallback_all_active_phones');
  }

  const picks = pickDiverseTop(ranked, RECOMMEND_TOP_PICKS, RECOMMEND_MAX_PER_BRAND);
  return { picks, relaxed };
}
