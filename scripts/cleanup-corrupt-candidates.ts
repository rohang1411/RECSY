#!/usr/bin/env tsx
/**
 * Database catalog cleanup:
 * - Purges archaic carrier model numbers and legacy feature phones from `catalog_candidates`.
 * - Purges obscure, non-mainstream brands from `catalog_candidates`.
 * - Deletes ancient legacy phones mistakenly promoted to `phones` (e.g. Galaxy S5 neo).
 * - Cleans up orphaned quality issues, source claims, and identities.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { isLikelyCatalogPhoneTitle } from '../src/services/catalog/candidate-policy';
import { isMainstreamPriorityBrand } from '../src/services/catalog/brand-priority';
import { getDb } from '../src/services/db/client';
import {
  catalogCandidates,
  catalogQualityIssues,
  catalogSourceClaims,
  phones,
  phoneIdentities,
  phoneMediaAssets,
  aspects,
  chunks,
  sourcePhoneLinks,
} from '../src/services/db/schema';

function inferBrand(title: string): string {
  return title.trim().split(/\s+/)[0] ?? '';
}

async function main() {
  const db = getDb();
  console.log('[cleanup] Starting database catalog candidate and phone cleanup...');

  // 1. Inspect corrupt phones in `phones`
  const allPhones = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      releasedAt: phones.releasedAt,
    })
    .from(phones);

  const phonesToDelete = allPhones.filter((p) => {
    // Check if phone matches corrupt title
    if (!isLikelyCatalogPhoneTitle(`${p.brand} ${p.model}`) || !isLikelyCatalogPhoneTitle(p.slug)) {
      return true;
    }
    // Check if phone is known ancient device
    if (p.slug === 'samsung-galaxy-s5-neo') {
      return true;
    }
    // Check if phone is non-mainstream
    if (!isMainstreamPriorityBrand(p.brand)) {
      return true;
    }
    return false;
  });

  console.log(`[cleanup] Found ${phonesToDelete.length} phone(s) to remove from 'phones':`);
  for (const p of phonesToDelete) {
    console.log(`  - ${p.brand} ${p.model} (${p.slug})`);
  }

  for (const p of phonesToDelete) {
    // Delete child rows
    await db.delete(aspects).where(eq(aspects.phoneId, p.id));
    await db.delete(chunks).where(eq(chunks.phoneId, p.id));
    await db.delete(sourcePhoneLinks).where(eq(sourcePhoneLinks.phoneId, p.id));
    await db.delete(phoneIdentities).where(eq(phoneIdentities.phoneId, p.id));
    await db.delete(phoneMediaAssets).where(eq(phoneMediaAssets.phoneId, p.id));
    await db.delete(catalogSourceClaims).where(eq(catalogSourceClaims.phoneId, p.id));
    await db
      .update(catalogCandidates)
      .set({ matchedPhoneId: null })
      .where(eq(catalogCandidates.matchedPhoneId, p.id));
    await db.delete(phones).where(eq(phones.id, p.id));
    console.log(`  [DELETED] phone ${p.slug}`);
  }

  // 2. Inspect corrupt candidates in `catalog_candidates`
  const allCandidates = await db
    .select({
      id: catalogCandidates.id,
      candidateTitle: catalogCandidates.candidateTitle,
      normalizedIdentity: catalogCandidates.normalizedIdentityJson,
    })
    .from(catalogCandidates);

  const candidatesToDelete = allCandidates.filter((c) => {
    const title = c.candidateTitle;
    const brand = (c.normalizedIdentity as { brand?: string } | null)?.brand ?? inferBrand(title);

    // 1. Reject archaic / model number patterns
    if (!isLikelyCatalogPhoneTitle(title)) {
      return true;
    }

    // 2. Reject non-mainstream brands
    if (!isMainstreamPriorityBrand(brand)) {
      return true;
    }

    // 3. Reject known ancient / obsolete devices
    if (/s5 neo|stellar|j2 core/i.test(title)) {
      return true;
    }

    return false;
  });

  console.log(
    `[cleanup] Found ${candidatesToDelete.length} corrupt/non-mainstream candidate(s) to remove from 'catalog_candidates':`,
  );
  for (const c of candidatesToDelete) {
    console.log(`  - ${c.candidateTitle} (${c.id})`);
  }

  if (candidatesToDelete.length > 0) {
    const candidateIds = candidatesToDelete.map((c) => c.id);

    // Clean up child quality issues
    await db
      .delete(catalogQualityIssues)
      .where(inArray(catalogQualityIssues.candidateId, candidateIds));

    // Delete candidates
    await db.delete(catalogCandidates).where(inArray(catalogCandidates.id, candidateIds));

    console.log(`[cleanup] Deleted ${candidateIds.length} candidate rows.`);
  }

  // 3. Print final counts
  const finalPhonesCount = await db.select({ count: sql<number>`count(*)` }).from(phones);
  const finalCandidatesCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(catalogCandidates);

  console.log('[cleanup] Cleanup completed successfully!');
  console.log(`  Remaining active phones: ${finalPhonesCount[0]?.count}`);
  console.log(`  Remaining catalog candidates: ${finalCandidatesCount[0]?.count}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[cleanup] Fatal error:', err);
  process.exit(1);
});
