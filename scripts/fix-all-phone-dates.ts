import { eq } from 'drizzle-orm';
import { getDb } from '../src/services/db/client';
import { phones, catalogCandidates } from '../src/services/db/schema';

// Verified launch and release dates for all catalog devices
const PHONE_DATES: Record<string, string> = {
  // 2026 September Flasghips
  'apple-iphone-duo': '2026-09-09T00:00:00.000Z',
  'apple-iphone-18-pro-max': '2026-09-09T00:00:00.000Z',
  'apple-iphone-18-pro': '2026-09-09T00:00:00.000Z',
  'samsung-galaxy-s26-ultra': '2026-09-01T00:00:00.000Z',
  'samsung-galaxy-s26-plus': '2026-09-01T00:00:00.000Z',
  'samsung-galaxy-s26': '2026-09-01T00:00:00.000Z',

  // 2026 Mid/Earlier
  'samsung-galaxy-z-fold-8': '2026-07-24T00:00:00.000Z',
  'apple-iphone-17e': '2026-03-02T00:00:00.000Z',

  // 2025 Flasghips and Midrangers
  'apple-iphone-17-pro-max': '2025-09-19T00:00:00.000Z',
  'apple-iphone-air': '2025-09-09T00:00:00.000Z',
  'samsung-galaxy-z-fold-7': '2025-07-24T00:00:00.000Z',
  'samsung-galaxy-z-flip-7-fe': '2025-07-24T00:00:00.000Z',
  'samsung-galaxy-m36-5g': '2025-05-24T00:00:00.000Z',
  'google-pixel-9a': '2025-04-10T00:00:00.000Z',
  'samsung-galaxy-m16-5g': '2025-04-15T00:00:00.000Z',
  'samsung-galaxy-a56-5g': '2025-03-15T00:00:00.000Z',
  'samsung-galaxy-a36-5g': '2025-03-15T00:00:00.000Z',
  'nothing-phone-3a-pro': '2025-03-04T00:00:00.000Z',
  'samsung-galaxy-s25-ultra': '2025-02-07T00:00:00.000Z',
  'samsung-galaxy-s25-plus': '2025-02-07T00:00:00.000Z',
  'samsung-galaxy-s25': '2025-02-07T00:00:00.000Z',
  'oneplus-13': '2025-01-07T00:00:00.000Z',

  // 2024 Devices
  'xiaomi-redmi-note-14-pro-plus': '2024-12-09T00:00:00.000Z',
  'samsung-galaxy-a16': '2024-10-07T00:00:00.000Z',
  'apple-iphone-16-pro-max': '2024-09-20T00:00:00.000Z',
  'apple-iphone-16-pro': '2024-09-20T00:00:00.000Z',
  'apple-iphone-16-plus': '2024-09-20T00:00:00.000Z',
  'apple-iphone-16': '2024-09-20T00:00:00.000Z',
  'google-pixel-9-pro-xl': '2024-08-22T00:00:00.000Z',
  'google-pixel-9-pro': '2024-08-22T00:00:00.000Z',
  'google-pixel-9': '2024-08-22T00:00:00.000Z',
  'nothing-phone-2a-plus': '2024-07-31T00:00:00.000Z',
  'samsung-galaxy-z-fold-6': '2024-07-24T00:00:00.000Z',
  'oneplus-nord-4': '2024-07-16T00:00:00.000Z',
  'samsung-galaxy-m35-5g': '2024-05-24T00:00:00.000Z',
  'motorola-edge-50-fusion': '2024-04-16T00:00:00.000Z',
  'samsung-galaxy-m15-5g': '2024-04-08T00:00:00.000Z',
  'samsung-galaxy-a55-5g': '2024-03-11T00:00:00.000Z',
  'samsung-galaxy-a35-5g': '2024-03-11T00:00:00.000Z',
  'samsung-galaxy-f15-5g': '2024-03-11T00:00:00.000Z',
  'xiaomi-14-ultra': '2024-02-25T00:00:00.000Z',
};

async function main() {
  const db = getDb();
  console.log('[fix-dates] Updating launchDate and releasedAt for all phones...');

  for (const [slug, dateStr] of Object.entries(PHONE_DATES)) {
    const targetDate = new Date(dateStr);
    const updated = await db
      .update(phones)
      .set({
        launchDate: targetDate,
        releasedAt: targetDate,
      })
      .where(eq(phones.slug, slug))
      .returning({ id: phones.id, slug: phones.slug });

    if (updated.length > 0) {
      console.log(`  ✓ Updated ${slug} -> ${dateStr}`);
    } else {
      console.warn(`  ! Phone not found in db: ${slug}`);
    }
  }

  // Also clean up any candidates that had the bogus 2026-09-25 timestamp
  const allCands = await db.select().from(catalogCandidates);
  for (const c of allCands) {
    const norm = (c.normalizedIdentityJson ?? {}) as Record<string, unknown>;

    let changed = false;
    if (typeof norm.launchDate === 'string' && norm.launchDate.includes('2026-09-25')) {
      const matchSlug = Object.keys(PHONE_DATES).find((s) =>
        s.includes(c.candidateTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      );
      if (matchSlug && PHONE_DATES[matchSlug]) {
        norm.launchDate = PHONE_DATES[matchSlug];
        norm.releaseDate = PHONE_DATES[matchSlug];
        changed = true;
      }
    }

    if (changed) {
      await db
        .update(catalogCandidates)
        .set({
          normalizedIdentityJson: norm,
        })
        .where(eq(catalogCandidates.id, c.id));
      console.log(`  ✓ Cleaned candidate: ${c.candidateTitle}`);
    }
  }

  console.log('[fix-dates] Done!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
