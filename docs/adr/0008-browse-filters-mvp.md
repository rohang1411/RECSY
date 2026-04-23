# ADR 0008 — Browse faceted filters (Phase 6 MVP)

Date: 2026-04-21  
Status: Accepted  
Supersedes: none. Narrows the “Browse + filter” row in
`RECSY_V2_PROJECT_CONTEXT.md` §6.

## Context

Phase 5 shipped `/browse` as a flat list of active phones. Users expect
**faceted** filtering (brands, price, form factor) without a second client-only
data fetch. The list must stay **server-rendered** and **shareable** via URL.

## Decision

### 1. URL as source of truth

- Query parameters drive filter state. **`GET` form** (no `useState`+fetch for
  the list): submitting filters **navigates** with a new query string; the
  page re-renders with server-side `where` applied.
- **Contract** (see `src/features/browse/search-params.ts`):
  - `brands` — comma-separated names **or** repeated `brand=` (checkboxes).
  - `min` / `max` — integer USD bounds on `phones.msrp_usd`. If `min` > `max` in
    the URL, values are **swapped** for predictable behaviour. Rows with
    `NULL` MSRP are excluded when either bound is set.
  - `foldable` — `1` / `0` (or `true` / `false`) vs omitted = any. Filter reads
    `PhoneSpec` field `foldable` from `spec_json` JSONB.

### 2. Server SQL (Drizzle)

- `browseWhereFromState` builds `and(eq(status,'active'), …)` with
  `inArray(phones.brand, …)`, `gte`/`lte` on `msrp_usd`, and a **static** JSON
  boolean expression for foldable. User input is never concatenated into raw SQL
  for identifiers; brand values are **bound** as parameters.

### 3. Non-goals (MVP)

- Full-text search on the browse page, infinite scroll, and client-side facet
  counts beyond the all-brands `groupBy` used to populate checkboxes.
- **Logging:** do not log full raw query strings as “analytics events” in shared
  logs if treated as PII; prefer aggregated metrics or redaction if added later.

## Consequences

- Bookmarkable, crawlable(ish) filter URLs; no hydration mismatch for the
  result list.
- Facet quality depends on `phones.brand` and `spec_json` consistency; typos
  in manual URLs yield empty sets, not server errors.
