# Auto Catalog Refresh Pipeline — Code Review

> Reviewed on 2026-05-19 against the implementation plan and actual source files.

---

## Overall Assessment

The foundation is **solid and well-architected**. The staged-promotion model, source-tier gating, no-LLM default, plausibility validation, and idempotent upsert patterns are all correct design decisions. That said, there are several concrete bugs, gaps, and design issues worth addressing before this runs unattended in production.

---

## 🐛 Bugs / Concrete Issues

### 1. `nextScorecardAt: null` in new phone promotion (HIGH)

**File:** `src/services/catalog/promote.ts` — `phoneInsertValues()` (line 397)

```ts
// Current
nextScorecardAt: null,
```

The plan and project context both say new phones should get `nextScorecardAt = now + 7d` to prevent `scorecard:auto` from running immediately before any review evidence exists. The code sets it to `null`, which — by the project's own convention — means **"eligible immediately."**

This will cause the scorecard cron to process newly promoted phones the very next morning, writing neutral rows before a single review chunk has been ingested. The existing scorecard guard mentioned in §14.2 (`last_ingest_at IS NULL AND catalog_last_seen_at IS NOT NULL`) is **not implemented** in the scorecard scheduler — it's only described in the plan.

**Fix:** Set `nextScorecardAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)` in `phoneInsertValues()`.

---

### 2. `phoneUpdateValues` resets `nextIngestAt` to `null` on every update (MEDIUM)

**File:** `src/services/catalog/promote.ts` — `phoneUpdateValues()` (line 423)

```ts
nextIngestAt: null,  // in phoneUpdateValues
```

When `catalog:enrich-oem --update-existing` or `catalog:sync-mobileapi --update-existing` refreshes an existing phone, `nextIngestAt` is forced back to `null`. This means any carefully scheduled `next_ingest_at` (e.g. the `+3d`/`+7d` cadence managed by the ingest scheduler) is silently wiped out and the phone is made **immediately eligible** for re-ingestion, potentially burning daily quota.

**Fix:** Remove `nextIngestAt` from `phoneUpdateValues`. Updates to catalog metadata (specs, image, etc.) should not touch the ingest schedule.

---

### 3. Identity match in `findExistingPhoneMatches` doesn't scope by `source_key` (MEDIUM)

**File:** `src/services/catalog/promote.ts` — `findExistingPhoneMatches()` (lines 368–375)

```ts
const identityExternalIds = input.identities.map((identity) => identity.externalId);
if (identityExternalIds.length > 0) {
  const identityRows = await db
    .select({ phoneId: phoneIdentities.phoneId })
    .from(phoneIdentities)
    .where(inArray(phoneIdentities.externalId, identityExternalIds));
```

The identity lookup queries **only** by `external_id`, not `(source_key, external_id)`. Different sources can reuse short IDs (e.g. MobileAPI might use `123`, and so might a future GSMArena adapter). This can produce false-positive matches and wrongly conclude that a new candidate maps to an existing phone.

**Fix:** Change to a compound check — loop per identity using both fields:

```ts
.where(and(
  eq(phoneIdentities.sourceKey, identity.sourceKey),
  eq(phoneIdentities.externalId, identity.externalId),
))
```

---

### 4. `readCandidateSeeds` queries `failed_transient` status which doesn't exist in the schema (LOW)

**File:** `scripts/catalog-enrich-oem.ts` (line 318)

```ts
inArray(catalogCandidates.status, [
  'discovered',
  'quarantined',
  'failed',
  'failed_transient',  // ← does not exist in the schema
]),
```

The implementation plan (§13.1) explicitly says: _"Do not add separate status values such as `failed_transient`... Use `status='failed'` plus `error_code`."_ The enum/schema likely only has `failed`. At best this is a no-op; at worst it causes a DB type error if `status` is a strict Postgres enum.

**Fix:** Remove `'failed_transient'` from the array.

---

### 5. SHA-256 of image URL used as media fingerprint, not image content (LOW)

**File:** `src/services/catalog/promote.ts` — `insertMedia()` (line 534)

```ts
sha256: sha256Hex(imageUrl),
```

The `sha256` field in `phone_media_assets` is documented as the hash of the **image content** (for deduplication and orphan scanning). Using a hash of the URL string instead means:

- The same image at two different URLs creates two rows.
- The media dedup logic from §12 ("Image hash dedupe before upload") is never effective.

This is acceptable as a `remote_only` stub, but should be clearly documented or the field renamed to avoid confusion when the full media pipeline is implemented.

---

### 6. Wikidata SPARQL query uses `P577` (publication date) which may miss many real phones (LOW)

**File:** `src/services/catalog/adapters/wikidata.ts` — `buildRecentPhonesQuery()` (line 72)

```sparql
?item wdt:P577 ?releaseDate.
```

`P577` is "publication date" — primarily used for books and media. For smartphones, the correct property is `P571` ("inception"). Using `P577` alone will miss many real phones that only have `P571` set in Wikidata. Test whether major recent phones (Pixel 9, Galaxy S25, iPhone 16) are returned and if not, switch to a UNION:

```sparql
{ ?item wdt:P577 ?releaseDate } UNION { ?item wdt:P571 ?releaseDate }
```

---

## ⚠️ Design / Architecture Issues

### 7. No advisory lock or concurrency guard in individual scripts (MEDIUM)

The implementation plan (§10.3) specifies acquiring a Postgres advisory lock at the start of a catalog run. None of the three scripts implement this. The GitHub Actions workflow does set `concurrency: cancel-in-progress: false`, which prevents duplicate _scheduled_ runs, but:

- Manual `workflow_dispatch` runs can still overlap a scheduled run.
- Local `pnpm catalog:*` invocations have no protection.
- Two concurrent runs evaluating the same candidate could promote a phone twice (unique slug will prevent DB duplicate, but the transaction won't be atomic).

**Fix:** Add `SELECT pg_advisory_xact_lock(hashtext('catalog_refresh'))` at the start of each catalog script's main DB transaction, or an application-level mutex via a `catalog_runs` status check.

---

### 8. `catalog-refresh.ts` (Wikidata) skips the source-profile `enabled` check in dry-run (LOW)

In `--dry-run` mode the script skips the DB connection entirely and calls Wikidata directly, bypassing the `enabled` flag check. A disabled source will still be queried in dry-run, which could mislead an operator into thinking it's active.

---

### 9. MobileAPI budget accounting scoped to stage name strings, not source key (LOW)

**File:** `scripts/catalog-sync-mobileapi.ts` — `getMobileApiRequestsUsedThisMonth()` (line 438)

```ts
inArray(catalogRuns.stage, ['mobileapi_stage', 'mobileapi_promote']),
```

A future stage name change or a second script that calls MobileAPI under a different stage name would silently break the budget guard.

**Fix:** Filter by source key stored in `checkpoint_json`, or add a dedicated `source_key` column to `catalog_runs`.

---

### 10. `parseWeightG` regex in OEM adapter is too broad — matches `5G` and `128GB` (MEDIUM)

**File:** `src/services/catalog/adapters/oem-page.ts` — `parseWeightG()` (line 270)

```ts
return numberFromMatch(value.match(/(\d+(?:\.\d+)?)\s*g\b/i));
```

The regex matches any `{number}g` including `5G`, `128GB`, and `12G RAM`. Values like `5` (from "5G") are caught by the `80g` plausibility floor, but `128` from "128GB storage" could survive validation.

**Fix:** Require a plausible weight range in the regex or add a negative lookbehind to exclude storage/connectivity tokens:

```ts
value.match(/(?<![0-9])([1-9][0-9]{1,2}(?:\.[0-9]+)?)\s*g\b(?!\s*(?:b|hz))/i);
```

---

### 11. OEM enrichment immediately quarantines incomplete candidates; MobileAPI stages them as `discovered` — runs sequentially and can downgrade status (LOW)

**File:** `scripts/catalog-enrich-oem.ts` (lines 213–214)

The OEM step in the GH Actions workflow runs **after** MobileAPI. A phone staged as `discovered` (pending_review) by MobileAPI can be re-processed by OEM enrichment as `quarantined` if the OEM page doesn't parse cleanly. The inconsistency between the two paths' default disposition should be documented and the interaction reviewed.

---

### 12. No spec-embedding backfill triggered after promotion (MEDIUM)

The plan (§10.10) says to enqueue a `spec-embed:backfill` after spec changes. `phoneInsertValues` correctly sets `specEmbedding: null`, but there is no follow-up: no queue, no automated dispatch, no post-promotion hook. The newly promoted phone won't appear in semantic search results until an operator manually runs `pnpm spec-embed:backfill`.

**Fix:** Add a `pnpm exec tsx scripts/backfill-spec-embeddings.ts --only-null` step to the GH Actions workflow after the promotion step, or log a post-run notice listing promoted phone slugs that need embedding.

---

### 13. `isLikelyOfficialPage` in OEM enrichment is too permissive (LOW)

**File:** `scripts/catalog-enrich-oem.ts` — `isLikelyOfficialPage()` (lines 380–390)

The function accepts any HTTPS URL that isn't Wikidata/MobileAPI/Commons — including Reddit, YouTube, GSMArena, and arbitrary retail pages. Since `rawCandidateJson` is unconstrained JSONB, a malformed candidate could cause the enrichment step to fetch unintended URLs.

**Fix:** Check against an allowlist of known official OEM domains (from `catalog_source_profiles.base_urls`), or apply a stronger domain-pattern heuristic.

---

## 💡 Improvements / Future Hardening

### 14. Wikidata: skip upsert loop if SPARQL result hash matches last run

Every monthly run re-fetches and re-upserts all candidates in the lookback window, incrementing `seenCount` with no write-skipping. Caching the SPARQL response hash and skipping the upsert loop if unchanged would reduce write churn.

### 15. No `pg_trgm` fuzzy-match path in `findExistingPhoneMatches`

The plan specifies a 7-step match order ending with trigram fuzzy match. The code only does slug + canonical key + identity exact match. Minor model name variants (e.g., "Galaxy S25+" vs "Galaxy S25 Plus") could create a duplicate row rather than matching the existing phone. Consider adding this before the `ambiguous_existing_match` block.

### 16. MobileAPI budget accounting uses calendar month, not rolling 30-day window

**File:** `scripts/catalog-sync-mobileapi.ts` (line 429)

```ts
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
```

48 requests on Jan 31 + 50 on Feb 1 = 98 requests in 2 days if MobileAPI uses rolling windows. Investigate MobileAPI's actual reset policy and adjust accordingly.

### 17. No retry logic for transient fetch errors in OEM enrichment

A single 503 or timeout from an OEM CDN will cause the entire `catalog-enrich-oem` run to fail. Adding `p-retry` (already a project dependency) around `fetchOemPageHtml` calls would make the step more resilient.

### 18. `catalog:report` always exits 0 — no structured signal for alerting

The plan mentions `catalog:report` should emit a warning when quarantine count exceeds a threshold. Currently the script always exits 0 regardless. Adding a non-zero exit code or a `::warning` GitHub Actions annotation when the threshold is breached would make the report actionable in CI.

### 19. `updatedCount` in MobileAPI sync double-counts promotions (LOW)

**File:** `scripts/catalog-sync-mobileapi.ts` (line 363)

```ts
updatedCount: updated + promoted,
```

`updated` tracks candidate upserts; `promoted` tracks phone promotions. Adding them conflates two different operations in the run record. The intent was likely separate `candidateUpdatedCount` and `promotedCount` columns.

---

## ✅ What's Working Well

- **Staged promotion model** — candidates never go directly to `phones`; the `PhoneSpecSchema` projection gate is strict and correctly documented.
- **No-LLM default** — every script prints `llm_calls=0`; the policy is coherent and enforced end-to-end.
- **Idempotent upserts** — all scripts use `onConflictDoUpdate` with `stableKey` as the natural key. Re-running any step is safe.
- **Source tier enforcement** — `buildPromotionPlan` correctly blocks T1/T3/T4 sources from direct promotion.
- **Budget caps** — MobileAPI monthly request tracking via `catalog_runs` is well-designed.
- **Schema guard** — all scripts call `findMissingPublicSchema` before touching the DB, failing clean if the migration hasn't run.
- **Plausibility ranges** — `validatePlausibility` covers all key numeric fields with sane min/max bounds.
- **Conservative alias generation** — `aliases.ts` correctly rejects broad aliases and detects sibling collisions before inserting.
- **Transaction isolation** — each phone promotion is a single DB transaction; one failed candidate doesn't abort others.
- **Concurrency guard in GH Actions** — `cancel-in-progress: false` prevents concurrent scheduled runs from stomping on each other.

---

## Summary Priority Table

| #   | Severity  | File                        | Issue                                                              |
| --- | --------- | --------------------------- | ------------------------------------------------------------------ |
| 1   | 🔴 HIGH   | `promote.ts`                | `nextScorecardAt: null` causes immediate scorecard before ingest   |
| 2   | 🟠 MEDIUM | `promote.ts`                | `phoneUpdateValues` resets `nextIngestAt` to `null` on refresh     |
| 3   | 🟠 MEDIUM | `promote.ts`                | Identity match doesn't scope by `source_key` — false-positive risk |
| 7   | 🟠 MEDIUM | All scripts                 | No Postgres advisory lock / concurrency guard                      |
| 10  | 🟠 MEDIUM | `oem-page.ts`               | `parseWeightG` regex matches `5G`/`128GB` tokens                   |
| 12  | 🟠 MEDIUM | GH Workflow                 | No spec-embedding backfill after promotion                         |
| 4   | 🟡 LOW    | `catalog-enrich-oem.ts`     | `failed_transient` status not in schema                            |
| 5   | 🟡 LOW    | `promote.ts`                | SHA-256 is of URL string, not image content                        |
| 6   | 🟡 LOW    | `wikidata.ts`               | `P577` may miss phones that only have `P571`                       |
| 8   | 🟡 LOW    | `catalog-refresh.ts`        | Source-profile `enabled` check skipped in dry-run                  |
| 9   | 🟡 LOW    | `catalog-sync-mobileapi.ts` | Budget accounting scoped to stage names, not source key            |
| 11  | 🟡 LOW    | `catalog-enrich-oem.ts`     | OEM step can downgrade MobileAPI `discovered` → `quarantined`      |
| 13  | 🟡 LOW    | `catalog-enrich-oem.ts`     | `isLikelyOfficialPage` accepts any non-blocked HTTPS URL           |
| 19  | 🟡 LOW    | `catalog-sync-mobileapi.ts` | `updatedCount` double-counts promotions                            |
