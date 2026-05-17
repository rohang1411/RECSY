const EXACT_LABELS = new Map<string, string>([
  ['battery_mah', 'Battery'],
  ['rear_cameras', 'Rear cameras'],
  ['front_camera', 'Front camera'],
  ['refresh_rate_hz', 'Refresh rate'],
  ['msrp_usd', 'MSRP USD'],
  ['min_price_usd', 'Minimum price USD'],
  ['max_price_usd', 'Maximum price USD'],
  ['brand_vector', 'Brand'],
  ['result_manifest', 'Recommendations'],
  ['open_record', 'Phone details'],
]);

const UNIT_WORDS = new Map<string, string>([
  ['usd', 'USD'],
  ['gb', 'GB'],
  ['mp', 'MP'],
  ['mah', 'mAh'],
  ['hz', 'Hz'],
  ['w', 'W'],
  ['ip', 'IP'],
  ['os', 'OS'],
  ['ram', 'RAM'],
  ['msrp', 'MSRP'],
]);

export function humanizeKeyLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return '';

  const exact = EXACT_LABELS.get(normalized);
  if (exact) return exact;

  const words = normalized
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      const unit = UNIT_WORDS.get(word);
      if (unit) return unit;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    });

  return words.join(' ');
}
