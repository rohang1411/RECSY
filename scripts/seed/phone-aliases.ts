/**
 * Seed `phone_aliases` — fuzzy-match vocabulary that resolves real-world
 * mentions (video titles, Reddit posts, article headlines) to canonical
 * phone slugs.
 *
 * Guidelines for adding aliases:
 *   - Include brand-qualified AND brand-free variants (users often drop
 *     the brand: "S25 Ultra", "Pixel 9 Pro XL").
 *   - Include common abbreviations ("PM" for Pro Max, "XL" vs "Pro XL").
 *   - Keep aliases case-sensitive friendly; matching should lower-case both
 *     sides at lookup time (done in `scheduler/profiles.ts`).
 *   - When two phones share an alias (e.g. "Pixel 9 Pro" matches both
 *     `google-pixel-9-pro` and `google-pixel-9-pro-xl`), the scheduler must
 *     invoke the Disambiguator. The priority field helps the heuristic:
 *     higher priority wins for unambiguous matches.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { phoneAliases, phones } from '../../src/services/db/schema';

interface AliasSeed {
  slug: string;
  aliases: readonly { alias: string; priority?: number }[];
}

export const PHONE_ALIAS_SEEDS: readonly AliasSeed[] = [
  {
    slug: 'apple-iphone-16-pro-max',
    aliases: [
      { alias: 'iPhone 16 Pro Max', priority: 100 },
      { alias: 'iPhone 16 Pro Max review', priority: 90 },
      { alias: '16 Pro Max', priority: 50 },
      { alias: 'iPhone 16 PM', priority: 40 },
      { alias: 'iPhone16 Pro Max', priority: 40 },
    ],
  },
  {
    slug: 'apple-iphone-16-pro',
    aliases: [
      { alias: 'iPhone 16 Pro', priority: 100 },
      { alias: '16 Pro', priority: 40 },
    ],
  },
  {
    slug: 'apple-iphone-16',
    aliases: [
      { alias: 'iPhone 16', priority: 100 },
      { alias: 'iPhone16', priority: 60 },
    ],
  },
  {
    slug: 'samsung-galaxy-s25-ultra',
    aliases: [
      { alias: 'Galaxy S25 Ultra', priority: 100 },
      { alias: 'S25 Ultra', priority: 90 },
      { alias: 'Samsung S25 Ultra', priority: 80 },
      { alias: 'S25U', priority: 40 },
    ],
  },
  {
    slug: 'samsung-galaxy-s25-plus',
    aliases: [
      { alias: 'Galaxy S25+', priority: 100 },
      { alias: 'Galaxy S25 Plus', priority: 95 },
      { alias: 'S25+', priority: 70 },
      { alias: 'S25 Plus', priority: 70 },
    ],
  },
  {
    slug: 'samsung-galaxy-s25',
    aliases: [
      { alias: 'Galaxy S25', priority: 100 },
      { alias: 'Samsung S25', priority: 80 },
      { alias: 'S25', priority: 50 },
    ],
  },
  {
    slug: 'google-pixel-9-pro-xl',
    aliases: [
      { alias: 'Pixel 9 Pro XL', priority: 100 },
      { alias: 'Google Pixel 9 Pro XL', priority: 95 },
      { alias: '9 Pro XL', priority: 60 },
      { alias: 'P9 Pro XL', priority: 50 },
    ],
  },
  {
    slug: 'google-pixel-9-pro',
    aliases: [
      { alias: 'Pixel 9 Pro', priority: 100 },
      { alias: 'Google Pixel 9 Pro', priority: 90 },
      { alias: '9 Pro', priority: 30 },
    ],
  },
  {
    slug: 'google-pixel-9',
    aliases: [
      { alias: 'Pixel 9', priority: 95 },
      { alias: 'Google Pixel 9', priority: 90 },
    ],
  },
  {
    slug: 'google-pixel-9a',
    aliases: [
      { alias: 'Pixel 9a', priority: 100 },
      { alias: 'Google Pixel 9a', priority: 90 },
      { alias: 'Pixel9a', priority: 70 },
    ],
  },
  {
    slug: 'oneplus-13',
    aliases: [
      { alias: 'OnePlus 13', priority: 100 },
      { alias: 'OP13', priority: 50 },
      { alias: 'OnePlus13', priority: 60 },
    ],
  },
  {
    slug: 'oneplus-nord-4',
    aliases: [
      { alias: 'OnePlus Nord 4', priority: 100 },
      { alias: 'Nord 4', priority: 70 },
    ],
  },
  {
    slug: 'xiaomi-14-ultra',
    aliases: [
      { alias: 'Xiaomi 14 Ultra', priority: 100 },
      { alias: '14 Ultra', priority: 50 },
    ],
  },
  {
    slug: 'xiaomi-redmi-note-14-pro-plus',
    aliases: [
      { alias: 'Redmi Note 14 Pro+', priority: 100 },
      { alias: 'Redmi Note 14 Pro Plus', priority: 95 },
      { alias: 'Xiaomi Redmi Note 14 Pro+', priority: 90 },
    ],
  },
  {
    slug: 'nothing-phone-2a-plus',
    aliases: [
      { alias: 'Nothing Phone 2a Plus', priority: 100 },
      { alias: 'Nothing Phone (2a) Plus', priority: 95 },
      { alias: 'Phone 2a Plus', priority: 70 },
    ],
  },
  {
    slug: 'nothing-phone-3a-pro',
    aliases: [
      { alias: 'Nothing Phone 3a Pro', priority: 100 },
      { alias: 'Nothing Phone (3a) Pro', priority: 95 },
      { alias: 'Phone 3a Pro', priority: 70 },
    ],
  },
  {
    slug: 'samsung-galaxy-a55-5g',
    aliases: [
      { alias: 'Galaxy A55 5G', priority: 100 },
      { alias: 'Galaxy A55', priority: 90 },
      { alias: 'Samsung A55', priority: 70 },
    ],
  },
  {
    slug: 'samsung-galaxy-a35-5g',
    aliases: [
      { alias: 'Galaxy A35 5G', priority: 100 },
      { alias: 'Galaxy A35', priority: 90 },
    ],
  },
  {
    slug: 'motorola-edge-50-fusion',
    aliases: [
      { alias: 'Motorola Edge 50 Fusion', priority: 100 },
      { alias: 'Edge 50 Fusion', priority: 85 },
    ],
  },
  {
    slug: 'samsung-galaxy-z-fold-6',
    aliases: [
      { alias: 'Galaxy Z Fold 6', priority: 100 },
      { alias: 'Galaxy Z Fold6', priority: 95 },
      { alias: 'Z Fold 6', priority: 80 },
      { alias: 'Samsung Fold 6', priority: 70 },
    ],
  },
];

export async function seedPhoneAliases(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<{ upserted: number }> {
  // Resolve slugs to phone UUIDs; skip silently if a phone hasn't been seeded
  // yet (keeps seed order flexibility: phones can run before or after aliases).
  const slugRows = await db.select({ id: phones.id, slug: phones.slug }).from(phones);
  const bySlug = new Map(slugRows.map((r) => [r.slug, r.id]));

  const rows: Array<{ phoneId: string; alias: string; priority: number }> = [];
  for (const seed of PHONE_ALIAS_SEEDS) {
    const phoneId = bySlug.get(seed.slug);
    if (!phoneId) continue;
    for (const a of seed.aliases) {
      rows.push({ phoneId, alias: a.alias, priority: a.priority ?? 50 });
    }
  }
  if (rows.length === 0) return { upserted: 0 };

  // `ON CONFLICT (phone_id, alias) DO UPDATE priority` to respect updates.
  const result = await db
    .insert(phoneAliases)
    .values(rows)
    .onConflictDoUpdate({
      target: [phoneAliases.phoneId, phoneAliases.alias],
      set: { priority: sql`excluded.priority` },
    })
    .returning({ id: phoneAliases.id });

  // No-op to appease drizzle's type system about `eq` import.
  void eq;
  return { upserted: result.length };
}
