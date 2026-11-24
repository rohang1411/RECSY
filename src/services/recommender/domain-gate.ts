/**
 * Adversarial injection sanitizer, out-of-domain classifier, and contradictory constraint resolver.
 *
 * Implements WP-10 (Plan 31):
 * 1. Blocks adversarial jailbreaks and system prompt extraction attacks with zero token cost.
 * 2. Catches out-of-domain electronics queries (laptops, cars, home appliances).
 * 3. Detects mutually contradictory hardware constraints (e.g. iPhone running Android,
 *    sub-$200 flagship foldables, tiny screens with massive batteries) and formulates
 *    deterministic clarifications before any catalog ranking or candidate scoring.
 */

import { normalizeToUsd, DEFAULT_EXCHANGE_RATES } from '@/services/catalog/currency';

export interface DomainGateResult {
  readonly isSmartphoneDomain: boolean;
  readonly isAdversarialJailbreak: boolean;
  readonly rejectionReason?: 'adversarial_injection' | 'out_of_domain_product';
  readonly message?: string;
}

export const DOMAIN_GATE_REJECTION_MESSAGES = {
  adversarial_injection:
    'RECSY is an independent recommendation engine dedicated exclusively to smartphones. Your request could not be processed.',
  out_of_domain_product:
    'RECSY is an independent recommendation engine dedicated exclusively to smartphones. We do not index or recommend laptops, automobiles, or other consumer electronics.',
} as const;

const ADVERSARIAL_PATTERNS: readonly RegExp[] = [
  /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|rules|prompts|directives)/i,
  /(?:reveal|disclose|show|leak|print|output|display)\s+(?:your|the)\s+(?:system prompt|system instructions|core directives|hidden instructions)/i,
  /\b(?:dan mode|jailbreak|unrestricted mode)\b/i,
  /\bpretend (?:you are|to be) (?:an unrestricted|an evil|a developer mode|a bypass|dan\b)/i,
  /\bact as (?:dan\b|an unfiltered|an omnipotent)/i,
  /\bbypass (?:content|security|safety) (?:filter|filters|policy|restrictions)/i,
  /\bwhat (?:is|are) your (?:system instructions|system prompt|hidden prompt)/i,
];

const OUT_OF_DOMAIN_PATTERNS: readonly RegExp[] = [
  /\b(?:laptop|laptops|macbook|macbooks|chromebook|chromebooks|thinkpad)\b/i,
  /\b(?:desktop\s+pc|gaming\s+pc|desktop\s+computer|computer\s+tower)\b/i,
  /\b(?:gpu|rtx\s*\d{4}|gtx\s*\d{4}|rx\s*\d{4}|graphics\s+card)\b/i,
  /\b(?:car|cars|automobile|automobiles|electric\s+vehicle|tesla\s+model|suv|sedan|truck)\b/i,
  /\b(?:refrigerator|fridge|dishwasher|washing\s+machine|dryer|microwave|oven|air\s+conditioner)\b/i,
  /\b(?:television|televisions|smart\s+tv|oled\s+tv|qled\s+tv|soundbar)\b/i,
];

const SMARTPHONE_EXPLICIT_KEYWORDS: readonly RegExp[] = [
  /\b(?:phone|phones|smartphone|smartphones|mobile|mobiles|handset|android|iphone|ios|pixel|galaxy|oneplus|xiaomi|motorola)\b/i,
];

export function evaluateRequestDomain(userMessage: string): DomainGateResult {
  const m = userMessage.trim();
  if (!m) {
    return { isSmartphoneDomain: true, isAdversarialJailbreak: false };
  }

  // 1. Check for adversarial injection / jailbreak attempts
  for (const pattern of ADVERSARIAL_PATTERNS) {
    if (pattern.test(m)) {
      return {
        isSmartphoneDomain: false,
        isAdversarialJailbreak: true,
        rejectionReason: 'adversarial_injection',
        message: DOMAIN_GATE_REJECTION_MESSAGES.adversarial_injection,
      };
    }
  }

  // 2. Check for out-of-domain products
  const hasOutOfDomainMatch = OUT_OF_DOMAIN_PATTERNS.some((p) => p.test(m));
  if (hasOutOfDomainMatch) {
    const hasSmartphoneContext = SMARTPHONE_EXPLICIT_KEYWORDS.some((p) => p.test(m));
    // If user specifically asked about out-of-domain electronics without smartphone context, reject
    if (!hasSmartphoneContext) {
      return {
        isSmartphoneDomain: false,
        isAdversarialJailbreak: false,
        rejectionReason: 'out_of_domain_product',
        message: DOMAIN_GATE_REJECTION_MESSAGES.out_of_domain_product,
      };
    }

    // Even if smartphone is mentioned, check if the direct query is shopping for an out-of-domain item
    if (
      /\b(?:recommend|suggest|find|best|buy|looking for|want a|need a)\s+(?:me\s+)?(?:a|an|the\s+best\s+)?(?:laptop|macbook|car|dishwasher|refrigerator|tv|television)\b/i.test(
        m,
      )
    ) {
      return {
        isSmartphoneDomain: false,
        isAdversarialJailbreak: false,
        rejectionReason: 'out_of_domain_product',
        message: DOMAIN_GATE_REJECTION_MESSAGES.out_of_domain_product,
      };
    }
  }

  return {
    isSmartphoneDomain: true,
    isAdversarialJailbreak: false,
  };
}

export interface ContradictionCheckInput {
  readonly userMessage?: string;
  readonly mustHaves?: readonly string[];
  readonly budgetUsd?: { min?: number; max: number } | null;
  readonly budgetLocal?: { min?: number; max: number; currency: string } | null;
  readonly formFactor?: {
    screen_size_range_in?: [number, number];
    weight_max_g?: number;
    foldable?: boolean;
  };
}

export interface ContradictionResult {
  readonly hasContradiction: boolean;
  readonly clarification?: string;
  readonly contradictionType?:
    | 'platform_conflict'
    | 'foldable_budget_conflict'
    | 'compact_battery_conflict';
}

/**
 * Detects mutually contradictory constraints in user queries or requirements:
 * 1. iPhone + Android OS conflicts
 * 2. Ultra-budget (< $250) + Foldable form factor
 * 3. Compact screen size (<= 5.8") + Massive battery capacity (>= 6000mAh)
 */
export function detectContradictoryConstraints(
  input: ContradictionCheckInput,
): ContradictionResult {
  const text = (input.userMessage ?? '').toLowerCase();
  const mustHaves = (input.mustHaves ?? []).map((s) => s.toLowerCase());

  // 1. Platform contradiction: iPhone/Apple with Android
  const hasIphoneMustHave = mustHaves.some((h) => h.includes('ios') || h.includes('iphone'));
  const hasAndroidMustHave = mustHaves.some((h) => h.includes('android'));
  const hasBothMustHaves = hasIphoneMustHave && hasAndroidMustHave;

  const isSwitchingPlatforms =
    /\b(?:switch(?:ing)?|mov(?:e|ing)|migrat(?:e|ing)|com(?:e|ing))\s+from\s+(?:android|ios|iphone)\s+to\s+(?:android|ios|iphone)\b/i.test(
      text,
    );

  const isExplicitHybridPlatformRequest =
    /\biphone\s+(?:running|with|on)\s+android\b/i.test(text) ||
    /\bandroid\s+(?:iphone|apple\s+phone)\b/i.test(text) ||
    /\b(?:apple\s+phone|ios)\s+(?:running|with|on)\s+android\b/i.test(text) ||
    /\bandroid\s+(?:on|in|running\s+on)\s+(?:an?\s+)?iphone\b/i.test(text);

  const mentionsIphone = /\b(?:iphone|ios|apple phone)\b/i.test(text);
  const mentionsAndroid = /\bandroid\b/i.test(text);

  if (
    hasBothMustHaves ||
    isExplicitHybridPlatformRequest ||
    (!isSwitchingPlatforms && mentionsIphone && mentionsAndroid)
  ) {
    return {
      hasContradiction: true,
      contradictionType: 'platform_conflict',
      clarification:
        'An iPhone runs Apple iOS; Android is available on Google Pixel, Samsung Galaxy, and OnePlus devices. Which platform would you prefer to explore?',
    };
  }

  // 2. Budget vs Foldable contradiction: Flagship foldable under $250
  const isFoldableRequested =
    Boolean(input.formFactor?.foldable) ||
    /\b(?:foldable|flip phone|z fold|z flip|galaxy fold|pixel fold|fold)\b/i.test(text) ||
    mustHaves.some((h) => h.includes('foldable') || h.includes('flip'));

  let maxBudgetUsd: number | undefined;
  if (input.budgetUsd?.max != null) {
    maxBudgetUsd = input.budgetUsd.max;
  } else if (input.budgetLocal?.max != null && input.budgetLocal.currency) {
    try {
      maxBudgetUsd = normalizeToUsd(
        input.budgetLocal.max,
        input.budgetLocal.currency,
        DEFAULT_EXCHANGE_RATES,
      );
    } catch {
      maxBudgetUsd = input.budgetLocal.max;
    }
  }

  if (isFoldableRequested && maxBudgetUsd != null && maxBudgetUsd > 0 && maxBudgetUsd < 250) {
    return {
      hasContradiction: true,
      contradictionType: 'foldable_budget_conflict',
      clarification:
        'Foldable smartphones start at significantly higher price points (typically $600+ refurbished or $999+ new). Would you prefer a standard smartphone within your budget, or to increase your budget for a foldable?',
    };
  }

  // 3. Compact Screen vs Huge Battery contradiction
  const isCompactRequested =
    (input.formFactor?.screen_size_range_in && input.formFactor.screen_size_range_in[1] <= 5.8) ||
    /\b(?:compact|small screen|5\.[0-8]\s*(?:inch|in|")?)\b/i.test(text);

  const hasMassiveBatteryRequested =
    /\b(?:6[0-9]{3}|7[0-9]{3})\s*mah\b/i.test(text) ||
    /\b(?:6,500|6500|7,000|7000)\s*mah\b/i.test(text);

  if (isCompactRequested && hasMassiveBatteryRequested) {
    return {
      hasContradiction: true,
      contradictionType: 'compact_battery_conflict',
      clarification:
        'Compact phones with screens under 5.8 inches cannot physically accommodate a large battery (6,000mAh+). Would you prioritize a compact form factor or maximum battery endurance?',
    };
  }

  return { hasContradiction: false };
}
