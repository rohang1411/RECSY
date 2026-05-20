/**
 * Recommender matching, ranking, and diversity logic.
 *
 * Core pipeline functions:
 * - `passesHardFilters` / `dealBreakerHit` / `mustHaveMatchRatio` — hard
 *   filter gates (budget, must-haves, deal-breakers).
 * - `weightedAspectScore` — compute a weighted score from aspect rows.
 * - `specSemanticBonus` — optional cosine-similarity bump from `spec_embedding`.
 * - `rankCandidates` — filter + score + sort all phones; returns `RankResult`
 *   with `scoresTied` and `scorecardMissing` flags.
 * - `pickDiverseTop` — apply the max-per-brand diversity cap.
 * - `resolveAspectWeights` / `aspectsByWeight` — normalise user priority weights.
 *
 * All functions are pure (no DB, no LLM, no side effects) — fully unit-testable
 * with fixture inputs.
 *
 * Used by: `src/services/recommender/run-recommendation.ts`.
 */
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
import {
  detectPlatformPreferenceFromRequirements,
  isPlatformRequirement,
} from './requirements-merge';
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

/**
 * Scores this close are effectively indistinguishable given the weighting
 * resolution (0.xx). Two picks within this delta are treated as a tie when
 * deciding whether to surface a "scores are tied" notice to the user.
 *
 * Picked conservatively — real aspect deltas are ≥ 0.5 in practice, so 0.05
 * only fires on genuine ties (e.g. every pick defaults to 5.0 because no
 * scorecards are ingested).
 */
export const SCORE_TIE_EPSILON = 0.05;

/** Aspect score used when a phone has no scored entry for an aspect. */
const NEUTRAL_ASPECT_SCORE = 5;

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

function matchesPlatformPreference(entry: PhoneCatalogEntry, platform: 'android' | 'ios'): boolean {
  const haystack = buildSearchHaystack(entry);
  const os = entry.spec?.os?.toLowerCase() ?? '';

  if (platform === 'android') {
    const brand = entry.brand.toLowerCase();
    return (
      (os && os.includes('android')) ||
      haystack.includes('android') ||
      ['google', 'samsung', 'oneplus', 'xiaomi', 'nothing', 'motorola'].includes(brand)
    );
  }

  return (
    (os && os.includes('ios')) ||
    haystack.includes('ios') ||
    entry.brand.toLowerCase() === 'apple' ||
    entry.model.toLowerCase().includes('iphone')
  );
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

  const platform = detectPlatformPreferenceFromRequirements(requirements);
  if (platform && !matchesPlatformPreference(entry, platform)) return false;

  const spec = entry.spec;
  const ff = requirements.form_factor;

  if (ff?.foldable === true && !opts.ignoreFoldable) {
    if (!spec?.foldable) return false;
  }

  if (ff?.weight_max_g != null && spec != null && spec.weight_g != null) {
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
    const s = scores.get(name) ?? NEUTRAL_ASPECT_SCORE;
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
  return { aspect: best, value: scores.get(best) ?? NEUTRAL_ASPECT_SCORE };
}

/**
 * Ranked list of aspect names by weight (highest first). Ties are broken by
 * the canonical `ASPECT_NAMES` order for determinism.
 */
export function aspectsByWeight(weights: ReadonlyMap<AspectName, number>): AspectName[] {
  return [...ASPECT_NAMES].sort((a, b) => {
    const wa = weights.get(a) ?? 0;
    const wb = weights.get(b) ?? 0;
    if (wb !== wa) return wb - wa;
    return ASPECT_NAMES.indexOf(a) - ASPECT_NAMES.indexOf(b);
  });
}

/**
 * Returns `true` when `entry` has no real scorecard data — either because
 * `aspectScores` is empty or because every recorded score is exactly the
 * neutral fallback (5.0) that the ranker substitutes when no scorecard row
 * exists. This is how we detect "no reviewer data yet" and explain ties to
 * the user honestly.
 */
export function hasRealAspectData(entry: PhoneCatalogEntry): boolean {
  if (entry.aspectScores.size === 0) return false;
  for (const v of entry.aspectScores.values()) {
    if (Number.isFinite(v) && v !== NEUTRAL_ASPECT_SCORE) return true;
  }
  return false;
}

/**
 * Context used to render the per-pick summary shown in the recommend chat.
 * Collected once per turn so every pick describes itself relative to the
 * **same** ranking story (top aspect, refined vs. fresh, data-present vs.
 * data-missing).
 */
export interface SummaryContext {
  readonly weights: ReadonlyMap<AspectName, number>;
  /** When `true`, this turn re-ranks the previous turn's picks rather than the full catalog. */
  readonly refined: boolean;
  /** `true` when every candidate in the current ranking is missing real aspect data. */
  readonly corpusScorecardMissing: boolean;
}

export function pickSummaryLine(entry: PhoneCatalogEntry, context: SummaryContext): string {
  const scores = entry.aspectScores;
  const sorted = aspectsByWeight(context.weights);
  const primary = sorted[0] ?? 'value';
  const secondary = sorted[1] ?? null;

  const phoneHasData = hasRealAspectData(entry);

  // No reviewer data anywhere in this ranking set → explain honestly.
  if (context.corpusScorecardMissing || !phoneHasData) {
    if (context.refined) {
      return secondary
        ? `No reviewer scorecard yet — ranked by stated priorities (top: ${primary}, then ${secondary}) and specs only.`
        : `No reviewer scorecard yet — ranked by your stated ${primary} priority and specs.`;
    }
    return `No reviewer scorecard yet for this phone — ranking reflects your stated priorities and specs only.`;
  }

  const primaryVal = scores.get(primary) ?? NEUTRAL_ASPECT_SCORE;
  // On refined turns the user usually cares about the *new* priority (often
  // the 2nd-ranked aspect in this turn's weights) — surface both so the
  // summary adapts to "which should I pick if performance is my 2nd priority".
  if (context.refined && secondary && secondary !== primary) {
    const secondaryVal = scores.get(secondary) ?? NEUTRAL_ASPECT_SCORE;
    return `${capitalize(primary)} ${primaryVal.toFixed(1)}/10, ${secondary} ${secondaryVal.toFixed(1)}/10 among your earlier picks.`;
  }

  return `Strongest on ${primary} for what you said matters (aspect score ${primaryVal.toFixed(1)}/10).`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
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

interface ScoringContext {
  readonly requirements: UserRequirements;
  readonly weights: ReadonlyMap<AspectName, number>;
  readonly queryEmbedding: readonly number[] | undefined;
  readonly summary: SummaryContext;
}

function scoreEntry(entry: PhoneCatalogEntry, ctx: ScoringContext): ScoredCandidate {
  const haystack = buildSearchHaystack(entry);
  let score = weightedAspectScore(entry.aspectScores, ctx.weights);
  const scoringMustHaves = ctx.requirements.must_haves.filter((m) => !isPlatformRequirement(m));
  const ratio = mustHaveMatchRatio(haystack, scoringMustHaves);
  score = score * (0.72 + 0.28 * ratio);
  score += specSemanticBonus(entry, ctx.queryEmbedding);

  for (const l of ctx.requirements.brand_preference.liked) {
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
    summary: pickSummaryLine(entry, ctx.summary),
  };
}

function collectScored(
  catalog: readonly PhoneCatalogEntry[],
  ctx: ScoringContext,
  opts: FilterPassOptions,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const entry of catalog) {
    if (!passesHardFilters(entry, ctx.requirements, opts)) continue;
    const haystack = buildSearchHaystack(entry);
    if (dealBreakerHit(haystack, ctx.requirements.deal_breakers)) continue;
    out.push(scoreEntry(entry, ctx));
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface RankResult {
  readonly picks: ScoredCandidate[];
  readonly relaxed: string[];
  /**
   * `true` when the top picks are within {@link SCORE_TIE_EPSILON} of each
   * other. UI should surface a "scores effectively tied" note.
   */
  readonly scoresTied: boolean;
  /**
   * `true` when none of the ranked candidates have real aspect scores (every
   * aspect defaults to the neutral 5.0). Typically means no chunks were
   * ingested yet so scorecards could not be built.
   */
  readonly scorecardMissing: boolean;
  /** Normalised aspect weights used for this ranking. */
  readonly weights: ReadonlyMap<AspectName, number>;
}

export function rankCandidates(
  catalog: readonly PhoneCatalogEntry[],
  requirements: UserRequirements,
  defaultWeights: ReadonlyMap<AspectName, number>,
  options?: { readonly queryEmbedding?: readonly number[]; readonly refined?: boolean },
): RankResult {
  const queryEmbedding = options?.queryEmbedding;
  const refined = options?.refined === true;
  const weights = resolveAspectWeights(requirements, defaultWeights);
  const relaxed: string[] = [];

  const corpusScorecardMissing = catalog.every((c) => !hasRealAspectData(c));

  const ctx: ScoringContext = {
    requirements,
    weights,
    queryEmbedding,
    summary: {
      weights,
      refined,
      corpusScorecardMissing,
    },
  };

  let ranked = collectScored(catalog, ctx, {
    relaxBudgetMax: false,
    ignoreFoldable: false,
  });

  if (ranked.length === 0 && requirements.budget_usd?.max != null) {
    ranked = collectScored(catalog, ctx, {
      relaxBudgetMax: true,
      ignoreFoldable: false,
    });
    if (ranked.length > 0) relaxed.push('budget_max_widened');
  }

  if (ranked.length === 0 && requirements.form_factor?.foldable === true) {
    ranked = collectScored(catalog, ctx, {
      relaxBudgetMax: true,
      ignoreFoldable: true,
    });
    if (ranked.length > 0) relaxed.push('foldable_preference_ignored');
  }

  if (ranked.length === 0) {
    for (const entry of catalog) {
      const haystack = buildSearchHaystack(entry);
      if (dealBreakerHit(haystack, requirements.deal_breakers)) continue;
      ranked.push(scoreEntry(entry, ctx));
    }
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length > 0) relaxed.push('fallback_all_active_phones');
  }

  const picks = pickDiverseTop(ranked, RECOMMEND_TOP_PICKS, RECOMMEND_MAX_PER_BRAND);

  const scoresTied = detectTopScoreTie(picks);
  const scorecardMissing =
    picks.length > 0 && picks.every((p) => !hasRealAspectDataForPhoneId(catalog, p.phoneId));

  return { picks, relaxed, scoresTied, scorecardMissing, weights };
}

function detectTopScoreTie(picks: readonly ScoredCandidate[]): boolean {
  if (picks.length < 2) return false;
  const top = picks[0]!.score;
  for (let i = 1; i < picks.length; i++) {
    if (Math.abs(top - picks[i]!.score) > SCORE_TIE_EPSILON) return false;
  }
  return true;
}

function hasRealAspectDataForPhoneId(
  catalog: readonly PhoneCatalogEntry[],
  phoneId: string,
): boolean {
  const entry = catalog.find((c) => c.phoneId === phoneId);
  return entry ? hasRealAspectData(entry) : false;
}
