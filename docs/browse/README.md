# Browse + faceted filters (Phase 6 MVP)

**Scope:** [ADR 0008](../adr/0008-browse-filters-mvp.md). Product context: §6 and
Phase 6 in `RECSY_V2_PROJECT_CONTEXT.md`.

## User-facing route

| Route     | Purpose                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `/browse` | Active phones, optional brand / MSRP / foldable filters; links to `/p/[slug]`. |

## URL parameters

| Param      | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| `brands`   | Comma-separated brand names (exact DB match)           |
| `brand`    | Repeatable; same as `brands` for form posts            |
| `min`      | Min USD MSRP (integer)                                 |
| `max`      | Max USD MSRP (integer)                                 |
| `foldable` | `1` = foldable only, `0` = non-foldable, omitted = any |

`min`/`max` are normalised if reversed (`min` > `max`).

## Code layout

| Path                                      | Role                                    |
| ----------------------------------------- | --------------------------------------- |
| `src/features/browse/search-params.ts`    | Parse/serialize `BrowseFilterState`     |
| `src/features/browse/query.ts`            | Drizzle `where` for browse listing      |
| `src/app/browse/page.tsx`                 | Server page: parse params, query DB     |
| `src/app/browse/browse-filters-form.tsx`  | `GET` filter form + clear link          |
| `src/app/browse/search-params-helpers.ts` | Next `searchParams` → `URLSearchParams` |

## Quality gates

Same as the rest of the app: `pnpm typecheck` · `test` · `lint` · `build`.

## Follow-ups (not MVP)

- Playwright smoke for filtered `/browse?…` (optional; list is already covered
  indirectly if E2E grows).
