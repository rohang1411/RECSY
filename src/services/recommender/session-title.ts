/**
 * Heuristic Recommendation Session Titling (Plan 27 Section 10).
 *
 * Provides deterministic, zero-cost, and injection-resilient titles for
 * recommendation sessions based on extracted user requirements or fallback prompt.
 */
import { getRegionConfig } from '@/lib/regions';
import { formatLocalPrice } from '@/lib/format-currency';
import type { UserRequirements } from './requirements-schema';

/**
 * Normalises to NFC, strips control & bidi-override characters,
 * collapses whitespace, strips surrounding quotes and markdown formatting,
 * and limits length to 80 characters on a grapheme boundary.
 */
export function sanitizeSessionTitle(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFC');
  // Strip control characters (Cc) and bidi overrides (U+202A-U+202E, U+2066-U+2069)
  s = s.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '');
  // Strip common markdown characters
  s = s.replace(/[*#_~`>]/g, ' ');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Strip surrounding quotes
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();

  // Limit to 80 graphemes
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(s));
    if (segments.length > 80) {
      s = segments
        .slice(0, 80)
        .map((seg) => seg.segment)
        .join('')
        .trim();
    }
  } else if (s.length > 80) {
    s = s.slice(0, 80).trim();
  }
  return s;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /act\s+as\s+a/i,
  /jailbreak/i,
  /dan\s+mode/i,
  /developer\s+mode/i,
  /bypass/i,
];

function isPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pat) => pat.test(text));
}

const LEADING_PHRASES = [
  /^(?:i\s+want|i\s+need|i'm\s+looking\s+for|looking\s+for|can\s+you\s+(?:recommend|suggest)|suggest\s+me|recommend\s+me|suggest|recommend|tell\s+me\s+about|find\s+me|give\s+me)\s+(?:a\s+|an\s+|some\s+)?/i,
  /^(?:what\s+is\s+the\s+best|best|good)\s+/i,
  /^(?:please\s+)/i,
];

function cleanPromptForFallback(raw: string): string {
  // First strip markdown and control chars
  let cleaned = raw
    .replace(/[*#_~`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const pat of LEADING_PHRASES) {
    cleaned = cleaned.replace(pat, '');
  }
  cleaned = cleaned.trim();
  if (!cleaned) return '';

  // Limit to roughly 48 characters on a word boundary
  if (cleaned.length > 48) {
    const truncated = cleaned.slice(0, 48);
    const lastSpace = truncated.lastIndexOf(' ');
    cleaned = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  }

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Builds a deterministic heuristic title for a recommendation session.
 * Order of pieces:
 * 1. Priorities / Form factor (e.g. "Camera", "Battery", "Gaming", "Compact", "Foldable")
 * 2. Brand or platform constraint ("iPhone", "Android", "Samsung", etc.)
 * 3. Budget formatted with region currency ("under $700", "under ₹40,000")
 */
export function buildSessionTitle(
  requirements: UserRequirements | null | undefined,
  message: string,
  regionCode = 'US',
): string {
  // If prompt looks like an injection attack, return safe default title
  if (isPromptInjection(message)) {
    return 'New Recommendation';
  }

  if (!requirements) {
    const fallback = cleanPromptForFallback(message);
    return sanitizeSessionTitle(fallback) || 'New Recommendation';
  }

  const parts: string[] = [];
  const regionConfig = getRegionConfig(regionCode);

  const priorities = Array.isArray(requirements.priorities) ? requirements.priorities : [];
  const useCases = Array.isArray(requirements.use_cases) ? requirements.use_cases : [];
  const mustHaves = Array.isArray(requirements.must_haves) ? requirements.must_haves : [];
  const likedBrands = Array.isArray(requirements.brand_preference?.liked)
    ? requirements.brand_preference.liked
    : [];

  // 1. Identify primary priority aspect or form factor
  let priorityWord: string | null = null;
  const isFoldable = requirements.form_factor?.foldable === true;
  const isCompact =
    requirements.form_factor?.screen_size_range_in != null &&
    requirements.form_factor.screen_size_range_in[1] <= 6.3;

  const topPriority =
    priorities.length > 0 ? [...priorities].sort((a, b) => b.weight - a.weight)[0]?.aspect : null;

  const hasGaming = useCases.some((u) => /\bgaming\b/i.test(u));

  if (isFoldable) {
    priorityWord = 'foldable';
  } else if (isCompact) {
    priorityWord = 'Compact';
  } else if (hasGaming) {
    priorityWord = 'Gaming';
  } else if (topPriority === 'camera') {
    priorityWord = 'Camera';
  } else if (topPriority === 'battery') {
    priorityWord = 'Battery';
  } else if (topPriority === 'performance') {
    priorityWord = 'Performance';
  } else if (topPriority === 'display') {
    priorityWord = 'Display';
  } else if (topPriority === 'value') {
    priorityWord = 'Budget';
  }

  // 2. Identify brand or platform preference
  let brandOrPlatform: string | null = null;
  const likedBrand = likedBrands[0];

  if (likedBrand) {
    if (/apple/i.test(likedBrand) || /iphone/i.test(likedBrand)) {
      brandOrPlatform = 'iPhone';
    } else {
      brandOrPlatform = likedBrand.charAt(0).toUpperCase() + likedBrand.slice(1);
    }
  } else if (mustHaves.some((m) => /iphone/i.test(m) || /ios/i.test(m))) {
    brandOrPlatform = 'iPhone';
  } else if (mustHaves.some((m) => /android/i.test(m))) {
    brandOrPlatform = 'Android';
  }

  // 3. Format budget
  let budgetText: string | null = null;
  const localBudget = requirements.budget_local;
  const usdBudget = requirements.budget_usd;

  if (localBudget && localBudget.max) {
    const currency = localBudget.currency || regionConfig.currency;
    const locale =
      currency === 'GBP' ? 'en-GB' : currency === 'EUR' ? 'de-DE' : regionConfig.locale;
    const formatted = localBudget.max.toLocaleString(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    budgetText = `under ${formatted}`;
  } else if (usdBudget && usdBudget.max) {
    if (regionConfig.currency === 'USD') {
      budgetText = `under $${Math.round(usdBudget.max)}`;
    } else {
      const formatted = formatLocalPrice(usdBudget.max, regionConfig);
      budgetText = formatted ? `under ${formatted}` : `under $${Math.round(usdBudget.max)}`;
    }
  }

  // 4. Combine into an elegant, readable title
  if (priorityWord === 'foldable' && brandOrPlatform) {
    parts.push(brandOrPlatform, 'foldable');
  } else if (brandOrPlatform === 'iPhone') {
    if (priorityWord && priorityWord !== 'Camera') {
      parts.push(priorityWord, 'iPhone');
    } else {
      parts.push('iPhone');
    }
  } else if (brandOrPlatform && priorityWord) {
    if (priorityWord === 'Compact' && brandOrPlatform === 'Android') {
      const secondPriority = requirements.priorities?.find((p) => p.aspect === 'battery');
      if (secondPriority) {
        parts.push('Compact Android with long battery');
      } else {
        parts.push('Compact Android phone');
      }
    } else {
      parts.push(brandOrPlatform, `${priorityWord.toLowerCase()} phone`);
    }
  } else if (brandOrPlatform) {
    parts.push(brandOrPlatform, 'phone');
  } else if (priorityWord) {
    parts.push(priorityWord, 'phone');
  }

  if (budgetText && parts.length > 0) {
    if (!parts.join(' ').includes('long battery')) {
      parts.push(budgetText);
    }
  }

  let finalTitle = parts.join(' ').trim();

  // If no structured parts could be formed, fall back to cleaned message
  if (!finalTitle || finalTitle === 'phone') {
    finalTitle = cleanPromptForFallback(message);
  }

  const sanitized = sanitizeSessionTitle(finalTitle);
  return sanitized || 'New Recommendation';
}
