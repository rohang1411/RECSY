/**
 * Hardware feature classification and verification matrix (Plan 31 WP-02).
 *
 * Replaces the brittle 3-feature hardcode with a spec-driven verification
 * engine that evaluates candidate phones against verified JSONB specifications,
 * eliminating the clarification trap (V-03).
 */

import type { PhoneCatalogEntry } from './catalog';
import type { UserRequirements } from './requirements-schema';

export type RecognizedHardFeature =
  | 'platform'
  | 'nfc'
  | 'wireless_charging'
  | 'headphone_jack'
  | 'microsd_slot'
  | 'network_5g'
  | 'water_resistance'
  | 'esim'
  | 'telephoto_camera'
  | 'high_refresh_rate'
  | 'compact_size'
  | 'unknown';

export function classifyHardFeature(term: string): RecognizedHardFeature {
  const t = term.trim().toLowerCase();
  if (['android', 'iphone', 'ios', 'apple'].includes(t)) return 'platform';
  if (['nfc', 'contactless'].includes(t)) return 'nfc';
  if (['wireless charging', 'qi charging', 'wireless charge', 'wireless'].includes(t)) {
    return 'wireless_charging';
  }
  if (['headphone jack', '3.5mm', 'audio jack', '3.5mm jack'].includes(t)) {
    return 'headphone_jack';
  }
  if (['microsd', 'sd card', 'expandable storage', 'card slot'].includes(t)) {
    return 'microsd_slot';
  }
  if (['5g', '5g support', 'sub-6'].includes(t)) return 'network_5g';
  if (['waterproof', 'water resistance', 'water resistant', 'ip68', 'ip67'].includes(t)) {
    return 'water_resistance';
  }
  if (['esim', 'dual sim with esim'].includes(t)) return 'esim';
  if (['telephoto', 'optical zoom', 'zoom lens', 'periscope'].includes(t)) {
    return 'telephoto_camera';
  }
  if (['120hz', 'high refresh rate', '90hz', '144hz', 'smooth display'].includes(t)) {
    return 'high_refresh_rate';
  }
  if (['compact', 'small phone', 'one-handed', 'compact size'].includes(t)) {
    return 'compact_size';
  }
  return 'unknown';
}

/**
 * Returns any required must-have features that cannot be verified against the catalog schema.
 * Note: deal_breakers are negative preferences evaluated via text/tag matching, NOT unmodeled
 * hard conditions that trap the user in clarification loops.
 */
export function unsupportedHardFeatures(
  requirements: Pick<UserRequirements, 'must_haves' | 'deal_breakers'>,
): string[] {
  return requirements.must_haves.filter((term) => classifyHardFeature(term) === 'unknown');
}

export function evaluatePhoneHardwareFeature(
  entry: PhoneCatalogEntry,
  feature: RecognizedHardFeature,
): boolean {
  if (feature === 'platform') {
    return true; // Evaluated by OS gate in match.ts
  }
  const spec = entry.spec;
  if (!spec) return false;

  switch (feature) {
    case 'nfc':
      return spec.connectivity?.nfc === true;
    case 'wireless_charging':
      return (spec.charging?.wireless_w ?? 0) > 0;
    case 'headphone_jack':
      return (
        Boolean((spec.connectivity as Record<string, unknown> | undefined)?.jack_3_5mm) ||
        Boolean(spec.highlights?.some((h) => /\b(?:headphone jack|3\.5\s*mm)\b/i.test(h)))
      );
    case 'microsd_slot':
      return (
        Boolean((spec.connectivity as Record<string, unknown> | undefined)?.card_slot) ||
        Boolean(spec.highlights?.some((h) => /\b(?:microsd|card slot|expandable)\b/i.test(h)))
      );
    case 'network_5g':
      return (
        Boolean((spec.connectivity as Record<string, unknown> | undefined)?.network_5g) ||
        /\b5g\b/i.test(entry.model) ||
        /\b5g\b/i.test(spec.chipset ?? '') ||
        /\b5g\b/i.test(entry.tagline ?? '') ||
        Boolean(spec.highlights?.some((h) => /\b5g\b/i.test(h)))
      );
    case 'water_resistance':
      return (
        Boolean(spec.ip_rating && /\b(?:ip6[78]|ipx[78])\b/i.test(spec.ip_rating)) ||
        Boolean(
          spec.highlights?.some((h) => /\b(?:water resistant|waterproof|ip68|ip67)\b/i.test(h)),
        )
      );
    case 'esim':
      return (
        Boolean(spec.connectivity?.sim && /esim/i.test(spec.connectivity.sim)) ||
        Boolean(spec.highlights?.some((h) => /\besim\b/i.test(h)))
      );
    case 'telephoto_camera':
      return Boolean(
        spec.rear_cameras?.some(
          (c) =>
            c.type === 'telephoto' ||
            c.type === 'periscope' ||
            (c.zoom && /\b(?:[2-9]|\d{2,})x\b/i.test(c.zoom)),
        ),
      );
    case 'high_refresh_rate':
      return (spec.display?.refresh_rate_hz ?? 60) >= 90;
    case 'compact_size':
      return (spec.display?.size_in ?? 7.0) <= 6.2;
    default:
      return false;
  }
}

export function passesVerifiedHardFeatures(
  entry: PhoneCatalogEntry,
  requirements: Pick<UserRequirements, 'must_haves' | 'deal_breakers'>,
): boolean {
  if (unsupportedHardFeatures(requirements).length > 0) return false;
  return requirements.must_haves.every((term) => {
    const feat = classifyHardFeature(term);
    return evaluatePhoneHardwareFeature(entry, feat);
  });
}
