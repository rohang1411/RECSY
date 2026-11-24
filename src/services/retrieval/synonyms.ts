/**
 * Smartphone domain synonym dictionary and query expansion (Plan 31 WP-05).
 *
 * Resolves PostgreSQL Full-Text Search (FTS) sparsity in small review corpora
 * by bridging the vocabulary gap between colloquial user queries and reviewer phrasing.
 */

export const SMARTPHONE_DOMAIN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  pwm: ['flicker', 'eye strain', 'display frequency', 'oled dimming', 'headache'],
  flicker: ['pwm', 'eye strain', 'oled dimming'],
  battery: ['endurance', 'screen on time', 'sot', 'drain', 'mah', 'battery life'],
  charging: ['fast charge', 'supervooc', 'wattage', 'charging speed', 'wired charging'],
  camera: ['sensor', 'shutter lag', 'low light', 'dynamic range', 'megapixels', 'optical zoom'],
  performance: ['throttling', 'antutu', 'geekbench', 'framerate', 'lag', 'stutter', 'chipset'],
  throttling: ['thermal', 'overheating', 'sustained performance', 'framerate drop'],
  durability: ['drop test', 'scratches', 'gorilla glass', 'build quality', 'bend test'],
  compact: ['small', 'one-handed', 'pocketable', 'lightweight', 'form factor'],
};

/**
 * Expands a search query with relevant domain synonyms using boolean OR syntax.
 * Quoted phrases are wrapped in double quotes for websearch_to_tsquery compatibility.
 */
export function expandSearchQuery(query: string): string {
  const clean = query.trim().toLowerCase();
  if (!clean) return query;

  const additions: string[] = [];
  const words = clean.split(/\s+/);

  for (const [key, synonyms] of Object.entries(SMARTPHONE_DOMAIN_SYNONYMS)) {
    if (words.includes(key) || clean.includes(key)) {
      for (const syn of synonyms.slice(0, 3)) {
        const formatted = syn.includes(' ') ? `"${syn}"` : syn;
        if (!clean.includes(syn) && !additions.includes(formatted)) {
          additions.push(formatted);
        }
      }
    }
  }

  if (additions.length === 0) return query;
  return `${query} OR ${additions.join(' OR ')}`;
}
