/**
 * Deterministic requirement extraction and merge guard for the recommender.
 *
 * The LLM is good at translating open-ended text into structured preferences,
 * but it must not be the only component responsible for remembering concrete
 * facts across turns. This module extracts high-confidence facts with simple
 * rules and merges them with prior state after the LLM call.
 */
import type { AspectName } from '@/lib/constants';

import type { UserRequirements } from './requirements-schema';

type PlatformPreference = 'android' | 'ios';
type PlatformFact = PlatformPreference | 'any';

interface MessageFacts {
  readonly reset: boolean;
  readonly budgetUsd: UserRequirements['budget_usd'] | null;
  readonly platform: PlatformFact | null;
  readonly priorities: readonly { aspect: AspectName; weight: number }[];
  readonly mustHaves: readonly string[];
  readonly dealBreakers: readonly string[];
  readonly useCases: readonly string[];
  readonly brandPreference: {
    readonly liked: readonly string[];
    readonly disliked: readonly string[];
  };
  readonly formFactor: UserRequirements['form_factor'] | undefined;
}

const RESET_PATTERNS: readonly RegExp[] = [
  /\bstart (?:over|fresh|again)\b/i,
  /\bforget (?:that|those|these|everything|my previous|the previous)\b/i,
  /\bnew (?:search|query|recommendation|recommendations)\b/i,
];

const PLATFORM_ANY_RE =
  /\b(?:no preference|any|either|both|don't care|do not care)\b.{0,40}\b(?:android|iphone|ios)\b|\b(?:android|iphone|ios)\b.{0,40}\b(?:either|both|no preference|don't care|do not care)\b/i;
const ANDROID_RE = /\bandroid\b/i;
const IOS_RE = /\b(?:iphone|ios)\b/i;
const NOT_ANDROID_RE =
  /\b(?:not|no|avoid|exclude|without|don't want|do not want)\s+(?:an?\s+)?android\b/i;
const NOT_IOS_RE =
  /\b(?:not|no|avoid|exclude|without|don't want|do not want)\s+(?:an?\s+)?(?:iphone|ios)\b/i;

const BRAND_ALIASES: readonly { brand: string; aliases: readonly string[] }[] = [
  { brand: 'Apple', aliases: ['apple', 'iphone'] },
  { brand: 'Samsung', aliases: ['samsung', 'galaxy'] },
  { brand: 'Google', aliases: ['google', 'pixel'] },
  { brand: 'OnePlus', aliases: ['oneplus', 'one plus'] },
  { brand: 'Xiaomi', aliases: ['xiaomi', 'redmi'] },
  { brand: 'Nothing', aliases: ['nothing'] },
  { brand: 'Motorola', aliases: ['motorola', 'moto'] },
];

const ASPECT_KEYWORDS: readonly {
  readonly aspect: AspectName;
  readonly weight: number;
  readonly useCase: string;
  readonly patterns: readonly RegExp[];
}[] = [
  {
    aspect: 'camera',
    weight: 1.2,
    useCase: 'camera',
    patterns: [
      /\bcamera(?:s)?\b/i,
      /\bphoto(?:s|graphy)?\b/i,
      /\bvideo\b/i,
      /\bzoom\b/i,
      /\bportrait\b/i,
      /\bnight (?:mode|photos?|photography)\b/i,
      /\bselfie(?:s)?\b/i,
    ],
  },
  {
    aspect: 'battery',
    weight: 1,
    useCase: 'battery life',
    patterns: [/\bbattery\b/i, /\ball[- ]day\b/i, /\blast(?:s|ing)? long\b/i, /\bcharging\b/i],
  },
  {
    aspect: 'performance',
    weight: 1,
    useCase: 'performance',
    patterns: [
      /\bperformance\b/i,
      /\bgaming\b/i,
      /\bgames?\b/i,
      /\bfast\b/i,
      /\bspeed\b/i,
      /\bprocessor\b/i,
      /\bchip(?:set)?\b/i,
    ],
  },
  {
    aspect: 'display',
    weight: 0.9,
    useCase: 'display',
    patterns: [/\bdisplay\b/i, /\bscreen\b/i, /\bbrightness\b/i, /\boled\b/i, /\brefresh rate\b/i],
  },
  {
    aspect: 'build',
    weight: 0.85,
    useCase: 'build quality',
    patterns: [
      /\bbuild\b/i,
      /\bdurable\b/i,
      /\bdurability\b/i,
      /\bpremium\b/i,
      /\blight(?:weight)?\b/i,
      /\bnot too heavy\b/i,
      /\bone[- ]handed\b/i,
      /\bcompact\b/i,
    ],
  },
  {
    aspect: 'software',
    weight: 0.85,
    useCase: 'software',
    patterns: [/\bsoftware\b/i, /\bupdates?\b/i, /\blong support\b/i, /\bclean android\b/i],
  },
  {
    aspect: 'value',
    weight: 0.8,
    useCase: 'value',
    patterns: [/\bvalue\b/i, /\bcheap\b/i, /\baffordable\b/i, /\bbudget\b/i, /\bdeal\b/i],
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueStrings(items: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = item.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function parseAmount(raw: string): number | null {
  const n = Number.parseInt(raw.replace(/[,$\s]/g, ''), 10);
  return Number.isFinite(n) && n >= 50 && n <= 5_000 ? n : null;
}

function firstAmountFrom(patterns: readonly RegExp[], message: string): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const raw = match?.[1];
    if (!raw) continue;
    const amount = parseAmount(raw);
    if (amount != null) return amount;
  }
  return null;
}

function extractBudget(message: string): UserRequirements['budget_usd'] | null {
  const rangePatterns = [
    /\bbetween\s+\$?\s*([\d,]{2,6})\s+(?:and|to|-)\s+\$?\s*([\d,]{2,6})\b/i,
    /\bfrom\s+\$?\s*([\d,]{2,6})\s+(?:to|-)\s+\$?\s*([\d,]{2,6})\b/i,
    /\$\s*([\d,]{2,6})\s*-\s*\$?\s*([\d,]{2,6})\b/i,
  ];
  for (const pattern of rangePatterns) {
    const match = pattern.exec(message);
    const a = match?.[1] ? parseAmount(match[1]) : null;
    const b = match?.[2] ? parseAmount(match[2]) : null;
    if (a != null && b != null) return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  const max = firstAmountFrom(
    [
      /\b(?:under|below|less than|cheaper than|max(?:imum)?|up to|no more than|within)\s+\$?\s*([\d,]{2,6})\b/i,
      /\b(?:budget|price range)\s*(?:is|of|around|about|:)?\s*\$?\s*([\d,]{2,6})\b/i,
      /\b(?:around|about)\s+\$?\s*([\d,]{2,6})\b/i,
      /\$\s*([\d,]{2,6})\b/i,
      /\b([\d,]{2,6})\s*(?:usd|dollars?)\b/i,
    ],
    message,
  );

  return max != null ? { max } : null;
}

function shouldResetRequirements(message: string): boolean {
  return RESET_PATTERNS.some((pattern) => pattern.test(message));
}

function extractPlatform(message: string): PlatformFact | null {
  if (PLATFORM_ANY_RE.test(message)) return 'any';

  const rejectsAndroid = NOT_ANDROID_RE.test(message);
  const rejectsIos = NOT_IOS_RE.test(message);
  const mentionsAndroid = ANDROID_RE.test(message);
  const mentionsIos = IOS_RE.test(message);
  const wantsAndroid = (mentionsAndroid && !rejectsAndroid) || rejectsIos;
  const wantsIos = (mentionsIos && !rejectsIos) || rejectsAndroid;
  if (wantsAndroid === wantsIos) return null;
  return wantsAndroid ? 'android' : 'ios';
}

export function isPlatformRequirement(value: string): boolean {
  const s = value.trim().toLowerCase();
  return s === 'android' || s === 'iphone' || s === 'ios';
}

export function detectPlatformPreferenceFromRequirements(
  requirements: UserRequirements,
): PlatformPreference | null {
  const text = [...requirements.must_haves, ...requirements.use_cases].join(' ');
  const fact = extractPlatform(text);
  return fact === 'android' || fact === 'ios' ? fact : null;
}

function platformLabel(platform: PlatformPreference): string {
  return platform === 'android' ? 'Android' : 'iPhone';
}

function extractPriorities(message: string): MessageFacts['priorities'] {
  const out: { aspect: AspectName; weight: number }[] = [];
  for (const item of ASPECT_KEYWORDS) {
    if (item.patterns.some((pattern) => pattern.test(message))) {
      out.push({ aspect: item.aspect, weight: item.weight });
    }
  }
  return out;
}

function extractUseCases(message: string, priorities: readonly { aspect: AspectName }[]): string[] {
  const cases = new Set<string>();
  for (const p of priorities) {
    const item = ASPECT_KEYWORDS.find((x) => x.aspect === p.aspect);
    if (item) cases.add(item.useCase);
  }
  if (/\btravel\b/i.test(message) && /\b(?:photo|camera|video)\b/i.test(message)) {
    cases.add('travel photos');
  }
  return [...cases];
}

function extractMustHaves(message: string, platform: PlatformFact | null): string[] {
  const out: string[] = [];
  if (platform === 'android' || platform === 'ios') out.push(platformLabel(platform));
  if (/\bwireless charging\b/i.test(message)) out.push('wireless charging');
  if (/\b(?:headphone jack|3\.5mm)\b/i.test(message)) out.push('3.5mm jack');
  if (/\bnfc\b/i.test(message)) out.push('NFC');
  if (/\bfast charging\b/i.test(message)) out.push('fast charging');
  return out;
}

function extractBrandPreference(message: string): MessageFacts['brandPreference'] {
  const liked: string[] = [];
  const disliked: string[] = [];

  for (const { brand, aliases } of BRAND_ALIASES) {
    for (const alias of aliases) {
      const escaped = escapeRegExp(alias);
      const dislike = new RegExp(
        `\\b(?:no|not|avoid|exclude|without|rule out|don't want|do not want)\\s+(?:an?\\s+)?${escaped}\\b|\\b${escaped}\\s+(?:is\\s+)?(?:a\\s+)?(?:dealbreaker|deal breaker)\\b`,
        'i',
      );
      const like = new RegExp(
        `\\b(?:prefer|like|want|love)\\s+(?:an?\\s+)?${escaped}\\b|\\b${escaped}\\s+only\\b`,
        'i',
      );
      if (dislike.test(message)) disliked.push(brand);
      if (like.test(message)) liked.push(brand);
    }
  }

  return { liked: uniqueStrings(liked), disliked: uniqueStrings(disliked) };
}

function extractFormFactor(message: string): UserRequirements['form_factor'] | undefined {
  if (/\b(?:no|not|avoid|exclude|without)\s+(?:a\s+)?foldable\b/i.test(message)) {
    return { foldable: false };
  }
  if (/\b(?:foldable|folding phone)\b/i.test(message)) return { foldable: true };
  if (/\b(?:compact|small|one[- ]handed)\b/i.test(message)) {
    return { screen_size_range_in: [0.1, 6.4] };
  }
  if (/\b(?:large|big)\s+screen\b/i.test(message)) {
    return { screen_size_range_in: [6.6, 9] };
  }
  return undefined;
}

function extractMessageFacts(message: string): MessageFacts {
  const reset = shouldResetRequirements(message);
  const budgetUsd = extractBudget(message);
  const platform = extractPlatform(message);
  const priorities = extractPriorities(message);

  return {
    reset,
    budgetUsd,
    platform,
    priorities,
    mustHaves: extractMustHaves(message, platform),
    dealBreakers: [],
    useCases: extractUseCases(message, priorities),
    brandPreference: extractBrandPreference(message),
    formFactor: extractFormFactor(message),
  };
}

function mergePriorities(
  previous: UserRequirements | null,
  extracted: UserRequirements,
  facts: MessageFacts,
): UserRequirements['priorities'] {
  const weights = new Map<AspectName, number>();
  const add = (items: readonly { aspect: AspectName; weight: number }[], multiplier: number) => {
    for (const item of items) {
      const next = Math.max(weights.get(item.aspect) ?? 0, item.weight * multiplier);
      weights.set(item.aspect, next);
    }
  };

  add(previous?.priorities ?? [], 0.75);
  add(extracted.priorities, 1);
  add(facts.priorities, 1.25);

  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 1e-9) return [];

  return [...weights.entries()]
    .map(([aspect, weight]) => ({ aspect, weight: weight / total }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 7);
}

function mergePlatformMustHaves(items: readonly string[], platform: PlatformFact | null): string[] {
  const nonPlatform = items.filter((item) => !isPlatformRequirement(item));
  if (platform === 'android' || platform === 'ios') {
    nonPlatform.push(platformLabel(platform));
  }
  return uniqueStrings(nonPlatform);
}

function mergeBrandPreference(
  previous: UserRequirements | null,
  extracted: UserRequirements,
  facts: MessageFacts,
): UserRequirements['brand_preference'] {
  const liked = uniqueStrings([
    ...(previous?.brand_preference.liked ?? []),
    ...extracted.brand_preference.liked,
    ...facts.brandPreference.liked,
  ]);
  const disliked = uniqueStrings([
    ...(previous?.brand_preference.disliked ?? []),
    ...extracted.brand_preference.disliked,
    ...facts.brandPreference.disliked,
  ]);
  const dislikedSet = new Set(disliked.map((x) => x.toLowerCase()));
  return {
    liked: liked.filter((x) => !dislikedSet.has(x.toLowerCase())),
    disliked,
  };
}

function hasActionableFacts(requirements: UserRequirements): boolean {
  const hasBudget = requirements.budget_usd?.max != null || requirements.budget_usd?.min != null;
  const hasPreference =
    requirements.priorities.length > 0 ||
    requirements.use_cases.length > 0 ||
    requirements.must_haves.length > 0 ||
    requirements.brand_preference.liked.length > 0 ||
    requirements.brand_preference.disliked.length > 0 ||
    requirements.form_factor != null;
  return hasBudget && hasPreference;
}

export function shouldResetRequirementState(message: string): boolean {
  return shouldResetRequirements(message);
}

export function mergeUserRequirements(input: {
  readonly previous: UserRequirements | null;
  readonly extracted: UserRequirements;
  readonly userMessage: string;
}): UserRequirements {
  const facts = extractMessageFacts(input.userMessage);
  const previous = facts.reset ? null : input.previous;

  const extractedPlatform = detectPlatformPreferenceFromRequirements(input.extracted);
  const previousPlatform = previous ? detectPlatformPreferenceFromRequirements(previous) : null;
  const platform = facts.platform ?? extractedPlatform ?? previousPlatform;

  const merged: UserRequirements = {
    ...input.extracted,
    budget_usd: facts.budgetUsd ?? input.extracted.budget_usd ?? previous?.budget_usd ?? null,
    priorities: mergePriorities(previous, input.extracted, facts),
    must_haves: mergePlatformMustHaves(
      [...(previous?.must_haves ?? []), ...input.extracted.must_haves, ...facts.mustHaves],
      platform === 'any' ? null : platform,
    ),
    deal_breakers: uniqueStrings([
      ...(previous?.deal_breakers ?? []),
      ...input.extracted.deal_breakers,
      ...facts.dealBreakers,
    ]),
    use_cases: uniqueStrings([
      ...(previous?.use_cases ?? []),
      ...input.extracted.use_cases,
      ...facts.useCases,
    ]),
    brand_preference: mergeBrandPreference(previous, input.extracted, facts),
    form_factor: facts.formFactor ?? input.extracted.form_factor ?? previous?.form_factor,
    confidence: Math.max(input.extracted.confidence, previous?.confidence ?? 0),
  };

  return {
    ...merged,
    clarifying_question: hasActionableFacts(merged) ? undefined : merged.clarifying_question,
  };
}
