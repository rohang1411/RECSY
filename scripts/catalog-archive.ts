import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getPostgres } from '../src/services/db/client';
import { catalogCandidates, crawlQueue, phones, sources } from '../src/services/db/schema';
import { isLikelyCatalogPhoneTitle } from '../src/services/catalog/candidate-policy';
import { isArchivedCatalogCandidate } from '../src/services/catalog/eligibility';

async function main() {
  const apply = process.argv.includes('--apply');
  const db = getDb();
  try {
    const phoneRows = await db.select().from(phones);
    const excludedPhones = phoneRows.filter(
      (p) => !isLikelyCatalogPhoneTitle(`${p.brand} ${p.model}`),
    );
    const excludedIds = excludedPhones.map((p) => p.id);
    const candidates = await db.select().from(catalogCandidates);
    const excludedCandidates = candidates.filter(
      (c) =>
        isArchivedCatalogCandidate(c.issueCodes) ||
        !isLikelyCatalogPhoneTitle(c.candidateTitle) ||
        (c.matchedPhoneId && excludedIds.includes(c.matchedPhoneId)) ||
        excludedPhones.some(
          (p) =>
            c.candidateTitle.toLowerCase() === `${p.brand} ${p.model}`.toLowerCase() ||
            c.candidateTitle.toLowerCase() === p.model.toLowerCase(),
        ),
    );
    console.log(
      JSON.stringify(
        {
          apply,
          phones: excludedPhones.map((p) => p.slug),
          candidates: excludedCandidates.map((c) => ({ id: c.id, title: c.candidateTitle })),
        },
        null,
        2,
      ),
    );
    if (!apply) return;
    await db.transaction(async (tx) => {
      for (const c of excludedCandidates) {
        const reason =
          !isLikelyCatalogPhoneTitle(c.candidateTitle) || c.issueCodes.includes('non_phone_device')
            ? 'non_phone_device'
            : 'excluded_unverified_device';
        if (c.status === 'skipped' && c.issueCodes.includes('archived_candidate')) continue;
        await tx
          .update(catalogCandidates)
          .set({
            status: 'skipped',
            decision: 'skip',
            issueCodes: [...new Set([...c.issueCodes, 'archived_candidate', reason])],
            retryAfter: null,
            lastError: `Archived: ${reason}; retained for reference only`,
            lastDecisionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(catalogCandidates.id, c.id));
      }
      if (excludedIds.length === 0) return;
      await tx
        .update(phones)
        .set({
          status: 'archived',
          nextIngestAt: null,
          nextScorecardAt: null,
          specJson: sql`${phones.specJson} || jsonb_build_object('_catalogArchive', jsonb_build_object('reason', 'excluded_by_catalog_review', 'archivedAt', now()))`,
          updatedAt: new Date(),
        })
        .where(and(inArray(phones.id, excludedIds), sql`${phones.status} <> 'archived'`));
      await tx
        .update(crawlQueue)
        .set({
          status: 'done',
          lastError: 'Archived device: processing disabled',
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(crawlQueue.phoneId, excludedIds),
            inArray(crawlQueue.status, ['queued', 'in_progress', 'failed']),
          ),
        );
      await tx
        .update(sources)
        .set({ status: 'removed', updatedAt: new Date() })
        .where(inArray(sources.phoneId, excludedIds));
    });
    console.log('Archive applied; original records and evidence retained.');
  } finally {
    await getPostgres().end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
