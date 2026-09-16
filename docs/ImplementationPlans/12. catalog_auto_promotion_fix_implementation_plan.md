# Catalog Auto Promotion Fix — Implementation Plan

> Status: Ready for implementation (hand-off to Codex).
> Author: Diagnosis + plan from pipeline forensics on the live DB.
> Scope: `scripts/catalog-*.ts` and `src/services/catalog/**`. No DB migration required (all columns already exist).

---

## 0. TL;DR for the implementer

The automated catalog pipeline (`pnpm catalog:auto`) has **promoted 0 phones, ever**. Every staged candidate dead-ends in `quarantined`/`skipped`. The dominant root cause is a promotion gate (`findMissingProjectionFields`) that requires **17 fully-populated spec fields, all-or-nothing**, which is far stricter than the actual `PhoneSpecSchema` (~6 required) and which **no available source can satisfy**. Secondary causes: the MobileAPI adapter ignores `device_type` (tablets staged as phones) and can't parse quarter-style release dates (unreleased devices slip in), incomplete candidates are quarantined instead of routed to enrichment, OEM enrichment never has an official URL to fetch, and stale junk crowds the quarantine queue.

We are implementing a **tiered/progressive** promotion model:

- Promote as soon as a **core** spec set is present (display size+resolution, chipset, RAM, storage, battery, OS, ≥1 rear camera).
- Treat the remaining fields as **enrichment** fields: they lower `spec_completeness` and trigger background re-enrichment, but do not block promotion.
- Use **Wikipedia + Gemini LLM** as the primary spec-completion engine, with a **no-LLM OEM-URL resolver** for top brands as a complement.
- Clean up the stale quarantine backlog and stop staging tablets / unreleased devices.

This decision was confirmed with the project owner: gate = **tiered**, sources = **both (Wikipedia/LLM primary + OEM URL resolution for top brands)**.

---

## 0.1 Senior review additions before implementation

The plan below is directionally correct. Add these guardrails while
implementing so the fix does not trade "zero promotions" for "low-quality
public catalog rows."

1. **Distinguish schema-required from product-required fields.**
   `PhoneSpecSchema` technically allows `os` and `rear_cameras` to be optional,
   but this plan intentionally makes them CORE because RECSY's recommender and
   product pages are not useful without them. Keep that distinction explicit in
   comments/tests so a future maintainer does not "simplify" the gate back to
   only Zod-required fields.

2. **Add a minimum public-quality floor in addition to CORE.**
   CORE-only promotion can produce `spec_completeness` around 0.47. That is
   valid for the schema, but may be too sparse for user-facing browsing and
   recommendation. Keep CORE as the blocker gate, but add one of these explicit
   policies:
   - **Recommended v1:** promote CORE-complete phones, mark
     `metadata_confidence='0.70'` and `issueCodes=['low_completeness']` when
     completeness is `< 0.70`, and ensure UI/recommender can tolerate sparse
     optional fields.
   - **Stricter alternative:** require CORE plus `spec_completeness >= 0.70`
     for `status='active'`; otherwise promote as `status='upcoming'` or keep
     the candidate `pending_review`.

   Pick one explicitly before coding. The current plan implies the recommended
   v1 path, but the status/metadata consequences should be documented in code.

3. **Protect the canonical catalog from duplicate canonical rows during
   progressive promotion.**
   Relaxing the spec gate increases the number of promotions. Strengthen the
   duplicate checks around `canonicalKey`, slug, source identities, aliases, and
   existing legacy phones. If a match is ambiguous, block with
   `possible_duplicate`/`pending_review` instead of creating a new phone row.

4. **Make LLM usage budgeted and observable, not just limited by `--limit`.**
   `catalog-enrich-gsmarena` can call Gemini after finding Wikipedia/GSMArena
   pages. Add a hard per-run budget (`--max-llm-calls`, default 5 or 10), update
   `catalog_runs.llm_call_count` as calls happen, and stop cleanly with
   `llm_budget_exhausted` rather than relying only on candidate `--limit`.
   Scheduled runs should keep this low; manual runs can pass a larger value.

5. **Add a no-source vs incomplete-source distinction.**
   `spec_source_not_found` means no trusted article/page was found. A found page
   that still lacks CORE fields should use `needs_enrichment` or
   `core_spec_incomplete`, not `spec_source_not_found`. This keeps reports
   actionable: source discovery failed vs source was too sparse.

6. **Ensure promoted low-completeness rows do not loop forever.**
   The plan already mentions `attempts >= 3`. Also record whether completeness
   improved since the last attempt. If the same candidate returns the same
   `contentHash`/completeness twice, push `retryAfter` to 30 days immediately.

7. **Add a one-time backlog repair command after the code change.**
   The code fix alone will not clean existing rows. Add a documented command
   sequence:
   - run prune in `--dry-run`
   - run prune for real
   - clear stale retry windows for priority discovered rows
   - run `catalog:enrich-gsmarena --limit 5`
   - run `catalog:report --days 35`

   This should be part of rollout, not left as an operator guess.

8. **Add concurrency protection.**
   GitHub schedules and manual dispatches can overlap. Add either workflow
   `concurrency` for `catalog-refresh.yml` or a DB advisory lock in
   `catalog:auto`/top-level scripts. Without this, two runs can race on
   candidate state and duplicate source calls.

9. **Keep MobileAPI as discovery, not a detail-source sink.**
   Do not add per-device detail calls unless the budget model changes. The free
   tier is 50 requests/month; by-year pages should stay the only MobileAPI
   calls in this implementation.

10. **Add a final acceptance metric to the report.**
    Extend `catalog:report` or the workflow summary to print:
    `promoted_last_run`, `needs_enrichment`, `low_completeness_promoted`,
    `dropped_non_phone`, `dropped_unreleased`, and
    `non_priority_incomplete_skipped`. The current report tells us state, but
    not whether the auto-promotion fix is trending in the right direction.

---

## 1. Verified evidence (so you trust the diagnosis)

Collected by querying the live DB and a one-request MobileAPI dry-run:

- `phones` = 20 rows, all with `catalog_last_seen_at` set, but `catalog_candidates` with `status='promoted'` = **0**. The 20 phones are seeded, never pipeline-promoted.
- `catalog_candidates` snapshot: `quarantined=42`, `skipped=21`, `discovered=2`, `promoted=0`.
  - By source: `mobileapi` quarantined 40 / skipped 20; `oem_page` quarantined 1 / skipped 1; `wikidata` discovered 2 / quarantined 1.
- The 40 quarantined-this-run rows are almost all obscure brands (Doogee, BLU, Blackview, AGM, 8849, Aiplus, Acer) + one Apple, all `missing_spec_field` (± `implausible_value`). They were first created on the very first MobileAPI run and re-touched every run.
- MobileAPI `device_type` distribution among candidates: `phone=55`, `tablet=5` → tablets are being staged.
- Raw MobileAPI device payload (example, `iPad Air 11 2026`) has only these keys:
  `id, name, camera, colors, weight, storage, hardware, image_b64, image_url, thickness, description, device_type, release_date, battery_capacity, manufacturer_name, screen_resolution`.
  - It has **no** `os`, **no** connectivity (wifi/bluetooth/nfc), **no** charging-wattage, **no** refresh-rate/panel-type fields. So MobileAPI can NEVER satisfy the 17-field gate.
  - `device_type: "tablet"` exists but is ignored by the adapter.
  - `release_date: "1Q 2026"` is not parseable by the adapter → treated as released.
- A `--dry-run` of `catalog:sync-mobileapi --years 2026 --max-pages-per-year 1` printed:
  `scanned=10 selected=3 valid=0 blocked=3 mainstream_selected=3 non_priority_incomplete_skipped=7`, and the 3 "selected" were `Apple iPhone Fold` (unreleased), `Apple iPad Air 11 2026` (tablet), `Apple iPad Air 13 2026` (tablet). So the brand-priority filter works, but it forwards tablets/unreleased and the records are all `blocked` on the same enrichment fields: `display.refresh_rate_hz, display.panel_type, front_camera, charging.wired_w, charging.wireless_w, weight_g, os, connectivity.wifi, ...`.
- The two `discovered` rows are real released priority phones stuck in `pending_review`:
  `iPhone 17 Pro Max` (launch 2025-09-19) and `Honor Power2` (launch 2026-01-05), both `spec_projection_missing`, both with a future `retry_after` of 2026-06-25.
- Both `GEMINI_API_KEY` and `MOBILEAPI_API_KEY` are present in `.env.local`.

What already works (do NOT "fix"): brand-priority sorting (`compareCatalogPriorityThenNewest`, `brandPriorityRank`) and the non-priority skip filter in `selectPlansForLimit`.

---

## 2. Current architecture (orientation)

Pipeline orchestrator: [scripts/catalog-auto.ts](../../scripts/catalog-auto.ts) runs, in order:

1. `scripts/backfill/canonical-keys.ts`
2. [scripts/catalog-refresh.ts](../../scripts/catalog-refresh.ts) — Wikidata discovery → `discovered`/`pending_review` (identity only, `spec_projection_missing`).
3. [scripts/catalog-sync-mobileapi.ts](../../scripts/catalog-sync-mobileapi.ts) — MobileAPI by-year → stages + (with `--promote`) promotes.
4. [scripts/catalog-enrich-oem.ts](../../scripts/catalog-enrich-oem.ts) — fetch official OEM pages for candidates that already carry an official URL.
5. [scripts/catalog-enrich-gsmarena.ts](../../scripts/catalog-enrich-gsmarena.ts) — Wikipedia (LLM) primary, GSMArena warm-standby; promotes what validates.
6. [scripts/catalog-promote.ts](../../scripts/catalog-promote.ts) — promote `ready_to_promote`/`validated`.
7. [scripts/catalog-backfill-media.ts](../../scripts/catalog-backfill-media.ts)
8. [scripts/catalog-report.ts](../../scripts/catalog-report.ts)

Core services:

- [src/services/catalog/spec-project.ts](../../src/services/catalog/spec-project.ts) — `projectPhoneSpec`, `findMissingProjectionFields`, `specCompleteness`. **The gate lives here.**
- [src/services/catalog/validation.ts](../../src/services/catalog/validation.ts) — `validateCatalogCandidate`, `validatePlausibility`.
- [src/services/catalog/promote.ts](../../src/services/catalog/promote.ts) — `buildPromotionPlan`, `promoteCatalogCandidate`.
- [src/services/catalog/adapters/mobileapi.ts](../../src/services/catalog/adapters/mobileapi.ts) — `mobileApiDeviceToImportRecord`, `fetchMobileApiDevicesByYear`.
- [src/services/catalog/adapters/oem-page.ts](../../src/services/catalog/adapters/oem-page.ts) — `extractOemProductPage`, `fetchOemPageHtml`.
- [src/services/catalog/adapters/wikipedia.ts](../../src/services/catalog/adapters/wikipedia.ts) — `fetchWikipediaSpecs` (LLM infobox → `PhoneSpec`).
- [src/services/catalog/candidate-policy.ts](../../src/services/catalog/candidate-policy.ts) — released/priority/phone-title policy.
- [src/services/catalog/brand-priority.ts](../../src/services/catalog/brand-priority.ts) — priority ranks.
- [src/services/catalog/index.ts](../../src/services/catalog/index.ts) — barrel (export new symbols here).

Relevant schema facts ([src/services/db/schema.ts](../../src/services/db/schema.ts)):

- `catalog_candidates.status` enum: `discovered, fetched, extracted, validated, ready_to_promote, promoted, skipped, quarantined, failed, failed_transient, rate_limited, quota_exhausted`.
- `catalog_candidates.decision` enum: `pending_review, promote, update_existing, matched_existing, configuration, skip, quarantine`.
- `catalog_candidates` also has: `issueCodes text[]`, `attempts int`, `seenCount int`, `retryAfter timestamptz`, `matchedPhoneId uuid`.
- `phones.specCompleteness numeric(3,2)`, `phones.mediaStatus` enum `local_ok|remote_only|missing|blocked`, `phones.status` enum `active|discontinued|upcoming`.
- `PhoneSpecSchema` ([src/features/phones/schema.ts](../../src/features/phones/schema.ts)) truly-required: `display.size_in`, `display.resolution`, `chipset`, `ram_gb`, `storage_options_gb` (≥1), `battery_mah`, plus `charging` and `connectivity` objects (their inner fields are optional). `os`, `rear_cameras`, `front_camera`, `weight_g`, `refresh_rate_hz`, `panel_type` are all `.optional()`.

---

## 3. Design: the tiered gate

### 3.1 Field tiers

CORE (blocking — required to promote):

- `display.size_in`
- `display.resolution`
- `chipset`
- `ram_gb`
- `storage_options_gb` (length ≥ 1)
- `battery_mah`
- `os`
- `rear_cameras` (length ≥ 1)

ENRICHMENT (non-blocking — lower `spec_completeness`, trigger re-enrichment):

- `display.refresh_rate_hz`, `display.panel_type`
- `front_camera`
- `charging.wired_w`, `charging.wireless_w`
- `weight_g`
- `connectivity.wifi`, `connectivity.bluetooth`, `connectivity.nfc`

`spec_completeness` continues to be `(17 - missing_full)/17` (full = CORE ∪ ENRICHMENT = the existing 17). Promotion threshold for "needs re-enrichment" = **`< 0.70`**.

### 3.2 Why these are CORE

They are the fields the product surfaces and ranks on, and they are reliably present in Wikipedia infoboxes and OEM pages. `os` and `rear_cameras` are CORE because a phone without them is not useful for the recommender; they are routinely available from Wikipedia even when charging wattage / connectivity strings are not.

---

## 4. Step-by-step implementation

Each step lists: files, exact changes, and **Pitfalls** (handle these during implementation).

### Step 1 — Tiered gate in `spec-project.ts`

File: [src/services/catalog/spec-project.ts](../../src/services/catalog/spec-project.ts)

1. Add `findMissingCoreFields()` and keep the existing `findMissingProjectionFields()` (full 17) for completeness:

```ts
export const CORE_SPEC_FIELDS = [
  'display.size_in',
  'display.resolution',
  'chipset',
  'ram_gb',
  'storage_options_gb',
  'battery_mah',
  'os',
  'rear_cameras',
] as const;

export function findMissingCoreFields(input: CatalogSpecProjectionInput): string[] {
  const missing: string[] = [];
  if (input.display?.size_in == null) missing.push('display.size_in');
  if (!input.display?.resolution) missing.push('display.resolution');
  if (!input.chipset) missing.push('chipset');
  if (input.ramGb == null) missing.push('ram_gb');
  if (!input.storageOptionsGb || input.storageOptionsGb.length === 0) {
    missing.push('storage_options_gb');
  }
  if (input.batteryMah == null) missing.push('battery_mah');
  if (!input.os) missing.push('os');
  if (!input.rearCameras || input.rearCameras.length === 0) missing.push('rear_cameras');
  return missing;
}
```

2. Change `projectPhoneSpec()` to gate on CORE only:
   - Replace `const missing = findMissingProjectionFields(input);` with `const missing = findMissingCoreFields(input);`.
   - **Pitfall (critical, will crash otherwise):** the candidate object build currently uses non-null assertions on now-optional fields, e.g. `input.charging!.wired_w` and `input.connectivity!.wifi`. Under the old gate `charging`/`connectivity` were always present; now they can be `undefined` at runtime (the `!` is TS-only). Convert these to optional chaining so the object still builds:

```ts
charging: {
  wired_w: input.charging?.wired_w,
  wireless_w: input.charging?.wireless_w,
  reverse_wireless_w: input.charging?.reverse_wireless_w,
},
connectivity: {
  wifi: input.connectivity?.wifi,
  bluetooth: input.connectivity?.bluetooth,
  nfc: input.connectivity?.nfc,
  ir_blaster: input.connectivity?.ir_blaster,
  usb: input.connectivity?.usb,
  sim: input.connectivity?.sim,
},
```

- `display` stays safe because CORE guarantees `display.size_in` + `display.resolution`, so the `display` object exists; the inner `input.display!.refresh_rate_hz` etc. resolve to `undefined` which `PhoneSpecSchema` accepts. `storage_options_gb: [...input.storageOptionsGb!]` is safe (CORE guarantees it). `front_camera: input.frontCamera` may be `undefined` → schema optional, fine.
- Keep the `PhoneSpecSchema.safeParse(candidate)` step. With CORE present it passes (CORE ⊇ schema-required). `charging`/`connectivity` are required _objects_ in the schema with optional inner fields — an object of all-`undefined` parses cleanly.

3. Leave `specCompleteness()` unchanged (it uses `findMissingProjectionFields`, the full 17, `requiredCount = 17`). Add a small helper for the threshold:

```ts
export const SPEC_COMPLETENESS_PROMOTE_OK = 1.0; // fully complete
export const SPEC_COMPLETENESS_ENRICH_THRESHOLD = 0.7;
```

4. Export `findMissingCoreFields`, `CORE_SPEC_FIELDS`, and the threshold constants from [src/services/catalog/index.ts](../../src/services/catalog/index.ts).

**Pitfalls**

- Do NOT change `requiredCount = 17` in `specCompleteness` (keeps the metric meaningful and the existing `specCompleteness({}) === 0` / `specCompleteness(complete) === 1` test assertions valid).
- Keep `findMissingProjectionFields` exported and behavior-identical — other code/tests reference it.

### Step 2 — Blockers only for CORE in `validation.ts`

File: [src/services/catalog/validation.ts](../../src/services/catalog/validation.ts)

1. Import and use `findMissingCoreFields` instead of `findMissingProjectionFields` in `validateCatalogCandidate` (the loop at lines ~39-43). The emitted `missing_spec_field` blockers now fire only for CORE gaps.
2. Add an unreleased guard (the owner explicitly does not want unreleased phones promoted). Extend `CandidateValidationInput` to accept `releasedAt` and add a blocker when the launch/release date is in the future:

```ts
import { isFutureCatalogDate } from './candidate-policy';
// ...
if (isFutureCatalogDate(toDateString(input.launchDate)) || isFutureCatalogDate(input.releasedAt)) {
  issues.push(
    blocker('unreleased_candidate', 'launch/release date is in the future', 'launchDate'),
  );
}
```

- `toDateString` should accept the existing `Date | string | null` `launchDate` and return an ISO string or `undefined`.
- Keep the existing `validatePlausibility` 18-months `launch_date_too_far_future` check (it catches typos/garbage far-future dates). The new check is stricter (any future) and is the one that enforces "no unreleased".

**Pitfalls**

- `isFutureCatalogDate` uses `Date.parse` and a "start of next UTC day" boundary, so a phone released _today_ is NOT future (good — same-day releases promote).
- `validateCatalogCandidate` is also called from tests; update them (Step 10).

### Step 3 — `buildPromotionPlan` + `promoteCatalogCandidate` in `promote.ts`

File: [src/services/catalog/promote.ts](../../src/services/catalog/promote.ts)

1. In `buildPromotionPlan` (lines ~88-112):
   - `projection.missing` now contains CORE gaps only (because `projectPhoneSpec` uses `findMissingCoreFields`). The existing mapping to `missing_spec_field` blockers is correct as-is.
   - Pass `releasedAt` to `validateCatalogCandidate`:
     ```ts
     const validationIssues = validateCatalogCandidate({
       brand: claims.brand,
       model: claims.model,
       launchDate: claims.launchDate,
       releasedAt: claims.releasedAt,
       status: claims.status,
       sourceTier: claims.sourceTier,
       spec: claims.spec,
     });
     ```
   - Add a NON-blocking completeness signal so promoted-but-incomplete phones are tracked:
     ```ts
     const completeness = specCompleteness(claims.spec);
     if (completeness < SPEC_COMPLETENESS_ENRICH_THRESHOLD) {
       issues.push({
         severity: 'info',
         code: 'low_completeness',
         message: `spec completeness ${completeness.toFixed(2)} below enrich threshold`,
       });
     }
     ```
   - `ok` stays `issues.every(i => i.severity !== 'blocker') && projectedSpec != null` — `info` does not block.

2. In `promoteCatalogCandidate` success transaction (the `catalogCandidates` update at lines ~298-309): set up progressive re-enrichment when completeness is low:

   ```ts
   const lowCompleteness = plan.specCompleteness < SPEC_COMPLETENESS_ENRICH_THRESHOLD;
   await tx
     .update(catalogCandidates)
     .set({
       matchedPhoneId: phoneId,
       status: 'promoted',
       decision: existingPhoneId ? 'update_existing' : 'promote',
       confidence: '0.95',
       issueCodes: lowCompleteness ? ['low_completeness'] : [],
       attempts: sql`${catalogCandidates.attempts} + 1`,
       retryAfter: lowCompleteness ? sql`now() + interval '3 days'` : null,
       lastDecisionAt: sql`now()`,
       updatedAt: sql`now()`,
     })
     .where(eq(catalogCandidates.id, candidateId));
   ```

3. `phoneInsertValues`/`phoneUpdateValues` already write `specCompleteness: plan.specCompleteness.toFixed(2)` and `mediaStatus`. No change needed, but verify `specCompleteness` is correctly populated for partial specs (it now will be < 1 frequently).

**Pitfalls**

- A candidate may be promoted with `low_completeness` and a 3-day `retryAfter`. The enrich step (Step 5) must (a) pick these up after `retryAfter`, (b) cap re-attempts via `attempts` so a phone Wikipedia can't improve doesn't churn forever, and (c) push `retryAfter` far out (e.g. +30 days) once `attempts` exceeds a cap (e.g. 3) or completeness stops improving.
- `promoteCatalogCandidate` is also invoked directly by `catalog-sync-mobileapi.ts`, `catalog-enrich-oem.ts`, `catalog-enrich-gsmarena.ts`, and `catalog-promote.ts`. The new candidate-update logic runs for all of them — that's intended.

### Step 4 — MobileAPI adapter: device_type, dates, charging

File: [src/services/catalog/adapters/mobileapi.ts](../../src/services/catalog/adapters/mobileapi.ts)

1. **device_type**: add an exported helper and stop staging non-phones.

   ```ts
   const PHONE_DEVICE_TYPES = new Set(['phone', 'smartphone', 'mobile', '']);
   export function mobileApiDeviceType(device: Record<string, unknown>): string {
     return (stringValue(device.device_type) ?? '').toLowerCase();
   }
   export function isMobileApiPhone(device: Record<string, unknown>): boolean {
     const t = mobileApiDeviceType(device);
     return PHONE_DEVICE_TYPES.has(t); // tablet/watch/laptop/earbuds/tv → false
   }
   ```

   - Keep `device` in `record.raw` (already done) so the sync can also read `raw.device_type`.

2. **Release dates**: make `parseReleaseDate` handle quarter/period and month-year formats. Map quarters to the first day of the quarter (conservative for "is it released yet"):

   ```ts
   function parseReleaseDate(value: string | undefined): string | undefined {
     if (!value) return undefined;
     const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
     if (iso) return iso;
     // "1Q 2026" / "Q1 2026"
     const q = value.match(/(?:Q\s*([1-4])\s*,?\s*(\d{4}))|(?:([1-4])Q\s*,?\s*(\d{4}))/i);
     if (q) {
       const quarter = Number(q[1] ?? q[3]);
       const year = q[2] ?? q[4];
       const month = String((quarter - 1) * 3 + 1).padStart(2, '0'); // Q1->01 Q2->04 Q3->07 Q4->10
       return `${year}-${month}-01`;
     }
     // "January 2026" / "Jan 2026"
     const my = value.match(/([A-Za-z]+)\s+(\d{4})/);
     if (my) {
       const d = new Date(`${my[1]} 1, ${my[2]} UTC`);
       if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
     }
     // "2026, January 5" (existing fallback) ...keep existing logic...
     const released = value.match(/(\d{4}),?\s+([A-Za-z]+)(?:\s+(\d{1,2}))?/);
     if (released) {
       const day = released[3] ?? '01';
       const d = new Date(`${released[2]} ${day}, ${released[1]} UTC`);
       if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
     }
     // Bare year "2026"
     const year = value.match(/\b(20\d{2})\b/)?.[1];
     if (year) return `${year}-01-01`;
     return undefined;
   }
   ```

   - This feeds `launchDate`/`releasedAt` so `isReleasedCatalogCandidate` and the new unreleased blocker work. A future quarter/year now resolves to a future date → correctly deferred.

3. **Charging**: include `battery_capacity` text in the charging haystack (it sometimes contains "W"), and stop relying on the non-existent `device.battery` field:

   ```ts
   const value = [
     device.charging,
     device.battery_charging,
     device.battery_capacity,
     device.battery,
     device.description,
   ]
     .map(stringValue)
     .filter(Boolean)
     .join(' ');
   ```

   - Under the tiered gate, charging is an enrichment field, so this is best-effort; do not let it block.

**Pitfalls**

- Some MobileAPI records omit `device_type`; treat empty/missing as phone (the title filter in the sync is the backstop).
- Quarter mapping to first-of-quarter means a phone listed "1Q 2026" is considered released once Jan 1 2026 passes. That's intentional and conservative enough; do NOT map to end-of-quarter (would wrongly defer phones already out).
- Keep `mobileApiDeviceToImportRecord` returning the same `CatalogImportRecord` shape; add helpers as separate exports rather than changing the record type.

### Step 5 — MobileAPI sync: filter non-phones/unreleased, route incomplete to enrichment

File: [scripts/catalog-sync-mobileapi.ts](../../scripts/catalog-sync-mobileapi.ts)

1. In `fetchRecords` (or right after, before `selectPlansForLimit`), drop non-phones and unreleased:
   - Replace the single `releasedRecords` filter with two filters:
     ```ts
     const phoneRecords = records.filter(
       (r) => isMobileApiPhone(r.raw) && isLikelyCatalogPhoneTitle(`${r.brand} ${r.model}`),
     );
     const releasedRecords = phoneRecords.filter(isReleasedMobileApiRecord);
     const droppedNonPhone = records.length - phoneRecords.length;
     const droppedUnreleased = phoneRecords.length - releasedRecords.length;
     ```
   - Import `isMobileApiPhone` from the adapter and `isLikelyCatalogPhoneTitle` from the catalog barrel.

2. Change the staging decision per item (the `.values({...})` insert at lines ~295-321). Replace the binary `plan.ok ? promote : quarantine` with three outcomes:
   - `plan.ok` → `decision: 'promote'`, `status: 'ready_to_promote'`, `confidence: '0.90'`, `issueCodes: []`.
   - `!plan.ok` AND CORE-incomplete only (i.e. the only blockers are `missing_spec_field` and the brand is a mainstream priority brand) → route to enrichment:
     `decision: 'pending_review'`, `status: 'discovered'`, `confidence: '0.50'`, `issueCodes: [...new Set([...plan.issues.map(i=>i.code), 'needs_enrichment'])]`, `retryAfter: null`.
   - `!plan.ok` AND has a "hard" blocker (`implausible_value`, `unreleased_candidate`, `invalid_promotion_claims`, `untrusted_promotion_source`) → keep `decision: 'quarantine'`, `status: 'quarantined'`.
   - Add a helper:
     ```ts
     const HARD_BLOCKERS = new Set([
       'implausible_value',
       'unreleased_candidate',
       'invalid_promotion_claims',
       'untrusted_promotion_source',
       'launch_date_too_far_future',
     ]);
     function isCoreIncompleteOnly(plan): boolean {
       return (
         plan.issues.every((i) => i.severity !== 'blocker' || i.code === 'missing_spec_field') &&
         plan.issues.some((i) => i.code === 'missing_spec_field')
       );
     }
     ```

3. Update the `onConflictDoUpdate` SET clause so it preserves terminal/better states. Replace the existing `case when excluded.status='quarantined' and current in (...) then keep` logic with a precedence rule:
   - Never overwrite `promoted` or `ready_to_promote` with `discovered`/`quarantined`.
   - Allow upgrading `quarantined` → `discovered` (so previously-quarantined priority candidates become enrichment-eligible again).
   - Concretely: `status = case when current.status in ('promoted','ready_to_promote') then current.status else excluded.status end` and mirror for `decision`, `issue_codes`, `confidence`.

4. Update the counters and summary log: add `needs_enrichment` and `dropped_non_phone`/`dropped_unreleased` to the printed line and to `catalogRuns` counts (`skippedCount` for dropped, etc.). Update the dry-run print similarly.

5. Keep `--promote`: still call `promoteCatalogCandidate` for `plan.ok` items only.

**Pitfalls**

- The enrich script selects `decision IN ('pending_review','quarantine')` — `pending_review` is included, so routed candidates will be enriched. Verify `isPriorityOrFreshCandidate` (Step 6) treats `pending_review`+`discovered` as eligible (it does today).
- MobileAPI records will almost always be CORE-incomplete (`os`/`rear_cameras` absent) → they should land in `pending_review needs_enrichment`, NOT quarantine. This is the key behavioral change that lets Wikipedia finish them.
- Do not stage tablets even for priority brands (iPad under "Apple"): the `isMobileApiPhone` filter runs before brand selection.

### Step 6 — Wikipedia/LLM as primary promotion engine

File: [scripts/catalog-enrich-gsmarena.ts](../../scripts/catalog-enrich-gsmarena.ts)

1. **Brand derivation** — `hasBrandAndModel` drops Wikidata candidates whose `normalizedIdentityJson.brand` is null (e.g. `iPhone 17 Pro Max` may have model but null brand). Replace with a resolver that derives brand from the candidate title/model when brand is missing:

   ```ts
   function resolveBrandModel(c: CatalogCandidateRow): { brand: string; model: string } | null {
     const id = c.normalizedIdentityJson as Record<string, unknown>;
     let brand = typeof id.brand === 'string' ? id.brand : undefined;
     const model = typeof id.model === 'string' ? id.model : c.candidateTitle || undefined;
     if (!model) return null;
     if (!brand) brand = inferBrandFromTitle(c.candidateTitle ?? model); // e.g. "iPhone"->Apple, "Galaxy"->Samsung, "Pixel"->Google
     return brand ? { brand, model } : null;
   }
   ```

   - Add `inferBrandFromTitle` using the same keyword→brand map already implied by `MULTI_PHONE_TITLE_RE` / brand-priority brands (iphone→Apple, galaxy→Samsung, pixel→Google, oneplus→OnePlus, nothing phone→Nothing, redmi/poco→Xiaomi, moto→Motorola, etc.). Reuse `DEFAULT_MAINSTREAM_BRAND_PRIORITY` brand lists.
   - Thread `{brand, model}` through the rest of the loop instead of reading `candidate.normalizedIdentityJson.brand/model` directly.

2. **Retry eligibility for released priority phones** — `isRetryEligible` must not lock out released priority candidates with a future `retry_after`. Add:

   ```ts
   function isRetryEligible(c, args) {
     if (args.retryAll) return true;
     if (isMainstreamPriorityBrand(resolveBrandModel(c)?.brand) && !isUnreleasedCandidate(c))
       return true; // NEW
     if (!c.retryAfter) return true;
     if (c.retryAfter <= new Date()) return true;
     if (
       c.decision === 'pending_review' &&
       c.status === 'discovered' &&
       c.issueCodes.includes('spec_projection_missing')
     )
       return true;
     return false;
   }
   ```

   - This unblocks `iPhone 17 Pro Max` / `Honor Power2`.

3. **Progressive re-enrichment** — expand the candidate query to also pull promoted-but-incomplete rows due for retry:

   ```ts
   const candidates = await db
     .select()
     .from(catalogCandidates)
     .where(
       or(
         inArray(catalogCandidates.decision, ['pending_review', 'quarantine']),
         and(
           eq(catalogCandidates.status, 'promoted'),
           sql`'low_completeness' = any(${catalogCandidates.issueCodes})`,
           or(isNull(catalogCandidates.retryAfter), lte(catalogCandidates.retryAfter, new Date())),
         ),
       ),
     );
   ```

   - For these promoted rows, always promote via `promoteCatalogCandidate(db, id, { updateExisting: true })` after a successful Wikipedia fetch so the existing phone is refreshed.
   - Cap churn: when a promoted low-completeness row has `attempts >= 3` and Wikipedia did not raise completeness, push `retryAfter` to `now + 30 days` and remove `low_completeness` (or keep but long-defer). Use the `attempts` column already incremented in Step 3.

4. Confirm orchestration: [scripts/catalog-auto.ts](../../scripts/catalog-auto.ts) already runs this step only when `GEMINI_API_KEY` is set (it is). Keep that, but see Step 8 for adding the prune step before it.

**Pitfalls**

- `fetchWikipediaSpecs` returns a spec validated against the lenient `PhoneSpecSchema`; it may still miss CORE `os`/`rear_cameras`. After building the plan, if still CORE-incomplete, keep the candidate in `pending_review` (do not flip to a terminal quarantine immediately) unless no Wikipedia article was found at all (`markNoSpecSourceFound`).
- The LLM call count is bounded by `--limit` (default 25). Keep that bound; the GitHub workflow already paces LLM usage.
- Watch for `or`, `and`, `isNull`, `lte` imports from `drizzle-orm`.

### Step 7 — OEM URL resolver (no-LLM complement)

New file: `src/services/catalog/oem-url-resolver.ts`

1. Provide a conservative brand→official-URL builder for high-confidence patterns only. Return an ordered list of candidate URLs to try; the OEM extractor verifies the page before promoting.

   ```ts
   import { slugifyCatalogPart } from './identity';
   import { normalizeIdentityText } from './identity';

   export interface OemUrlCandidate {
     url: string;
     brand: string;
   }

   const BUILDERS: Record<string, (model: string) => string[]> = {
     apple: (m) => [`https://www.apple.com/${slugifyCatalogPart(m)}/specs/`],
     google: (m) => [
       `https://store.google.com/product/${slugifyCatalogPart(m).replace(/-/g, '_')}_specs`,
     ],
     nothing: (m) => [`https://nothing.tech/products/${slugifyCatalogPart(m)}`],
     // Add more ONLY with a verified, stable URL pattern. Samsung/Xiaomi/OnePlus
     // pages are region-scoped SPAs and are intentionally omitted until verified.
   };

   export function resolveOemUrls(
     brand: string | null | undefined,
     model: string | null | undefined,
   ): OemUrlCandidate[] {
     if (!brand || !model) return [];
     const key = normalizeIdentityText(brand).replace(/\s+/g, '');
     const builder = BUILDERS[key];
     if (!builder) return [];
     return builder(model).map((url) => ({ url, brand }));
   }
   export function hasOemUrlBuilder(brand: string | null | undefined): boolean {
     return !!brand && normalizeIdentityText(brand).replace(/\s+/g, '') in BUILDERS;
   }
   ```

2. Export from [src/services/catalog/index.ts](../../src/services/catalog/index.ts).

File: [scripts/catalog-enrich-oem.ts](../../scripts/catalog-enrich-oem.ts)

3. In `readCandidateSeeds`, when `bestOfficialUrlFromCandidate(...)` returns null AND the candidate brand has an OEM builder, push the resolver URL(s) as seeds (keeping `fallbackBrand`/`fallbackModel`).
4. **Verification before promotion** (prevents promoting wrong-brand/404 data): after `extractOemProductPage`, if the seed came from the resolver, require `normalizeIdentityText(record.brand) === normalizeIdentityText(seed.fallbackBrand)` AND the model tokens overlap; otherwise treat as blocked and skip (do not write a candidate). `fetchOemPageHtml` already throws on non-200, which the loop should catch per-seed (wrap the fetch in try/catch so one bad URL doesn't abort the run).

**Pitfalls**

- OEM pages are frequently JS-rendered; `linkedom` text extraction may yield sparse specs → most OEM seeds will be CORE-incomplete and should fall through to Wikipedia. That's acceptable; OEM's main wins are official `imageUrl`, `officialUrl` identity, and msrp.
- Do NOT add brands with unstable URL patterns; a wrong guess that happens to 200 on a marketing page could inject bad specs. The verification gate mitigates this, but keep the builder set small and high-confidence.
- Respect the existing `--min-request-gap-ms` pacing; resolver URLs add fetches.

### Step 8 — Quarantine prune / hygiene

New file: `scripts/catalog-prune.ts` (add `pnpm catalog:prune` to `package.json` mirroring the other `tsx --env-file=.env.local` scripts).

Behavior (all under a single transaction-friendly batch; support `--dry-run` and `--delete`):

1. **Non-phones**: candidates where `raw.device_type` is a known non-phone OR `!isLikelyCatalogPhoneTitle(title)` and not already `skipped` → set `status='skipped'`, `decision='skip'`, `issueCodes=['non_phone_device']`.
2. **Long-tail junk**: `status='quarantined'` AND brand is NOT a mainstream priority brand AND `matchedPhoneId IS NULL` → set `status='skipped'`, `decision='skip'`, `issueCodes=['long_tail_pruned']`, `retryAfter = now + interval '180 days'`. (Soft relegation keeps audit history but removes them from the active queue and from the report's top examples.)
3. **Unlock priority**: candidates with brand in priority set, `status IN ('discovered','quarantined','pending_review')`, `matchedPhoneId IS NULL`, and `retryAfter > now` → set `retryAfter = NULL` so the next enrich run reprocesses them.
4. With `--delete`: hard-delete `status='skipped'` rows older than `--older-than-days` (default 90) that are not `matchedPhoneId`-linked, to keep the table lean. Default is soft (no delete).
5. Print a summary (counts per action) and write a `catalogRuns` row with `stage='prune'` for observability (reuse the existing run-insert pattern; `catalogRunStageEnum` — confirm `prune` is allowed, otherwise use an existing generic stage like `discover` or extend the enum; **prefer not to migrate** — if the enum doesn't include a suitable value, log without inserting a run row, or use `stage: 'done'`).

Wire into [scripts/catalog-auto.ts](../../scripts/catalog-auto.ts): insert the prune step **after** MobileAPI sync and **before** OEM/Wikipedia enrichment, as `optional: true`:

```ts
{ label: 'Prune stale catalog candidates', script: 'scripts/catalog-prune.ts', args: [], optional: true },
```

**Pitfalls**

- Never prune `status='promoted'` or rows with `matchedPhoneId` set.
- Step 3 (unlock) must run AFTER Step 2 (relegate) so a non-priority row isn't unlocked.
- Check `catalogRunStageEnum` values before inserting a `stage='prune'` run; if absent, avoid a migration (see schema note in §9).
- Make prune idempotent: re-running it must not thrash already-classified rows (guard on current status/issueCodes).

### Step 9 — `catalog-auto.ts` ordering + flags

File: [scripts/catalog-auto.ts](../../scripts/catalog-auto.ts)

Final step order:

1. Backfill legacy identities (`scripts/backfill/canonical-keys.ts`)
2. Discover Wikidata (`catalog-refresh.ts`)
3. Sync MobileAPI (`catalog-sync-mobileapi.ts`) — keeps `--promote --update-existing`
4. **Prune** (`catalog-prune.ts`) — NEW, optional
5. Enrich from OEM (`catalog-enrich-oem.ts --from-candidates --limit 25 --promote --update-existing`) — now also uses resolver
6. Enrich from Wikipedia/LLM (`catalog-enrich-gsmarena.ts --limit 25`) — primary promotion engine (only when `GEMINI_API_KEY` set; unchanged guard)
7. Promote ready (`catalog-promote.ts --ready --limit 50 --update-existing`)
8. Backfill media (`catalog-backfill-media.ts`)
9. Report (`catalog-report.ts --days 35`)

No change needed to the `spec-embed:backfill` step (it runs in the GitHub workflow, not in `catalog-auto.ts`).

### Step 10 — Tests + typecheck

Update/extend (run `pnpm test` and `pnpm typecheck`):

- [src/services/catalog/spec-project.test.ts](../../src/services/catalog/spec-project.test.ts):
  - Keep existing assertions (they remain valid).
  - ADD: `projectPhoneSpec` with CORE present but enrichment fields absent (no connectivity/charging/refresh/panel/weight/front_camera) → `ok === true`, and `specCompleteness(input) < 1`.
  - ADD: `findMissingCoreFields` returns `[]` for the core-complete input and includes `os`/`rear_cameras` when omitted.
- [src/services/catalog/validation.test.ts](../../src/services/catalog/validation.test.ts):
  - Missing enrichment-only fields → NO `missing_spec_field` blocker.
  - Future `launchDate`/`releasedAt` → `unreleased_candidate` blocker.
- [src/services/catalog/promote.test.ts](../../src/services/catalog/promote.test.ts):
  - `buildPromotionPlan` with CORE-only claims → `ok === true`, includes `low_completeness` info issue, no blockers.
  - Future-dated claims → `ok === false` with `unreleased_candidate`.
- [src/services/catalog/adapters/mobileapi.test.ts](../../src/services/catalog/adapters/mobileapi.test.ts):
  - `isMobileApiPhone({device_type:'tablet'}) === false`, `'phone'`/missing → true.
  - `parseReleaseDate` for `"1Q 2026"` → `"2026-01-01"`, `"Q3 2025"` → `"2025-07-01"`, `"January 2026"` → `"2026-01-01"`, bare `"2026"` → `"2026-01-01"`.
- [src/services/catalog/candidate-policy.test.ts](../../src/services/catalog/candidate-policy.test.ts): add a case confirming a quarter-derived future date (`2026-10-01` when "now" is mid-2026) is `isFutureCatalogDate === true`.
- NEW `src/services/catalog/oem-url-resolver.test.ts`: `resolveOemUrls('Apple','iPhone 16 Pro')` → `https://www.apple.com/iphone-16-pro/specs/`; unknown brand → `[]`.

**Pitfalls**

- The existing `promote.test.ts` likely builds full claims; ensure the new CORE-only fixtures set `sourceTier` to `'T0'` or `'T2'` (otherwise the `untrusted_promotion_source` blocker fires and masks the result).
- `vitest` path alias `@/` is configured; keep imports consistent with existing test style.

---

## 10. Cross-cutting pitfalls & edge cases (read before coding)

1. **Runtime crash from optional chaining** (Step 1): the single most likely regression. Any `input.charging!.x` / `input.connectivity!.x` left in `projectPhoneSpec` will throw at runtime once charging/connectivity are absent. Grep the function for `!.` after editing.
2. **`onConflictDoUpdate` state precedence** (Step 5): the existing SET clause specifically protects `ready_to_promote`/`promoted` from being clobbered by `quarantined`. The new routing introduces `pending_review`/`discovered` writes; the precedence rule must still never downgrade a `promoted`/`ready_to_promote` row, but must allow `quarantined → discovered` upgrades. Get this CASE logic right or you'll either re-quarantine promoted phones or never re-activate stuck ones.
3. **Infinite re-enrichment loop** (Steps 3 & 6): promoted `low_completeness` rows get a 3-day `retryAfter`. Without the `attempts`-based long-defer, a phone Wikipedia can't complete will be re-fetched every 3 days forever, burning LLM quota. Implement the cap (attempts ≥ 3 → +30 days).
4. **Unreleased vs same-day release** (Step 2): use `isFutureCatalogDate` (next-UTC-day boundary), not `date > now`, so a phone released today still promotes.
5. **Quarter-date direction** (Step 4): map quarters to the FIRST day. Mapping to end-of-quarter would wrongly defer phones already shipping.
6. **Tablets under priority brands** (Step 5): the `isMobileApiPhone` filter must run BEFORE brand-priority selection, or iPads keep entering as "Apple".
7. **OEM wrong-page promotion** (Step 7): resolver URLs are guesses; the post-extraction brand/model verification is mandatory before promoting. Wrap each fetch in try/catch so a 404 doesn't fail the whole run.
8. **Prune idempotency & safety** (Step 8): never touch `promoted`/`matchedPhoneId` rows; guard against re-thrashing already-classified rows; run unlock after relegation.
9. **Enum availability** (Step 8): if `catalogRunStageEnum` lacks a `prune` value, do NOT add a migration just for observability — log to stdout and either skip the run-row insert or reuse `'done'`. (Schema changes are out of scope; all candidate/phone columns we need already exist.)
10. **Report ordering** (`catalog-report.ts`): it orders examples by `updatedAt desc`. After prune/routing, the report's "top examples" will shift — expected. No code change required, but the operator-facing output will look different (this is the success signal).
11. **MobileAPI monthly budget**: free tier 50 req/month, enforced in `getMobileApiRequestsUsedThisMonth`. Don't add per-device detail fetches (would blow the budget). MobileAPI stays a discovery/identity source; specs come from Wikipedia/OEM.
12. **`buildPromotionPlan` is shared**: changing its issue set affects `catalog-sync-mobileapi`, `catalog-enrich-oem`, `catalog-enrich-gsmarena`, and `catalog-promote`. Re-run the full test suite, not just the unit under edit.
13. **Wikidata null brand** (Step 6): the `inferBrandFromTitle` fallback must cover the priority brand keyword set, or released priority Wikidata candidates (the `iPhone 17 Pro Max` case) stay excluded.

---

## 11. Verification plan (manual, after implementation)

Run locally against `.env.local` (DB + both API keys present). Use small limits to conserve MobileAPI/LLM budget.

1. Unit tests + types:
   ```
   pnpm test
   pnpm typecheck
   pnpm lint
   ```
2. MobileAPI selection no longer forwards tablets/unreleased:
   ```
   pnpm catalog:sync-mobileapi --years 2026 --max-pages-per-year 1 --dry-run
   ```
   Expect: iPads excluded (non-phone), `iPhone Fold`/future items excluded or deferred, incomplete priority items shown as enrichment-bound (not quarantine).
3. Prune the backlog (dry-run first):
   ```
   pnpm exec tsx scripts/catalog-prune.ts --dry-run
   pnpm exec tsx scripts/catalog-prune.ts
   ```
   Expect: tablets/non-phones → skipped; Doogee/BLU/etc. relegated; `iPhone 17 Pro Max`/`Honor Power2` `retry_after` cleared.
4. Wikipedia enrichment promotes released priority phones:
   ```
   pnpm catalog:enrich-gsmarena --limit 5
   ```
   Expect: `iPhone 17 Pro Max` (and similar) promoted with CORE specs; promoted rows with `< 0.70` completeness carry `low_completeness` + a ~3-day `retry_after`.
5. End-to-end:
   ```
   pnpm catalog:auto
   pnpm catalog:report --days 35
   ```
   Expect: a non-zero number of `promoted` candidates / new `phones`; quarantine no longer dominated by Doogee/BLU/iPads.
6. Spot-check a promoted phone in the DB: `phones.spec_completeness` is populated, `spec_json` passes `PhoneSpecSchema`, and the candidate row is `status='promoted'`.

Success criteria:

- `catalog_candidates` shows `status='promoted' > 0`.
- New released priority-brand phones appear in `phones` with CORE specs and a tracked `spec_completeness`.
- No tablets/unreleased devices promoted.
- Quarantine queue is dominated by genuinely bad data, not stale long-tail/tablets.

---

## 12. Out of scope / explicit non-goals

- No DB schema migration (all needed columns/enums already exist; if `prune` stage enum is missing, log instead).
- No new external paid data sources; MobileAPI stays on the free tier as discovery-only.
- GSMArena remains a warm standby (blocked by Cloudflare); do not invest in it now.
- Media/image backfill quality (`catalog-backfill-media.ts` "no exact image match" logs) is a separate concern; the OEM resolver will incidentally improve official image coverage but a dedicated media fix is not part of this plan.

---

## 13. Suggested commit sequencing

1. `feat(catalog): tiered core/enrichment spec gate` — Steps 1-3 + their tests.
2. `fix(catalog): mobileapi device_type + date parsing` — Step 4 + tests.
3. `feat(catalog): route incomplete mobileapi candidates to enrichment` — Step 5.
4. `feat(catalog): wikipedia as primary promotion + progressive re-enrichment` — Step 6.
5. `feat(catalog): oem url resolver for priority brands` — Step 7 + test.
6. `feat(catalog): prune stale/non-phone quarantine backlog` — Step 8 + `catalog-auto` wiring (Step 9).
7. `test(catalog): finalize suite + verification run` — Step 10 cleanup.

Keep each commit green (`pnpm test`, `pnpm typecheck`).

---

## 14. Implementation status

Implemented in this pass:

- Tiered promotion gate: `projectPhoneSpec()` now blocks only on CORE fields and still records low completeness for later enrichment.
- Promotion metadata: low-completeness promoted candidates get `issue_codes=['low_completeness']`, lower metadata confidence, and a retry window.
- MobileAPI hardening: explicit non-phone `device_type` filtering, quarter/bare-year release-date parsing, released-only selection, mainstream brand priority, latest-first ordering, and incomplete priority candidates routed to enrichment instead of quarantine.
- Wikipedia/LLM enrichment hardening: missing brand derivation, pending/quarantined/low-completeness retry pickup, LLM budget cap, retry deferral, and no immediate terminal quarantine for source-found but CORE-incomplete rows.
- OEM no-LLM complement: conservative Apple/Samsung/Google/Nothing official URL resolver, per-URL fetch/extract failure isolation, and resolver brand/model verification before DB writes.
- Queue hygiene: new `catalog:prune` script soft-skips non-phones and long-tail quarantines, unlocks priority candidates for enrichment, and supports explicit old-skipped deletion only behind `--delete`.
- Orchestration/reporting: `catalog:auto` now runs prune before enrichment, Wikidata fetches a wider bounded window before priority selection, and `catalog:report` prints acceptance signals.
- Tests: added/updated projection, validation, promotion, MobileAPI, OEM resolver, and candidate policy tests.

Verification completed:

```
pnpm exec vitest run src/services/catalog/spec-project.test.ts src/services/catalog/validation.test.ts src/services/catalog/promote.test.ts src/services/catalog/adapters/mobileapi.test.ts src/services/catalog/oem-url-resolver.test.ts src/services/catalog/candidate-policy.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm catalog:auto --dry-run
pnpm catalog:prune --dry-run --limit 20
```

Observed dry-run signal from prune on the current DB: `scanned=20 non_phone=9 long_tail=9 unlocked=2`, which confirms the backlog hygiene step is now identifying both bad queue entries and priority rows that should move back into enrichment.
