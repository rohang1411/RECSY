import type { PhoneCatalogEntry } from './catalog';
import type { UserRequirements } from './requirements-schema';

function kind(term: string): 'platform' | 'nfc' | 'wireless' | 'unknown' {
  const normalized = term.trim().toLowerCase();
  if (['android', 'iphone', 'ios', 'apple'].includes(normalized)) return 'platform';
  if (normalized === 'nfc') return 'nfc';
  if (normalized === 'wireless charging') return 'wireless';
  return 'unknown';
}
/** Missing/unmodeled hard constraints require clarification, not assumed compliance. */
export function unsupportedHardFeatures(
  requirements: Pick<UserRequirements, 'must_haves' | 'deal_breakers'>,
): string[] {
  return [
    ...requirements.must_haves.filter((term) => kind(term) === 'unknown'),
    ...requirements.deal_breakers,
  ];
}
export function passesVerifiedHardFeatures(
  entry: PhoneCatalogEntry,
  requirements: Pick<UserRequirements, 'must_haves' | 'deal_breakers'>,
): boolean {
  if (unsupportedHardFeatures(requirements).length) return false;
  return requirements.must_haves.every((term) => {
    switch (kind(term)) {
      case 'platform':
        return true; // platform is checked by the existing OS gate
      case 'nfc':
        return entry.spec?.connectivity.nfc === true;
      case 'wireless':
        return (entry.spec?.charging.wireless_w ?? 0) > 0;
      default:
        return false;
    }
  });
}
