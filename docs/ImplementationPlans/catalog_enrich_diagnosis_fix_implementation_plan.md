# Catalog Enrichment Diagnosis & Fix — Detailed Implementation Plan

> Scope: fix the three confirmed failures from the latest `catalog:auto` run, add
> verbose per-candidate diagnostics, and stop phantom/unreleased candidates from
> churning. This plan is written to be executed step-by-step by an AI assistant
> (e.g. Codex) with minimal ambiguity. Every root cause below was verified with
> live API tests against this run's actual candidates.

---

## 0. Context — what the latest run told us

Run summary (after the previous promotion-fix plan was applied):

```
[catalog:sync-mobileapi] done records=1 ... needs_enrichment=1 dropped_non_phone=9 dropped_unreleased=0
[catalog:enrich-oem] skip fetch_failed https://www.apple.com/iphone-fold/specs/: HTTP 404
[catalog:enrich] Processing 3 candidates in brand-priority + newest-first order.
[catalog:enrich] [Apple iPhone Fold]        -> Not found on Wikipedia; quarantining.
[catalog:enrich] [Apple iPhone 17 Pro Max]  -> Not found on Wikipedia; quarantining.
[catalog:enrich] [Honor Honor Power2]        -> Not found on Wikipedia; quarantining.
[catalog:promote] no candidates to promote
[catalog:report] FAILED  (Failed query ... from "catalog_candidates")
```

What is actually working now (do NOT touch): MobileAPI non-phone filtering
(`dropped_non_phone=9`), routing incomplete priority records to
`needs_enrichment`, OEM URL synthesis + 404 skip, brand-priority ordering.

What is broken (this plan):

1. `catalog:report` crashes — a `Date` serialization bug, not SQL/schema.
2. Wikipedia enrichment returns nothing even for phones that exist — two
   compounding bugs (redirect stub + brand-prepend search).
3. Phantom/unreleased candidates (`iPhone Fold`) churn through OEM + Wikipedia.
4. No per-candidate diagnostics, so none of the above was visible.

---

## 1. Evidence (verified live — keep for reference)

### 1a. Report crash — real error is hidden in `error.cause`

The script only prints `err.stack ?? err.message`, but drizzle wraps the real
cause. Surfaced cause:

```
The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Date    (code: ERR_INVALID_ARG_TYPE)
```

Running the `any(issue_codes)` filters directly against the DB returns
`{promoted:0, needs_enrichment:0, low_comp:0}` with no error — so the array
filters are fine. The only failing piece is the raw `Date` (`${since}`) embedded
in a `sql` template. The sibling query works because it uses the `gte()` helper.

### 1b. Wikipedia redirect stub bug (highest impact)

```
parse "iPhone 17 Pro Max"  (no redirects):  len=81    redirectStub=true  infobox=false
parse "iPhone 17 Pro Max"  (redirects=1):   len=23556 redirectStub=false infobox=true  title="IPhone 17 Pro"
parse "iPhone 17 Pro"       (no redirects):  len=23556 redirectStub=false infobox=true
```

`fetchWikitext` does not pass `redirects=1`, so any redirect-titled phone returns
a `#REDIRECT` stub with no infobox -> `null` -> quarantine. This is why the one
genuinely promotable new phone (iPhone 17 Pro Max) failed.

### 1c. Wikipedia search query bug

```
opensearch "Apple iPhone 17 Pro Max" => ["Apple iPhone 15 Pro Max"]   (WRONG model; redirect)
opensearch "iPhone 17 Pro Max"       => ["IPhone 17 Pro Max", ...]      (correct)
fulltext   "iPhone 17 Pro Max"       => ["IPhone 17 Pro", ...]          (canonical article)
opensearch "Honor Honor Power2"      => []                              (brand duplicated)
fulltext   "Honor Power2"            => ["Anne Finucane","PowerPC G4"]  (no article exists)
```

- Prepending brand makes opensearch return the wrong/older model or nothing.
- `model` for some sources already contains the brand (`Honor Power2`), so
  `${brand} ${model}` becomes `Honor Honor Power2`.
- The current matcher `tl.includes(brand) || tl.includes(model)` happily accepts
  `Apple iPhone 15 Pro Max` because it contains `apple`.
- `Honor Power 2` genuinely has no en.wikipedia article — quarantine is correct
  there; it must be served by OEM/MobileAPI, not Wikipedia.

---

## 2. Changes

### Step 1 — Fix the report crash (unblocks observability first)

File: `scripts/catalog-report.ts` (line ~93, `promotedLastWindow`).

Replace the embedded `Date` with an ISO string:

```ts
// BEFORE
promotedLastWindow: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted' and ${catalogCandidates.updatedAt} >= ${since})::int`,

// AFTER
promotedLastWindow: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted' and ${catalogCandidates.updatedAt} >= ${since.toISOString()})::int`,
```

Also improve the script's `catch` so future failures show the real cause:

```ts
main().catch((err) => {
  console.error('[catalog:report] FAILED');
  const cause = (err as { cause?: unknown }).cause;
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  if (cause) console.error('cause:', cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
```

Acceptance: `pnpm catalog:report --days 35` prints the signals block without error.

---

### Step 2 — Resolve Wikipedia redirects (single biggest enrichment fix)

File: `src/services/catalog/adapters/wikipedia.ts`, function `fetchWikitext`.

Add `redirects: '1'` to the `parse` call so redirect titles resolve to the real
article:

```ts
async function fetchWikitext(pageTitle: string): Promise<string | null> {
  const res = await wikiApiFetch({
    action: 'parse',
    page: pageTitle,
    prop: 'wikitext',
    redirects: '1', // <-- resolve "iPhone 17 Pro Max" -> "iPhone 17 Pro"
    format: 'json',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { parse?: { title?: string; wikitext?: { '*'?: string } } };
  return data?.parse?.wikitext?.['*'] ?? null;
}
```

Optionally also return `data.parse.title` (resolved title) for diagnostics
(Step 4).

Acceptance: fetching `iPhone 17 Pro Max` yields ~23KB wikitext containing
`{{Infobox mobile phone}}`.

---

### Step 3 — Rework Wikipedia search query construction

File: `src/services/catalog/adapters/wikipedia.ts`, function `searchPhoneTitle`.

Goals: dedupe brand-in-model, try canonical-article search first, and stop
accepting wrong/older models.

1. Build ordered, deduped query variants:
   - `modelOnly` = model with a leading brand token stripped (mirror
     `stripBrandPrefix` from `src/services/catalog/adapters/wikidata.ts`).
   - `brandModel` = `${brand} ${model}` ONLY when `model` does not already start
     with the brand (case-insensitive).
   - Prefer `modelOnly` first (opensearch is prefix-based and brand-prefixing
     hurts Apple/Google/etc.).

2. For each variant, query in this order and collect candidate titles:
   - Full-text: `action=query&list=search&srsearch=<variant>&srlimit=5` — this
     lands on canonical articles (e.g. `iPhone 17 Pro`).
   - Fallback opensearch: `action=opensearch&search=<variant>&limit=5`.

3. Pick the best title by token overlap, not substring:
   - Normalize titles and the model to lowercase token sets (reuse
     `normalizeIdentityText`).
   - Require that the candidate title contains ALL of the model's distinguishing
     tokens OR is a prefix of the model (so `iPhone 17 Pro` matches model
     `iPhone 17 Pro Max`, but `iPhone 15 Pro Max` does NOT match `17`).
   - Reject titles that contain a conflicting numeric generation token
     (e.g. model has `17`, title has `15`).

Suggested shape:

```ts
async function searchPhoneTitle(brand: string, model: string): Promise<string | null> {
  const variants = buildSearchVariants(brand, model); // modelOnly, [brandModel]
  for (const q of variants) {
    const titles = [...(await fullTextSearch(q)), ...(await openSearch(q))];
    const match = pickBestTitle(titles, model);
    if (match) return match;
  }
  return null;
}
```

Helper rules for `pickBestTitle(titles, model)`:

- tokenize model -> `modelTokens` (drop the brand token).
- score each title: +2 if all numeric tokens of model present, +1 per shared
  word token, reject if a different leading generation number is present.
- return the highest-scoring title above a small threshold, else `null`.

Acceptance:

- `searchPhoneTitle("Apple", "iPhone 17 Pro Max")` -> `"IPhone 17 Pro"` (or
  `"IPhone 17 Pro Max"`).
- `searchPhoneTitle("Honor", "Honor Power2")` -> `null` (no article; correct).
- never returns `"Apple iPhone 15 Pro Max"` for a `17` query.

---

### Step 4 — Verbose per-candidate diagnostics

Files: `src/services/catalog/adapters/wikipedia.ts`,
`scripts/catalog-enrich-gsmarena.ts`.

The user explicitly wants to know "what failed for which phone". Add structured
diagnostics.

1. Change `fetchWikipediaSpecs` to return a result + diagnostics instead of bare
   `PhoneSpec | null`:

```ts
export interface WikipediaFetchResult {
  spec: PhoneSpec | null;
  diagnostics: {
    queriesTried: string[];
    matchedTitle: string | null;   // post-redirect resolved title
    infobox: 'found' | 'missing' | 'no-article';
    specFieldCount: number;        // populated top-level fields when spec != null
    failureReason?: 'no-article' | 'no-infobox' | 'llm-empty';
  };
}
export async function fetchWikipediaSpecs(brand: string, model: string): Promise<WikipediaFetchResult> { ... }
```

Keep backward compatibility by updating the single caller
(`catalog-enrich-gsmarena.ts`). GSMArena adapter can stay `PhoneSpec | null`.

2. In `scripts/catalog-enrich-gsmarena.ts`, log one line per candidate that
   includes the search query, resolved article, infobox status, spec field
   count, missing CORE fields (from the promotion plan), and final decision:

```ts
console.log(
  `${LOG} [${brand} ${model}] query=${diag.queriesTried.join('|')} ` +
    `article=${diag.matchedTitle ?? 'none'} infobox=${diag.infobox} ` +
    `specFields=${diag.specFieldCount} missingCore=[${missingCore.join(',')}] -> ${decision}`,
);
```

`missingCore` comes from the existing core-gap detection used in
`buildPromotionPlan` / `isCoreIncompletePlan` (the blocker `missing_spec_field`
codes). If a `findMissingCoreFields` helper exists in
`src/services/catalog/spec-project.ts`, reuse it for the printed list.

Target example output:

```
[catalog:enrich] [Apple iPhone 17 Pro Max] query=iPhone 17 Pro Max article=IPhone 17 Pro infobox=found specFields=11 missingCore=[] -> ready_to_promote
[catalog:enrich] [Honor Honor Power2]      query=Honor Power2|Honor Honor Power2 article=none infobox=no-article specFields=0 missingCore=[] -> quarantined(spec_source_not_found)
```

Acceptance: every processed candidate prints exactly which query/article/infobox
path it took and why it ended where it did.

---

### Step 5 — Stop phantom/unreleased candidates from churning

Files: `scripts/catalog-enrich-gsmarena.ts`, `scripts/catalog-enrich-oem.ts`.

`Apple iPhone Fold` is rumored (no real release), wastes an OEM 404 and a
Wikipedia attempt every run.

- Keep the existing `isUnreleasedCandidate` future-date guard.
- Add a "no usable release date AND not found on any source" branch: instead of
  `markNoSpecSourceFound` (30-day quarantine that re-enters as "bad data"), mark
  such rows as `failed_transient` / decision `pending_review` with issue code
  `unreleased_candidate` (or a new `speculative_candidate`) and a longer
  `retryAfter` (e.g. 60 days). This keeps them out of every scheduled run until
  they actually launch and gain a Wikipedia article / OEM page.
- In `catalog-enrich-oem.ts`, when the synthesized OEM URL 404s for a candidate
  with no release date, do not quarantine — leave it for the deferred path above.

Acceptance: a second consecutive `catalog:enrich-gsmarena` run does NOT reprocess
`iPhone Fold`.

---

## 3. Tests

File(s): existing Wikipedia adapter test (e.g.
`src/services/catalog/adapters/__tests__/wikipedia.test.ts` or equivalent).

- `fetchWikitext` includes `redirects=1` (assert on the URL/params passed to the
  mocked fetch).
- `searchPhoneTitle`:
  - strips brand-in-model duplication (`Honor` + `Honor Power2`).
  - returns canonical `iPhone 17 Pro` for model `iPhone 17 Pro Max`.
  - rejects mismatched generation (`iPhone 15 Pro Max` for a `17` query) -> null.
- `fetchWikipediaSpecs` returns the new diagnostics object shape.

Run:

```
pnpm typecheck
pnpm test
```

---

## 4. Validation (manual, end-to-end)

1. `pnpm catalog:report --days 35` -> succeeds, prints signals block.
2. `pnpm catalog:enrich-gsmarena --limit 5` ->
   - `Apple iPhone 17 Pro Max` resolves to `IPhone 17 Pro`, infobox=found,
     reaches `ready_to_promote` (or `needs_enrichment` with explicit
     `missingCore=[...]`).
   - `Honor Honor Power2` clearly logged as `no-article` (expected gap).
   - `iPhone Fold` deferred, not quarantined.
3. `pnpm catalog:promote` -> promotes any `ready_to_promote` rows.
4. Re-run `catalog:enrich-gsmarena` -> `iPhone Fold` is NOT reprocessed.

---

## 5. Execution order & rollback

Order: Step 1 (report) -> Step 2 (redirects) -> Step 3 (search) -> Step 4
(diagnostics) -> Step 5 (deferral) -> tests.

Each step is independent and small; Step 2 alone is expected to flip
`iPhone 17 Pro Max` from quarantine to promotable. If any step regresses, it can
be reverted in isolation without affecting the others.

---

## 6. Out of scope (already working — do not change)

- MobileAPI non-phone filtering and `needs_enrichment` routing.
- OEM URL synthesis + 404 skip behavior.
- Brand-priority + newest-first candidate ordering.
- Tiered core/enrichment promotion gate from the prior plan.
