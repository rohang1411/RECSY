import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getPostgres } from '../src/services/db/client';
import { catalogCandidates, crawlQueue, phones, sources } from '../src/services/db/schema';
import {
  isLikelyCatalogPhoneTitle,
  catalogExactModelKey,
} from '../src/services/catalog/candidate-policy';

const SLUGS = ['apple-iphone-18-pro', 'apple-iphone-18-pro-max'];
const ARCHIVE_CODES = new Set(['archived_candidate', 'excluded_unverified_device']);

async function main() {
  const db = getDb();
  const rawDb = getPostgres();
  try {
    const phoneRows = await db.select().from(phones).where(inArray(phones.slug, SLUGS));
    assert.equal(phoneRows.length, 2, 'Expected both existing individual phone records');
    const ids = phoneRows.map((p) => p.id);
    const candidates = await db.select().from(catalogCandidates);
    const restoreCandidates = candidates.flatMap((c) => {
      if (
        !isLikelyCatalogPhoneTitle(c.candidateTitle) ||
        !c.issueCodes.includes('excluded_unverified_device')
      )
        return [];
      const p = phoneRows.find(
        (p) =>
          c.matchedPhoneId === p.id ||
          catalogExactModelKey(p.brand, c.candidateTitle) ===
            catalogExactModelKey(p.brand, p.model),
      );
      return p ? [{ candidate: c, phone: p }] : [];
    });
    const sourceRows = await db
      .select({
        id: sources.id,
        phoneId: sources.phoneId,
        status: sources.status,
        updatedAt: sources.updatedAt,
      })
      .from(sources)
      .where(inArray(sources.phoneId, ids));
    const queueRows = await db.select().from(crawlQueue).where(inArray(crawlQueue.phoneId, ids));
    console.log(
      JSON.stringify(
        {
          apply: process.argv.includes('--apply'),
          phones: phoneRows.map((p) => ({
            id: p.id,
            slug: p.slug,
            status: p.status,
            archive: p.specJson._catalogArchive,
          })),
          candidates: restoreCandidates.map(({ candidate: c }) => ({
            id: c.id,
            title: c.candidateTitle,
            matchedPhoneId: c.matchedPhoneId,
            status: c.status,
            issues: c.issueCodes,
            hasPromotion: Boolean(c.claimsJson.promotion),
          })),
          sources: sourceRows,
          historicalQueueRows: queueRows.length,
          queueToRestore: queueRows.filter(
            (row) => row.lastError === 'Archived device: processing disabled',
          ),
        },
        null,
        2,
      ),
    );
    if (!process.argv.includes('--apply')) return;
    await db.transaction(async (tx) => {
      const now = new Date();
      for (const p of phoneRows) {
        if (p.status !== 'archived') continue;
        const archive = p.specJson._catalogArchive as
          | { reason?: string; archivedAt?: string }
          | undefined;
        assert.equal(
          archive?.reason,
          'excluded_by_catalog_review',
          'Refusing to undo an unrelated archival',
        );
        const archiveAt = new Date(archive?.archivedAt ?? '');
        assert(Number.isFinite(archiveAt.getTime()), 'Missing archive timestamp');
        await tx
          .update(phones)
          .set({
            status: 'active',
            specJson: sql`${phones.specJson} - '_catalogArchive'`,
            nextIngestAt: now,
            nextScorecardAt: now,
            updatedAt: now,
          })
          .where(and(eq(phones.id, p.id), eq(phones.status, 'archived')));
        // Only the source rows stamped by the mistaken archival are re-enabled.
        const restoredSourceIds = sourceRows
          .filter(
            (s) =>
              s.phoneId === p.id &&
              s.status === 'removed' &&
              Math.abs(s.updatedAt.getTime() - archiveAt.getTime()) < 2000,
          )
          .map((s) => s.id);
        if (restoredSourceIds.length > 0) {
          await tx
            .update(sources)
            .set({ status: 'active', updatedAt: now })
            .where(inArray(sources.id, restoredSourceIds));
        }
      }
      for (const { candidate: c, phone: p } of restoreCandidates) {
        await tx
          .update(catalogCandidates)
          .set({
            matchedPhoneId: p.id,
            status: c.claimsJson.promotion ? 'promoted' : 'skipped',
            decision: 'matched_existing',
            issueCodes: c.issueCodes.filter((code) => !ARCHIVE_CODES.has(code)),
            lastError: c.lastError?.startsWith('Archived:') ? null : c.lastError,
            retryAfter: null,
            lastDecisionAt: now,
            updatedAt: now,
          })
          .where(eq(catalogCandidates.id, c.id));
      }
      await tx
        .update(crawlQueue)
        .set({ status: 'queued', lastError: null, scheduledFor: now, updatedAt: now })
        .where(
          and(
            inArray(crawlQueue.phoneId, ids),
            eq(crawlQueue.lastError, 'Archived device: processing disabled'),
          ),
        );
    });
    const restored = await db
      .select({ slug: phones.slug, status: phones.status })
      .from(phones)
      .where(inArray(phones.slug, SLUGS));
    assert(
      restored.every((p) => p.status === 'active'),
      'Individual phones were not restored',
    );
    const combined = await db
      .select({
        title: catalogCandidates.candidateTitle,
        status: catalogCandidates.status,
        issues: catalogCandidates.issueCodes,
      })
      .from(catalogCandidates)
      .where(
        sql`${catalogCandidates.candidateTitle} = 'Apple iPhone 18 Pro and iPhone 18 Pro Max'`,
      );
    assert(
      combined.length > 0 && combined.every((c) => c.issues.includes('non_phone_device')),
      'Combined record must remain excluded',
    );
    console.log('restored', JSON.stringify(restored));
    console.log('combined_still_excluded', JSON.stringify(combined));
  } finally {
    await rawDb.end({ timeout: 5 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
