import { sql } from 'drizzle-orm';
import { catalogCandidates } from '@/services/db/schema';

// Existing non-phone exclusions are permanent; skipped retryable phones remain eligible.
export function activeCatalogCandidateSql() {
  return sql`not (${catalogCandidates.issueCodes} && array['non_phone_device', 'archived_candidate']::text[])
    and not exists (select 1 from phones excluded_phone
      where excluded_phone.status = 'archived' and (
        excluded_phone.id = ${catalogCandidates.matchedPhoneId}
        or excluded_phone.canonical_key = ${catalogCandidates.canonicalKey}
        or lower(excluded_phone.brand || ' ' || excluded_phone.model) = lower(${catalogCandidates.candidateTitle})
        or (lower(excluded_phone.model) = lower(${catalogCandidates.candidateTitle})
          and lower(excluded_phone.brand) = lower(${catalogCandidates.normalizedIdentityJson}->>'brand'))
      ))`;
}

export function isArchivedCatalogCandidate(issueCodes: readonly string[]): boolean {
  return issueCodes.includes('non_phone_device') || issueCodes.includes('archived_candidate');
}
