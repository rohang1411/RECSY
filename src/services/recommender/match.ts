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
import { passesVerifiedHardFeatures } from './hard-features';
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
  readonly localPrice?: string | null;
  readonly localCurrency?: string | null;
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
export const SCORE_TIE_EPSILON = 0.02;

/** Aspect score used when a phone has no scored entry for an aspect. */
const NEUTRAL_ASPECT_SCORE = 5;

/**
 * Recommendation recency policy:
 * - Phones older than 3.5 years (1278 days) MUST NEVER be recommended.
 * - Phones released in the last 2 years (730 days) receive priority weighting.
 */
export const MAX_RECOMMEND_PHONE_AGE_DAYS = 3.5 * 365.25; // ~1278 days (~3.5 years)
export const PREFERRED_RECOMMEND_PHONE_AGE_DAYS = 2.0 * 365.25; // ~730 days (2 years)

export interface FilterPassOptions {
  readonly relaxBudgetMax: boolean;
  readonly ignoreFoldable: boolean;
  /** When set, overrides `requirements.budget_usd.max` for this pass (e.g. after relax). */
  readonly budgetMaxOverride?: number;
  /** Reference date for computing age (defaults to current date). */
  readonly now?: Date;
  /** When true, skips the 3.5 year maximum age filter. */
  readonly ignoreMaxAge?: boolean;
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
  if (!passesVerifiedHardFeatures(entry, requirements)) return false;
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

  // Maximum Age Filter: phones older than 3.5 years (1278 days) MUST NOT be recommended.
  // They remain in the database for browse, compare, and historical views, but are excluded
  // from recommendations because buyers should not be recommended 3+ year old hardware.
  if (!opts.ignoreMaxAge && entry.launchDate) {
    const now = opts.now ?? new Date();
    const ageDays = (now.getTime() - entry.launchDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_RECOMMEND_PHONE_AGE_DAYS) {
      return false;
    }
  }

  const spec = entry.spec;
  const ff = requirements.form_factor;

  if (ff?.foldable === true && !opts.ignoreFoldable) {
    if (!spec?.foldable) return false;
  }

  if (ff?.weight_max_g != null) {
    if (spec?.weight_g == null || spec.weight_g > ff.weight_max_g) return false;
  }

  if (ff?.screen_size_range_in) {
    if (!spec?.display?.size_in) return false;
    const [a, b] = ff.screen_size_range_in;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const sz = spec.display.size_in;
    if (sz < lo || sz > hi) return false;
  }

  // Regional Availability Filter
  if (entry.isAvailable === false) {
    return false;
  }

  // Budget filtering: use currency-aware local budget if available, otherwise USD.
  const localBudget = requirements.budget_local;
  if (localBudget && localBudget.max != null) {
    const max =
      opts.budgetMaxOverride ??
      (opts.relaxBudgetMax ? localBudget.max * RECOMMEND_BUDGET_RELAX_FACTOR : localBudget.max);
    const price = entry.localPrice == null ? NaN : Number.parseFloat(entry.localPrice);
    if (!Number.isFinite(price) || price > max) return false;
  } else {
    const budget = requirements.budget_usd;
    if (budget?.max != null) {
      const max =
        opts.budgetMaxOverride ??
        (opts.relaxBudgetMax ? budget.max * RECOMMEND_BUDGET_RELAX_FACTOR : budget.max);
      const price = entry.msrpUsd == null ? NaN : Number.parseFloat(entry.msrpUsd);
      if (!Number.isFinite(price) || price > max) return false;
    }
  }

  if (localBudget && localBudget.min != null) {
    const price = entry.localPrice == null ? NaN : Number.parseFloat(entry.localPrice);
    if (!Number.isFinite(price) || price < localBudget.min) return false;
  } else {
    const budget = requirements.budget_usd;
    if (budget?.min != null) {
      const price = entry.msrpUsd == null ? NaN : Number.parseFloat(entry.msrpUsd);
      if (!Number.isFinite(price) || price < budget.min) return false;
    }
  }

  return true;
}

export function resolveAspectWeights(
  requirements: UserRequirements,
  defaultWeights: ReadonlyMap<AspectName, number>,
): Map<AspectName, number> {
  const maxBudget = requirements.budget_usd?.max ?? requirements.budget_local?.max ?? 0;
  const isFlagshipBudget = maxBudget >= 800;
  const userRequestedValue =
    requirements.priorities.some((p) => p.aspect === 'value') ||
    requirements.use_cases.some((u) => /\b(?:value|budget|cheap|affordable|deal)\b/i.test(u));

  const raw = new Map<AspectName, number>();
  for (const name of ASPECT_NAMES) {
    const p = requirements.priorities.find((x) => x.aspect === name);
    let defaultWeight = defaultWeights.get(name) ?? 1 / ASPECT_NAMES.length;

    // In flagship budgets (>= $800), default unstated value weight to 0
    // so budget phones with inflated "value" scores don't outscore true flagships
    if (name === 'value' && isFlagshipBudget && !userRequestedValue && p == null) {
      defaultWeight = 0;
    }

    raw.set(name, p?.weight ?? defaultWeight);
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

/**
 * Normalizes phone model lineage to prevent redundant generation duplicates
 * (e.g. recommending both Galaxy S26 Ultra and Galaxy S25 Ultra in the same top picks).
 */
export function getPhoneLineage(brand: string, model: string): string {
  const b = brand.toLowerCase().trim();
  let m = model.toLowerCase().trim();

  // Normalize plus / pro / max / ultra / fe / fold / flip
  m = m.replace(/\+/g, ' plus ');

  // Brand-specific standardizations
  if (b === 'samsung') {
    // e.g. "Galaxy S26 Ultra" -> "galaxy s ultra", "Galaxy S25+" -> "galaxy s plus", "Galaxy S25" -> "galaxy s base"
    m = m.replace(/\bgalaxy\s+s\d{1,2}\s*(ultra|plus|\+)?\b/i, (_, suffix) => {
      return `galaxy s ${suffix ? suffix.trim() : 'base'}`;
    });
    // e.g. "Galaxy Z Fold 7" -> "galaxy z fold"
    m = m.replace(/\bgalaxy\s+z\s+fold\s*\d{0,2}\b/i, 'galaxy z fold');
    m = m.replace(/\bgalaxy\s+z\s+flip\s*\d{0,2}\b/i, 'galaxy z flip');
    // e.g. "Galaxy A56" -> "galaxy a5x"
    m = m.replace(/\bgalaxy\s+a(\d)\d\b/i, 'galaxy a$1x');
  } else if (b === 'apple') {
    // e.g. "iPhone 18 Pro Max" -> "iphone pro max", "iPhone 18 Pro" -> "iphone pro", "iPhone 18" -> "iphone base"
    m = m.replace(/\biphone\s*\d{1,2}\s*(pro\s*max|pro|plus|air|mini)?\b/i, (_, suffix) => {
      return `iphone ${suffix ? suffix.trim() : 'base'}`;
    });
    m = m.replace(/\biphone\s*se\b.*/i, 'iphone se');
  } else if (b === 'google') {
    // e.g. "Pixel 10 Pro XL" -> "pixel pro xl", "Pixel 9a" -> "pixel a", "Pixel 10" -> "pixel base"
    m = m.replace(/\bpixel\s*\d{1,2}\s*(pro\s*xl|pro\s*fold|pro|fold|a)?\b/i, (_, suffix) => {
      return `pixel ${suffix ? suffix.trim() : 'base'}`;
    });
  } else if (b === 'oneplus') {
    // e.g. "OnePlus 13" -> "oneplus flagship", "OnePlus 13R" -> "oneplus r", "OnePlus Open 2" -> "oneplus open"
    m = m.replace(/\b(?:oneplus\s*)?\d{1,2}(r|t)?\b/i, (_, suffix) => {
      return suffix ? `oneplus ${suffix.toLowerCase()}` : 'oneplus flagship';
    });
    m = m.replace(/\b(?:oneplus\s*)?open\s*\d{0,2}\b/i, 'oneplus open');
    m = m.replace(/\b(?:oneplus\s*)?nord\s*\w*\b/i, 'oneplus nord');
  } else if (b === 'xiaomi') {
    // e.g. "Xiaomi 15 Ultra" -> "xiaomi ultra", "Xiaomi 15 Pro" -> "xiaomi pro", "Xiaomi 15" -> "xiaomi base"
    m = m.replace(/\b(?:xiaomi\s*)?\d{1,2}\s*(ultra|pro|lite)?\b/i, (_, suffix) => {
      return `xiaomi ${suffix ? suffix.trim() : 'base'}`;
    });
  } else {
    // Generic fallback: strip generational digits
    m = m.replace(/\b\d{1,2}\b/g, '');
  }

  m = m.replace(/\s+/g, ' ').trim();
  return `${b}:${m}`;
}

export function pickDiverseTop(
  ranked: readonly ScoredCandidate[],
  limit: number,
  maxPerBrand: number,
  maxPerLineage: number = 1,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const brandCounts = new Map<string, number>();
  const lineageCounts = new Map<string, number>();
  const picked = new Set<string>();

  // Pass 1: enforce both maxPerBrand and maxPerLineage (at most 1 device per phone lineage)
  for (const c of ranked) {
    const brandKey = c.brand.toLowerCase();
    const lineageKey = getPhoneLineage(c.brand, c.model);
    const bCount = brandCounts.get(brandKey) ?? 0;
    const lCount = lineageCounts.get(lineageKey) ?? 0;

    if (bCount >= maxPerBrand || lCount >= maxPerLineage) continue;

    brandCounts.set(brandKey, bCount + 1);
    lineageCounts.set(lineageKey, lCount + 1);
    out.push(c);
    picked.add(c.slug);
    if (out.length >= limit) return out;
  }

  // Pass 2: if limit not reached, allow different lineages of same brand up to maxPerBrand
  if (out.length < limit) {
    for (const c of ranked) {
      if (picked.has(c.slug)) continue;
      const brandKey = c.brand.toLowerCase();
      const lineageKey = getPhoneLineage(c.brand, c.model);
      const bCount = brandCounts.get(brandKey) ?? 0;
      const lCount = lineageCounts.get(lineageKey) ?? 0;

      if (lCount >= maxPerLineage) continue;

      brandCounts.set(brandKey, bCount + 1);
      lineageCounts.set(lineageKey, lCount + 1);
      out.push(c);
      picked.add(c.slug);
      if (out.length >= limit) return out;
    }
  }

  // Pass 3: absolute fallback if catalog is too small to fulfill limit
  if (out.length < limit) {
    for (const c of ranked) {
      if (picked.has(c.slug)) continue;
      out.push(c);
      picked.add(c.slug);
      if (out.length >= limit) break;
    }
  }

  return out;
}

interface ScoringContext {
  readonly requirements: UserRequirements;
  readonly weights: ReadonlyMap<AspectName, number>;
  readonly queryEmbedding: readonly number[] | undefined;
  readonly now?: Date;
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

  // Recency prioritization: phones released within the last 2 years receive priority,
  // while older phones (between 2 and 3.5 years) receive a progressive age penalty
  // so contemporary releases from the past 2 years are strongly favored.
  if (entry.launchDate) {
    const now = ctx.now ?? new Date();
    const ageDays = (now.getTime() - entry.launchDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays <= PREFERRED_RECOMMEND_PHONE_AGE_DAYS) {
      score += 0.35 * Math.max(0, 1 - ageDays / PREFERRED_RECOMMEND_PHONE_AGE_DAYS);
    } else if (ageDays > PREFERRED_RECOMMEND_PHONE_AGE_DAYS) {
      const excessDays = ageDays - PREFERRED_RECOMMEND_PHONE_AGE_DAYS;
      const penaltyRange = MAX_RECOMMEND_PHONE_AGE_DAYS - PREFERRED_RECOMMEND_PHONE_AGE_DAYS;
      const penalty = Math.min(0.5, (excessDays / penaltyRange) * 0.5);
      score -= penalty;
    }
  }

  // Budget segment alignment: when shopping for flagship devices (budget >= $800)
  // and the user did not ask for a budget/value phone, apply an alignment adjustment
  // for phones priced under 50% of the flagship budget ceiling so that mid-range/budget
  // phones don't crowd out flagship devices.
  const maxBudget = ctx.requirements.budget_usd?.max ?? ctx.requirements.budget_local?.max ?? 0;
  const userRequestedValue =
    ctx.requirements.priorities.some((p) => p.aspect === 'value') ||
    ctx.requirements.use_cases.some((u) => /\b(?:value|budget|cheap|affordable|deal)\b/i.test(u));

  if (maxBudget >= 800 && !userRequestedValue) {
    const price = Number.parseFloat(entry.msrpUsd ?? '0');
    const threshold = 0.5 * maxBudget;
    if (price > 0 && price < threshold) {
      const discountRatio = 1 - price / threshold;
      score -= 0.35 * discountRatio;
    }
  }

  return {
    phoneId: entry.phoneId,
    slug: entry.slug,
    brand: entry.brand,
    model: entry.model,
    tagline: entry.tagline,
    msrpUsd: entry.msrpUsd,
    localPrice: entry.localPrice,
    localCurrency: entry.localCurrency,
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
  const filterOpts = opts.now ? opts : { ...opts, now: ctx.now };
  for (const entry of catalog) {
    if (!passesHardFilters(entry, ctx.requirements, filterOpts)) continue;
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
  options?: {
    readonly queryEmbedding?: readonly number[];
    readonly refined?: boolean;
    readonly now?: Date;
  },
): RankResult {
  const queryEmbedding = options?.queryEmbedding;
  const refined = options?.refined === true;
  const now = options?.now;
  const weights = resolveAspectWeights(requirements, defaultWeights);
  const relaxed: string[] = [];

  const corpusScorecardMissing = catalog.every((c) => !hasRealAspectData(c));

  const ctx: ScoringContext = {
    requirements,
    weights,
    queryEmbedding,
    now,
    summary: {
      weights,
      refined,
      corpusScorecardMissing,
    },
  };

  const ranked = collectScored(catalog, ctx, {
    relaxBudgetMax: false,
    ignoreFoldable: false,
  });

  // An empty result is preferable to silently violating budget, platform or form factor.

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
