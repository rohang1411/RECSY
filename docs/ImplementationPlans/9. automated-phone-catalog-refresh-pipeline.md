# Automated Phone Catalog Refresh Pipeline

> Status: Foundation partially implemented; scheduled cadence hardened (2026-05-26)
> Goal: Keep the canonical `phones` catalog current automatically, without
> duplicate devices, corrupted specs, broken images, or wasted external calls.

---

## 0. Implementation Status

Implemented in this slice:

- Catalog schema columns/tables and generated migration
  `drizzle/migrations/0005_breezy_pandemic.sql`.
  Finite catalog lifecycle fields are implemented as Postgres enums, not
  unconstrained text.
- RLS default-deny entries for catalog operational tables.
- Seeded catalog source profiles for Wikidata, Commons, and disabled OEM
  profile placeholders.
- Pure catalog foundations: identity/canonical-key helpers, snapshot hashing,
  strict `PhoneSpec` projection, validation, conservative alias generation, and
  Wikidata discovery adapter. The Wikidata query uses direct `P31` instance
  matches to avoid broad subclass-path timeouts. Duplicate Wikidata bindings now
  prefer consumer-facing OEM brands over contract manufacturers, so iPhone-like
  rows normalize to Apple rather than Foxconn/Hon Hai.
- Promotion foundation: `catalog:promote` validates `claims_json.promotion`,
  blocks incomplete specs, dedupes by slug/canonical key/identities, and writes
  `phones`, identities, aliases, configurations, source claims, and remote-only
  media metadata idempotently.
- Generic OEM page enrichment: `catalog:enrich-oem --from-candidates --promote`
  fetches official product URLs from staged candidates, extracts JSON-LD/meta/
  visible spec text via `src/services/catalog/adapters/oem-page.ts`, validates
  `PhoneSpecSchema`, and promotes only complete T0 official records. No LLM
  calls.
- CLI scripts:
  - `pnpm catalog:backfill-identities` - backfills existing seed phones with
    canonical keys and seed identities. Supports `--dry-run`. No LLM calls.
  - `pnpm catalog:refresh --source wikidata --since-years 2` - stages recent
    Wikidata candidates. `--dry-run` previews without DB writes. No LLM calls.
    Does not auto-promote because specs are incomplete.
  - `pnpm catalog:import-specs --file <path> --promote` - imports a trusted
    structured JSON export and promotes records that satisfy `PhoneSpecSchema`.
    No LLM calls.
  - `MOBILEAPI_API_KEY=... pnpm catalog:sync-mobileapi --since-years 2
--promote` - optional licensed API sync using MobileAPI by-year pages.
    Stages every fetched device and promotes only complete structured records.
    No LLM calls. Requires `MOBILEAPI_API_KEY` in `.env.local`; without that
    key, use Wikidata staging or `catalog:import-specs` with a structured export.
    Free-plan guardrails are enforced in code: default `--max-requests 50`,
    persisted month-to-date usage from `catalog_runs`, and
    `--min-request-gap-ms 12500`, keeping cumulative usage at or below 50
    requests/month and under 5 requests/minute.
    Selection is mainstream-first within the fetched batch: complete records
    from Apple, Samsung, Xiaomi, vivo, OPPO, Transsion-family brands
    (Tecno/Infinix/itel), and Nothing/CMF are staged/promoted before niche brands. This is a
    deterministic rank, not an LLM call, and it does not make extra API calls.
  - `pnpm catalog:enrich-oem --from-candidates --promote --update-existing` -
    fetches official OEM URLs already present on staged candidates, extracts
    structured product/spec claims, and promotes only records that satisfy
    `PhoneSpecSchema`. Also supports `--url <official-product-url>` for one-off
    enrichment. It also scans duplicate Wikidata bindings for alternate official
    URLs and prefers cleaner canonical product URLs over localized variants. No
    LLM calls.
  - `pnpm catalog:enrich-gsmarena --limit 25` - automatic spec enrichment for
    staged pending/quarantined candidates. It tries Wikipedia's API first and
    GSMArena as a warm fallback. This path can make LLM calls, but only after it
    finds a real structured phone infobox/page; it then converts the returned
    `PhoneSpec` into catalog projection claims before promotion.
  - `pnpm catalog:promote --ready --limit 20` - promotes staged
    `ready_to_promote` candidates. No LLM calls.
  - `pnpm catalog:report --days 30` - reports runs/candidate status and LLM
    call counts.
- GitHub Actions:
  - `.github/workflows/catalog-refresh.yml` - Monday 01:17 UTC lightweight
    open-source discovery/OEM enrichment, monthly 01:47 UTC full refresh, plus
    manual dispatch. Runs legacy identity backfill, Wikidata staging, optional
    MobileAPI sync/promotion when `MOBILEAPI_API_KEY` is configured, OEM
    enrichment from candidates, optional Wikipedia/GSMArena spec enrichment when
    Gemini is configured, optional Gemini-backed spec embeddings, and a final
    report. Discovery/sync/promotion/OEM enrichment make no LLM calls.

Still pending before fully hands-off scheduled auto-promotion:

- Brand-specific OEM overrides and sitemap discovery expansion beyond the
  generic official-page extractor.
- Local licensed media caching, optional hot-ingest workflow dispatch,
  resume by checkpoint, and internal review UI.

---

## 0.1 Current Automatic Refresh Flow

The implemented pipeline is intentionally staged. A phone only appears in the
canonical `phones` table after a trusted structured source satisfies the strict
runtime `PhoneSpecSchema`.

```text
legacy backfill
  -> discovery/staging
  -> licensed structured sync
  -> official OEM enrichment
  -> optional Wikipedia/GSMArena spec enrichment
  -> strict validation + dedupe
  -> promotion into phones
  -> existing ingestion and scorecard automation
```

### Step 1: Legacy identity backfill

Command:

```bash
pnpm catalog:backfill-identities
```

This derives `phones.canonical_key` for existing seeded phones and seeds
`phone_identities` using the known RECSY slugs. It runs before discovery in the
monthly workflow so auto-refresh can match existing rows instead of creating
duplicates such as a second `Galaxy S25 Ultra`.

### Step 2: Wikidata discovery

Command:

```bash
pnpm catalog:refresh --source wikidata --since-years 2 --limit 150
```

This path makes one Wikidata query and writes durable snapshots plus
`catalog_candidates`. It is a discovery/identity source only. Wikidata candidates
remain `discovered`/`pending_review` because Wikidata does not include the full
set of required `PhoneSpecSchema` fields. The expected output is therefore
`promoted=0`.

### Step 3: MobileAPI structured sync

Command:

```bash
pnpm catalog:sync-mobileapi --since-years 2 --limit 150 --promote --update-existing
```

This path uses the optional `MOBILEAPI_API_KEY`, makes no LLM calls, and obeys
the free-plan limits:

- default `--max-requests 50`
- persisted month-to-date accounting from `catalog_runs`
- default `--min-request-gap-ms 12500`, staying below 5 requests/minute
- GitHub Actions failure if the selected workflow source includes MobileAPI but
  the `MOBILEAPI_API_KEY` secret is missing

MobileAPI's by-year endpoint may return listing-level records rather than full
spec sheets. The sync filters known future/upcoming records before staging,
then prioritizes complete/promotable records first and ranks by the shared
mainstream brand priority: Apple, Samsung, Nothing/CMF, OnePlus/OPPO/Realme,
vivo/iQOO, Xiaomi/Redmi/POCO, Google/Pixel, Motorola/Moto, and then the
remaining priority brands. Within each brand bucket, newest released
`launchDate` wins. If a record is missing required fields, it is
staged/quarantined with exact issue codes. Output such as
`promoted=0 quarantined=50` means the API returned candidates, but none passed
`PhoneSpecSchema`; it is not an API block. Incomplete MobileAPI listing rows do
not count as approved catalog entries, and later MobileAPI syncs no longer
overwrite an already `ready_to_promote` or `promoted` candidate with weaker
partial claims. If the fetched batch contains only incomplete non-priority
records, the sync skips them before staging instead of adding low-value
quarantine noise; complete records are still eligible even for non-priority
brands.

### Step 4: Official OEM page enrichment

Command:

```bash
pnpm catalog:enrich-oem --from-candidates --limit 25 --promote --update-existing
```

This is the no-LLM path that lets staged candidates move into `phones` when
official manufacturer pages provide complete specs.

The command:

1. scans staged candidates for official product URLs, usually from Wikidata
   `officialWebsite`, duplicate Wikidata bindings, normalized identity metadata,
   or any existing official candidate URL;
2. applies the same released-only, brand-priority, newest-first candidate
   policy before choosing URLs, so official page fetches are spent on current
   mainstream phones before long-tail or stale rows;
3. fetches pages politely with a default 2 second delay between requests;
4. extracts Schema.org JSON-LD, OpenGraph/meta tags, and visible spec text via
   `src/services/catalog/adapters/oem-page.ts`;
5. builds a T0 `CatalogImportRecord` with `sourceKey='oem_page'`;
6. runs the same promotion validation as every other path;
7. stages valid records as `ready_to_promote` and, when `--promote` is set,
   promotes them immediately.

One-off enrichment is available for manually found official URLs:

```bash
pnpm catalog:enrich-oem --url <official-product-url> --promote --update-existing
```

The generic extractor is intentionally conservative. If the OEM page omits
display, RAM, storage, cameras, battery, charging, weight, OS, Wi-Fi,
Bluetooth, or NFC, the candidate remains quarantined. Brand-specific overrides
and broader sitemap discovery are the next step for pages whose templates do
not expose enough parseable text.

### Step 4.5: Wikipedia/GSMArena spec enrichment

Command:

```bash
pnpm catalog:enrich-gsmarena --limit 25
```

This is the automatic approval path for candidates that discovery or MobileAPI
found but that do not have complete structured specs yet. The command processes
pending/quarantined candidates in mainstream brand order, queries Wikipedia's
API for a matching phone article, extracts the `{{Infobox mobile phone}}` block,
and uses Gemini to convert that infobox into `PhoneSpec`. If Wikipedia has no
usable infobox, it tries GSMArena as a warm fallback; GSMArena search is
currently often blocked by Cloudflare Turnstile, so Wikipedia is the reliable
first path.

This path can make LLM calls. It makes one LLM call only after a real candidate
page/infobox is found, then projects the returned snake_case `PhoneSpec` into
the camelCase `CatalogPromotionClaimsSchema` shape before validation. That
projection step is required; otherwise valid fetched specs look like missing
fields to the catalog promotion gate. If the projected spec satisfies
`PhoneSpecSchema`, the script marks the candidate `ready_to_promote` and
promotes it immediately. If no trusted article/spec is found, the candidate
stays quarantined with issue codes and waits for a later OEM extractor,
structured import, or improved source. Obvious non-phone devices, such as
iPads/tablets/watches/laptops, are skipped so they do not consume phone
enrichment batches. Candidates with no Wikipedia or GSMArena source are marked
`spec_source_not_found` and get a 30-day `retry_after` so scheduled runs do not
repeatedly spend requests on the same dead end. Manual operators can pass
`--retry-all` to ignore that retry window when they intentionally want to
reattempt priority brands after extractor/source improvements. Candidate
selection uses the shared catalog candidate policy in
`src/services/catalog/candidate-policy.ts`: priority brands first, then newest
released `launchDate`/`releaseDate`, then pending state, then title as a stable
fallback. The same policy filters obvious non-phone titles and combined
multi-phone titles before enrichment, so iPads/tablets/watches and rows such as
`iPhone 17 Pro and iPhone 17 Pro Max` do not consume phone enrichment batches.
Known future-dated rows are not quarantined as bad data; they are deferred with
`issueCodes=['unreleased_candidate']` and `retry_after` set just after the
release date, so they can be retried after launch without blocking released
phones today. Wikidata discovery also adds an upper release-date bound in the
SPARQL query and post-filters results, so future/unreleased devices are not
staged by normal refresh runs.
Rediscovery from Wikidata updates identity/snapshot fields but must not demote
already quarantined, skipped, deferred, ready-to-promote, or promoted candidates
back to `pending_review`; this preserves retry windows and prevents scheduled
runs from reprocessing known dead ends. A plain `discovered`/`pending_review`
row is allowed to clear stale `retry_after` during rediscovery, because those
rows still need enrichment rather than a failure backoff.

### Step 5: Validation and dedupe

Every source uses the same promotion gate:

- `CatalogPromotionClaimsSchema` validates source claims.
- `projectPhoneSpec` maps source claims into today's strict `PhoneSpecSchema`.
- Plausibility checks reject impossible values.
- Source tier rules require T0 official or T2 licensed structured data for
  auto-promotion.
- Matching checks slug, canonical key, identities, and existing aliases so
  existing phones update instead of duplicating.
- RAM/storage/color/model-number SKUs are saved in `phone_configurations`, not
  as separate canonical `phones` rows.

If any required field is missing or ambiguous, the candidate is quarantined and
recorded in `catalog_quality_issues` rather than polluting the canonical
catalog.

### Step 6: Promotion into `phones`

Valid candidates are promoted by:

```bash
pnpm catalog:promote --ready --limit 20 --update-existing
```

or directly by `catalog:sync-mobileapi --promote` and
`catalog:enrich-oem --promote`.

Promotion writes:

- `phones`
- `phone_identities`
- `phone_aliases`
- `phone_configurations`
- `catalog_source_claims`
- `phone_media_assets` as remote-only metadata when local media caching is not
  yet licensed/implemented

New active phones are immediately eligible for the existing ingestion scheduler
because `next_ingest_at` is null. Scorecard automation follows the configured
catalog-created grace behavior so newly added phones do not get scored before
review evidence exists.

### Why candidates can appear "not approved"

The expected automatic state progression is:

```text
discovered/pending_review
  -> enriched with complete trusted specs
  -> ready_to_promote/promote
  -> promoted
```

If a row remains `pending_review` or `quarantined`, it means the system has not
yet found enough trusted structured fields to satisfy `PhoneSpecSchema`. The
latest hardening fixed four approval blockers:

1. Incomplete MobileAPI listing rows were being counted as quarantined in logs
   but stored as `discovered`/`pending_review`. They now persist as
   `quarantined` with issue codes, so pending rows represent real unresolved
   candidates.
2. The auto runner executed Wikipedia/GSMArena enrichment before MobileAPI, so
   a later partial MobileAPI sync could put rows back into a weaker pending
   state. The order is now discovery -> MobileAPI -> OEM -> Wikipedia/GSMArena
   -> final promotion.
3. Wikipedia/GSMArena enrichment fetched `PhoneSpec` in the runtime
   snake_case shape but wrote it into the camelCase catalog claim slot. The
   projection gate interpreted that as missing fields. The script now converts
   `PhoneSpec` through `phoneSpecToCatalogProjectionInput` before promotion.
4. Wikidata duplicate bindings sometimes selected a contract manufacturer such
   as Foxconn as the brand for an iPhone. Discovery now prefers consumer OEM
   brands, OEM enrichment scans duplicate bindings for better official URLs, and
   the generic OEM page extractor prefers the staged consumer brand over
   contract-manufacturer metadata from product JSON-LD.

### Step 7: Scheduled GitHub Action

`.github/workflows/catalog-refresh.yml` runs a lightweight pass every Monday at
`01:17 UTC`, a full pass on the first day of each month at `01:47 UTC`, and
supports manual dispatch.

The weekly scheduled path is:

1. `catalog:backfill-identities`
2. `catalog:refresh --source wikidata`
3. `catalog:enrich-oem --from-candidates --promote --update-existing` with a
   small limit
4. optional `backfill-spec-embeddings.ts` when Gemini is configured
5. `catalog:report --days 35`

The monthly scheduled path also runs
`catalog:sync-mobileapi --promote --update-existing` when `MOBILEAPI_API_KEY` is
configured. If that optional secret is missing on a scheduled run, the workflow
emits a notice and continues with open sources. If a manual run requests
`source=both` or `source=mobileapi` and the secret is missing, the workflow fails
with a GitHub Actions error. Operators can intentionally avoid MobileAPI by
dispatching with `source=wikidata`. OEM enrichment can be disabled with the
workflow `oem_enrich=false` input.

---

## 1. Executive Decision

Build a new catalog-refresh pipeline above the existing review-ingestion and
scorecard systems.

The new pipeline should not push crawled data directly into `phones`. It should
stage every discovered device as a `catalog_candidate`, normalize it, dedupe it
against existing phones, validate it, and only then promote high-confidence
records into the canonical catalog. Once a phone is promoted, the existing
pipeline already knows what to do: `next_ingest_at = NULL` makes it eligible for
automated ingestion, and fresh chunks later nudge scorecard generation.

Recommended source strategy:

1. Primary discovery: Wikidata plus official OEM product catalogs/sitemaps.
2. Primary verification: official OEM product pages, structured metadata, and
   source-specific extractors.
3. Optional enrichment: a licensed structured device database such as
   MobileAPI.dev or PhoneArena database licensing.
4. Secondary cross-check only: GSMArena, Kimovil, DeviceSpecifications, etc.,
   when robots/terms allow. These should not be the only evidence for creating
   a canonical phone.
5. Media: use locally stored, license-approved assets where possible. Do not
   rely on arbitrary remote image URLs as the long-term product image.

This keeps the system automated while still treating the catalog as a
high-integrity database, not as a scrape dump.

---

## 2. Existing RECSY Context

Current relevant pieces:

| Area             | Current state                                                                                                                                                                                         | Catalog implication                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `phones`         | Canonical phone rows with `slug`, `brand`, `model`, `variant`, `tagline`, `launch_date`, `msrp_usd`, `image_url`, `status`, `spec_json`, `spec_embedding`, regions, ingest/scorecard schedule columns | The catalog pipeline should extend this rather than replace it.                               |
| `phone_aliases`  | Used by ingestion to match phone mentions in source titles                                                                                                                                            | New phones must generate alias rows immediately.                                              |
| Review ingestion | `pnpm ingest:auto`, DB-driven profiles, polite HTTP, curation, disambiguation, resumability via `ingest_runs`                                                                                         | New catalog rows should set `next_ingest_at = NULL` so daily ingest bootstraps them.          |
| Scorecard        | `pnpm scorecard:auto`, staleness guard, `scorecard_runs`, post-ingest nudge                                                                                                                           | Catalog should avoid scheduling scorecards before ingestion has a chance to collect evidence. |
| Images           | `phones.image_url` is currently a remote URL or null; UI falls back safely                                                                                                                            | Catalog should make `image_url` durable by preferring local storage URLs.                     |
| Specs            | `PhoneSpecSchema` is useful but not rich enough for all future metadata                                                                                                                               | Use a backward-compatible `spec_json` v2 shape and a separate configurations table.           |

Important existing behavior:

- `pickPhones()` treats `phones.next_ingest_at IS NULL` as immediately due.
- `ingest:auto` nudges `next_scorecard_at` when chunks are written.
- `runRecommendationPipeline` only loads `phones.status = 'active'`.
- `scorecard:auto` can write neutral scorecards for empty corpora, so new phones
  should not be scorecard-due before the first ingest opportunity.

---

## 3. Goals

1. Automatically discover and add newly released or upcoming phones.
2. Run monthly as the main refresh cadence, with manual dispatch for launch
   weeks or debugging.
3. Resume cleanly after a crash, quota issue, network failure, or partial DB
   write.
4. Avoid duplicate canonical phones.
5. Treat RAM/storage/color/regional SKUs as configurations of one phone, not as
   separate phones.
6. Store rich metadata now, even when only a subset is used by the UI.
7. Preserve source provenance and confidence for every important field.
8. Store durable, validated product images without depending on hotlinked URLs.
9. Avoid redundant external calls through hashes, ETags, request budgets, and
   source-level cursors.
10. Integrate with existing ingestion, spec embedding, scorecard, recommender,
    and browse flows.

---

## 4. Non-Goals

1. Do not build a price tracker or deal crawler in this phase.
2. Do not scrape every phone page on the public web.
3. Do not use an LLM to decide routine deterministic identity matches.
4. Do not auto-create phones from rumor pages without official or licensed
   corroboration.
5. Do not cache copyrighted images unless the source license or provider terms
   allow it.
6. Do not model used/refurbished marketplace variants.

---

## 5. Source Research Summary

| Source                                  | Use                                                                         | Strength                                                                                | Risk / limitation                                                              | Decision                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Official OEM product pages and sitemaps | Canonical names, official URLs, launch status, specs, images, MSRP, regions | Most authoritative source for the manufacturer's own claims                             | Fragmented HTML/templates; region pages differ; image reuse may be copyrighted | Primary verification source. Use per-brand profiles and fixtures.             |
| Schema.org `Product` JSON-LD/microdata  | Structured extraction from official/retail pages                            | Standard fields include `brand`, `model`, `image`, `gtin`, `sku`, `releaseDate`, offers | Many OEM pages omit fields or use marketing-only metadata                      | Parse when present, but validate and supplement.                              |
| Sitemaps                                | Efficient URL discovery and change detection                                | Standard XML with `loc` and optional `lastmod`; avoids crawling entire sites            | Some sites omit product URLs or set poor `lastmod` values                      | Use as first URL discovery mechanism for OEM sites.                           |
| Wikidata Query Service                  | Open discovery and cross-checking for known devices/QIDs                    | Programmatic SPARQL endpoint; useful for release date, brand, image candidates          | Not for fuzzy search; query limits; specs incomplete and community-maintained  | Primary open discovery, not sole spec source.                                 |
| Wikimedia Commons                       | Product image candidates with machine-readable metadata                     | API can return license, artist, credit, and license URL through `imageinfo` extmetadata | Not every phone has a usable image; attribution must be stored                 | Preferred free-media image source when quality is acceptable.                 |
| MobileAPI.dev                           | Optional structured specs/images API                                        | Docs claim 31,500+ devices, images, search, manufacturers, by-year endpoints            | Vendor dependency, limited free tier: 50 requests/month and 5 requests/minute  | Optional enrichment adapter behind an env flag with hard request/pacing caps. |
| PhoneArena specs database licensing     | Optional licensed database                                                  | Commercial database covers major brands/models and detailed specs                       | Requires licensing; not a free automated source                                | Consider if the project needs higher completeness.                            |
| GSMArena/Kimovil/DeviceSpecifications   | Secondary cross-check and source URL enrichment                             | Broad phone/spec coverage                                                               | Fragile scraping, unclear reuse rights, no official clean API for many cases   | Use only as secondary evidence and only through polite HTTP/robots gates.     |
| Google Custom Search JSON API           | Site-restricted URL resolver                                                | Official API supports CSE and `siterestrict` search                                     | API quotas and availability; not a data source                                 | Optional resolver only, not part of core pipeline.                            |

References used:

- Wikidata data access and WDQS guidance: https://www.wikidata.org/wiki/Help:Data_access
- Wikidata Query Service limits and User-Agent requirements: https://www.mediawiki.org/wiki/Wikidata_query_service/User_Manual
- Wikimedia User-Agent policy: https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
- Wikimedia Commons machine-readable image metadata: https://commons.wikimedia.org/wiki/Help:Machine-readable_data
- Schema.org Product fields: https://schema.org/Product
- Sitemaps protocol: https://www.sitemaps.org/protocol.html
- Supabase Storage and image transformations: https://supabase.com/docs/guides/storage and https://supabase.com/docs/guides/storage/serving/image-transformations
- MobileAPI.dev docs and limits: https://mobileapi.dev/docs/
- PhoneArena database licensing: https://www.phonearena.com/database

---

## 6. Source Selection Policy

### 6.1 Source tiers

Use source tiers to decide whether a candidate can be promoted.

| Tier                          | Examples                                                                                 | Trust                                          | Can create a new phone alone?                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| T0 official                   | Apple, Samsung, Google, OnePlus, Xiaomi, Nothing, Motorola product pages and press pages | Highest                                        | Yes, if identity and minimum specs validate.         |
| T1 open structured            | Wikidata, Wikimedia Commons metadata                                                     | High for identity/provenance, medium for specs | No by itself unless paired with another source.      |
| T2 licensed structured        | MobileAPI.dev, PhoneArena licensed database                                              | High if license active                         | Yes if license permits and required fields validate. |
| T3 editorial/spec aggregators | GSMArena, Kimovil, DeviceSpecifications, PhoneArena public pages                         | Medium                                         | No. Needs T0/T1/T2 corroboration.                    |
| T4 search/retail/social       | Google CSE, retailer pages, Reddit, YouTube mentions                                     | Low for catalog identity                       | Never. Discovery hints only.                         |

### 6.2 Promotion rule

Auto-promote a new phone only if one of these is true:

1. T0 official source confirms the product, and minimum required fields pass.
2. T2 licensed structured source confirms the product, and license permits use.
3. T1 plus T3 agree on brand, model, release year, and at least five core specs,
   and confidence is above the promotion threshold.

Otherwise keep the candidate staged as `pending_review`.

### 6.3 Minimum required fields for promotion

For `status = 'active'`:

- `brand`
- `model`
- `canonical_key`
- `slug`
- `launch_date` or `release_date`
- `region_availability` with at least one region, or `['GLOBAL_UNKNOWN']`
- valid `spec_json` with display size, chipset, RAM baseline, storage options,
  rear camera summary, front camera summary, battery, weight, OS, connectivity
- at least one durable identity: official URL, Wikidata QID, licensed provider
  device ID, or high-confidence external ID

For `status = 'upcoming'`, the source may be partial, but a row should only be
promoted into `phones` when the compatibility `PhoneSpec` projection is valid.
If official evidence is real but specs are still too incomplete, keep the
candidate staged as `pending_review` and let the next monthly/lightweight run
try again.

### 6.4 LLM call policy

The catalog pipeline should be non-LLM by default. The implemented foundation
keeps this visible in `catalog_runs.llm_call_count` and in CLI output.

Current implementation slice:

- `pnpm catalog:backfill-identities`: **0 LLM calls**.
- `pnpm catalog:refresh --source wikidata --since-years 2`: **0 LLM calls**.
- `pnpm catalog:import-specs --file <path> --promote`: **0 LLM calls**.
- `pnpm catalog:sync-mobileapi --since-years 2 --promote`: **0 LLM calls**.
- `pnpm catalog:enrich-oem --from-candidates --promote`: **0 LLM calls**.
- `pnpm catalog:enrich-gsmarena --limit 25`: **can make LLM calls**. The
  current script tries Wikipedia first, calls Gemini only when a real phone
  infobox/page is found, then falls back to GSMArena if accessible. The LLM
  output is not written directly; it must pass the same strict projection,
  validation, dedupe, and promotion gate as no-LLM sources.
- `pnpm catalog:promote --ready`: **0 LLM calls**.
- `pnpm catalog:report`: **0 LLM calls**.

Important limitation:

- Wikidata discovery can stage many recent phone candidates, but it does not
  provide enough structured specs to satisfy `PhoneSpecSchema`. Therefore those
  candidates are marked `pending_review` with `spec_projection_missing` and are
  not auto-promoted into `phones` by the Wikidata path.
- To auto-add as many phones as possible from the last two years without LLM
  calls, use `catalog:sync-mobileapi --since-years 2 --promote` with a
  MobileAPI key, or import a trusted structured JSON export with
  `catalog:import-specs --promote`. Promotion still blocks records whose
  structured fields do not satisfy `PhoneSpecSchema`.
- To automatically approve more staged phones when MobileAPI/OEM sources are
  incomplete, enable `GEMINI_API_KEY` and run `catalog:enrich-gsmarena --limit
N`. This uses LLM calls only for spec extraction from already matched
  Wikipedia/GSMArena source text.

Future LLM use, if enabled, is only for ambiguous identity disambiguation and is
budget-capped by `catalog_runs.max_llm_calls`. It must never be required for the
normal add/update path.

---

## 7. Data Model Changes

### 7.1 Modify `phones`

Add only fields that are needed for fast product behavior and dedupe. Keep
detailed provenance elsewhere.

```ts
// Nullable until the legacy backfill and source validation can derive it.
// Unique when present; it is an internal dedupe hint, not the public URL id.
canonicalKey: text('canonical_key').unique(),
family: text('family'),
generation: text('generation'),
officialUrl: text('official_url'),
announcedAt: timestamp('announced_at', { withTimezone: true }),
releasedAt: timestamp('released_at', { withTimezone: true }),
discontinuedAt: timestamp('discontinued_at', { withTimezone: true }),
catalogLastSeenAt: timestamp('catalog_last_seen_at', { withTimezone: true }),
lastCatalogRefreshAt: timestamp('last_catalog_refresh_at', { withTimezone: true }),
nextCatalogRefreshAt: timestamp('next_catalog_refresh_at', { withTimezone: true }),
metadataConfidence: numeric('metadata_confidence', { precision: 3, scale: 2 }),
specCompleteness: numeric('spec_completeness', { precision: 3, scale: 2 }),
mediaStatus: text('media_status'), // 'local_ok' | 'remote_only' | 'missing' | 'blocked'
```

Indexes:

```ts
uniqueIndex('phones_canonical_key_uniq').on(t.canonicalKey),
index('phones_catalog_last_seen_idx').on(t.catalogLastSeenAt),
index('phones_next_catalog_refresh_idx').on(t.nextCatalogRefreshAt),
```

Do not add large raw source blobs to `phones`.

### 7.2 New `catalog_runs`

One row per catalog job. This is separate from `ingest_runs` because catalog
refresh is about phone entities, not review sources.

Fields:

- `id uuid primary key`
- `kind text`: `monthly`, `manual`, `resume`, `dry_run`
- `status text`: `running`, `success`, `partial`, `failed`, `cancelled`
- `stage text`: current stage for resume visibility
- `checkpoint_json jsonb`: source cursors, page numbers, candidate offsets
- `started_at`, `finished_at`, `duration_ms`
- `created_count`, `updated_count`, `skipped_count`, `quarantined_count`
- `error text`
- `error_code text`
- `request_count integer`
- `llm_call_count integer`
- `max_wall_ms integer`
- `max_requests integer`
- `max_new_promotions integer`
- `max_llm_calls integer`

Default budgets:

- `max_wall_ms`: 40 minutes locally / GitHub Actions default.
- `max_requests`: 500 per monthly run, lower in dry-run/test modes.
- `max_new_promotions`: 20 per scheduled monthly run; manual runs can override
  with `--force-new`.
- `max_llm_calls`: 5 per run. Overflow becomes `pending_review`, not a hard
  job failure.

### 7.3 New `catalog_source_profiles`

DB-driven source configuration, similar in spirit to current
`domain_profiles`, `creator_profiles`, and `subreddit_profiles`.

Fields:

- `source_key text unique`: `wikidata`, `commons`, `apple-us`,
  `samsung-us`, `google-store-us`, `mobileapi`, etc.
- `type text`: `wikidata`, `oem_sitemap`, `oem_page`, `licensed_api`,
  `aggregator`, `search_api`
- `priority integer`
- `trust_weight numeric`
- `enabled boolean`
- `base_urls text[]`
- `sitemap_urls text[]`
- `allowed_url_patterns text[]`
- `robots_respected boolean`
- `rate_limit_ms integer`
- `monthly_request_budget integer`
- `last_polled_at timestamptz`
- `last_successful_at timestamptz`
- `cursor_json jsonb`
- `config_json jsonb`

Example config:

```json
{
  "brand": "Samsung",
  "regions": ["US", "GB", "IN"],
  "productUrlRegex": "/smartphones/galaxy-.+/",
  "extractor": "samsung-product-v1"
}
```

### 7.4 New `catalog_candidates`

Global staging table for every discovered device-like candidate. Candidates are
not scoped only to one run, because the same Wikidata QID or OEM URL will appear
every month. Each run updates the same candidate row and records `last_run_id`;
the row's content hash and snapshot pointer decide whether fetch/extraction work
is needed.

Fields:

- `id uuid primary key`
- `first_run_id uuid references catalog_runs(id)`
- `last_run_id uuid references catalog_runs(id)`
- `stable_key text`: `source_key:external_id` when available, otherwise
  `source_key:canonical_url_hash`
- `source_key text`
- `source_type text`
- `external_id text`
- `source_url text`
- `candidate_title text`
- `raw_candidate_json jsonb`
- `normalized_identity_json jsonb`
- `claims_json jsonb`: candidate-stage extracted claims; promoted fields are
  copied into `catalog_source_claims`
- `canonical_key text`
- `content_hash text`
- `last_snapshot_id uuid null`
- `matched_phone_id uuid null references phones(id)`
- `decision text`: `create`, `update`, `skip_duplicate`, `quarantine`,
  `pending_review`
- `status text`: `discovered`, `fetched`, `normalized`, `matched`,
  `validated`, `promoted`, `skipped`, `failed`
- `confidence numeric`
- `issue_codes text[]`
- `attempts integer`
- `seen_count integer`
- `retry_after timestamptz`
- `last_decision_at timestamptz`
- `last_error text`
- `created_at`, `updated_at`

Unique indexes:

```ts
unique('catalog_candidates_stable_key_uniq').on(t.stableKey),
unique('catalog_candidates_source_external_uniq').on(t.sourceKey, t.externalId),
index('catalog_candidates_status_idx').on(t.status),
index('catalog_candidates_canonical_key_idx').on(t.canonicalKey),
index('catalog_candidates_retry_idx').on(t.retryAfter),
```

Discovery upsert rule:

- If `(source_key, external_id)` or `stable_key` exists, update
  `last_run_id`, `seen_count`, `candidate_title`, `source_url`, and source raw
  metadata.
- Fetch/extract only when no prior successful snapshot exists, the source hash
  changed, source profile TTL expired, or the candidate is being forced.
- Do not create a fresh candidate row every monthly run.

### 7.5 New `phone_identities`

Durable external identity map. This is the dedupe backbone.

Fields:

- `id uuid primary key`
- `phone_id uuid references phones(id)`
- `source_key text`
- `external_id text`
- `url text`
- `identity_type text`: `official_url`, `wikidata_qid`, `mobileapi_id`,
  `gsmarena_slug`, `model_number`, `gtin`, `sku`
- `confidence numeric`
- `last_seen_at timestamptz`
- `created_at`

Unique indexes:

```ts
unique('phone_identities_source_external_uniq').on(t.sourceKey, t.externalId),
unique('phone_identities_type_value_uniq').on(t.identityType, t.externalId),
index('phone_identities_phone_idx').on(t.phoneId),
```

### 7.6 New `phone_configurations`

Configurations are not canonical phones.

Fields:

- `id uuid primary key`
- `phone_id uuid references phones(id)`
- `region text`
- `model_number text`
- `sku text`
- `gtin text`
- `ram_gb integer`
- `storage_gb integer`
- `color text`
- `network_variant text`
- `market_variant text`
- `sim_variant text`
- `price_amount numeric`
- `price_currency text`
- `availability_status text`
- `source_key text`
- `source_url text`
- `confidence numeric`
- `last_seen_at timestamptz`
- `created_at`, `updated_at`

Unique index:

```ts
unique('phone_configs_natural_uniq').on(
  t.phoneId,
  t.region,
  t.modelNumber,
  t.marketVariant,
  t.ramGb,
  t.storageGb,
  t.color,
);
```

### 7.7 New `catalog_source_claims`

Field-level provenance. This prevents future debugging from turning into
"where did this battery number come from?"

To control table growth, candidate-stage claims live in
`catalog_candidates.claims_json` while a candidate is being evaluated. Only
promoted/current claims, disputed claims, or claims used to explain a quality
issue are copied into this table.

Fields:

- `id uuid primary key`
- `phone_id uuid references phones(id)`
- `candidate_id uuid null references catalog_candidates(id)`
- `source_key text`
- `source_url text`
- `field_path text`: example `spec_json.battery_mah`
- `value_json jsonb`
- `unit text`
- `confidence numeric`
- `trust_weight numeric`
- `content_hash text`
- `is_current boolean`
- `is_disputed boolean`
- `observed_at timestamptz`
- `raw_snapshot_ref text`

Indexes:

```ts
index('catalog_claims_phone_field_idx').on(t.phoneId, t.fieldPath),
index('catalog_claims_candidate_idx').on(t.candidateId),
```

Retention:

- Keep current claims indefinitely.
- Keep disputed/blocker claims indefinitely while the phone is active.
- Prune non-current, non-disputed claims older than 180 days unless an internal
  audit UI links to them.

### 7.8 New `phone_media_assets`

Durable media registry.

Fields:

- `id uuid primary key`
- `phone_id uuid references phones(id)`
- `source_key text`
- `origin_url text`
- `storage_path text`
- `public_url text`
- `sha256 text`
- `perceptual_hash text`
- `mime_type text`
- `width integer`
- `height integer`
- `bytes integer`
- `license text`
- `license_url text`
- `attribution text`
- `rights_status text`: `cache_allowed`, `remote_only`, `blocked`,
  `unknown`
- `is_primary boolean`
- `status text`: `active`, `stale`, `failed`, `rejected`
- `last_checked_at timestamptz`
- `created_at`, `updated_at`

Unique indexes:

```ts
unique('phone_media_phone_sha_uniq').on(t.phoneId, t.sha256),
index('phone_media_phone_primary_idx').on(t.phoneId, t.isPrimary),
```

### 7.9 New `catalog_quality_issues`

Audit table for blocked promotions and suspicious field updates.

Fields:

- `id uuid primary key`
- `run_id uuid references catalog_runs(id)`
- `candidate_id uuid references catalog_candidates(id)`
- `phone_id uuid null references phones(id)`
- `severity text`: `info`, `warn`, `blocker`
- `code text`
- `message text`
- `field_path text`
- `source_key text`
- `created_at`

### 7.10 New `catalog_snapshots`

Durable source snapshot registry. Claims and candidates should never point to a
body reference that cannot be inspected during debugging.

Fields:

- `id uuid primary key`
- `source_key text`
- `url text`
- `canonical_url text`
- `content_hash text`
- `etag text`
- `last_modified text`
- `headers_json jsonb`
- `body_ref text`: optional Supabase Storage path such as
  `catalog-snapshots/{source_key}/{content_hash}.html.zst`
- `body_bytes integer`
- `content_type text`
- `status text`: `active`, `pruned`, `failed`
- `fetched_at timestamptz`
- `created_at`

Indexes:

```ts
unique('catalog_snapshots_source_hash_uniq').on(t.sourceKey, t.contentHash),
index('catalog_snapshots_url_idx').on(t.canonicalUrl),
index('catalog_snapshots_fetched_idx').on(t.fetchedAt),
```

Retention:

- Keep the latest snapshot per `(source_key, canonical_url)`.
- Keep snapshots linked to quarantined or disputed candidates.
- Prune unreferenced non-latest snapshots after 90 days.

---

## 8. Rich Metadata Contract

Store more than the UI needs today, but keep a strict compatibility boundary:
every promoted phone's `phones.spec_json` must parse with today's
`PhoneSpecSchema`. Browse, compare, recommender catalog loading, and spec
embeddings all depend on that shape today.

The catalog pipeline therefore writes:

1. A required `PhoneSpec` projection into `phones.spec_json`.
2. Rich source claims into `catalog_source_claims` and configuration/media
   tables.
3. Optional extension metadata under `spec_json._catalog` only if the write path
   uses a catalog-specific schema such as `CatalogPhoneSpecSchema =
PhoneSpecSchema.passthrough()`.

ADR 0018 must explicitly document this rule. Extended metadata is useful, but
it must never make `PhoneSpecSchema.parse(spec_json)` fail.

### 8.1 Identity

- Canonical brand
- Display brand/sub-brand
- Model name
- Family/series
- Generation/year
- Official URL
- External IDs: Wikidata QID, provider IDs, GSMArena slug, model numbers,
  GTIN/SKU where available
- Aliases and normalized search names

### 8.2 Lifecycle

- Announced date and precision
- Release date and precision
- Launch regions
- Current lifecycle status: upcoming, active, discontinued
- Last seen date per source
- Discontinued/end-of-sale date when known

### 8.3 Pricing and availability

- MSRP by region/currency
- Launch price source and date
- Availability regions
- Carrier/unlocked availability
- Price confidence and source

### 8.4 Configurations

- RAM options
- Storage options
- Colors
- SKUs/model numbers
- Regional/network variants
- SIM/eSIM variant
- Configuration-specific pricing and availability

### 8.5 Physical design

- Dimensions
- Weight
- Materials
- Colors
- IP rating
- Foldable style
- Hinge/display dimensions for foldables
- Stylus support

### 8.6 Display

- Size
- Resolution
- PPI
- Panel technology
- Refresh rate
- LTPO/variable refresh support
- Peak/HBM brightness
- Cover glass
- PWM/dimming notes if available

### 8.7 Chipset and memory

- Chipset
- CPU/GPU names where available
- Process node
- RAM baseline and RAM options
- RAM type
- Storage type
- Expandable storage

### 8.8 Cameras

- Rear cameras with type, megapixels, aperture, sensor size, focal length,
  OIS/EIS, zoom, autofocus
- Front cameras
- Video modes
- Camera partnerships/tuning, if source-backed

### 8.9 Battery and charging

- Battery capacity
- Wired charging watts
- Wireless charging watts
- Reverse wireless charging
- Charger-in-box note
- Battery chemistry if available

### 8.10 Connectivity

- Wi-Fi
- Bluetooth
- NFC
- UWB
- IR blaster
- USB type/speed
- 4G/5G bands by region when available
- SIM/eSIM
- Satellite/SOS support
- Positioning systems

### 8.11 Software and support

- Launch OS
- Skin/UI
- Update policy
- Security update policy
- Expected support end date if calculable
- Region caveats

### 8.12 Sensors and extras

- Fingerprint/Face unlock
- Speakers
- Haptics
- Headphone jack
- MicroSD
- SAR values where available
- Repairability/sustainability fields when available

### 8.13 Provenance and quality

- Field-level source claims
- Source confidence
- Last verified date
- Conflicting source notes
- Completeness score

### 8.14 PhoneSpec projection

Promotion has an explicit projection step:

```text
catalog source claims -> PhoneSpec compatibility projection -> optional extensions
```

Rules:

1. The projection must fill every required `PhoneSpecSchema` field before a
   phone can be promoted as `status='active'`.
2. For `status='upcoming'`, partial specs may be staged, but promotion to
   `phones` still requires a valid `PhoneSpec` projection. If the official
   source does not publish enough fields, keep the candidate `pending_review`
   instead of inventing placeholders.
3. Do not coerce unknown fields into required values. Example: a marketing
   claim like "all-day battery" is not a `battery_mah` value.
4. Preserve source-specific detail in claims/config/media tables, not by
   stuffing unvalidated blobs into `spec_json`.
5. Every promotion fixture must pass:

```ts
PhoneSpecSchema.parse(promoted.specJson);
```

6. Meaningful spec changes must null `phones.spec_embedding` so
   `spec-embed:backfill --phone <slug>` can regenerate the recommender vector.

---

## 9. Canonicalization and Duplicate Prevention

### 9.1 Definition of a canonical phone

A canonical `phones` row represents a distinct marketed phone model that a user
would compare against another phone.

Separate canonical phones:

- iPhone 16, iPhone 16 Plus, iPhone 16 Pro, iPhone 16 Pro Max
- Galaxy S25, Galaxy S25+, Galaxy S25 Ultra
- Pixel 9, Pixel 9 Pro, Pixel 9 Pro XL
- Redmi Note 14 Pro and Redmi Note 14 Pro+

Not separate canonical phones:

- 128 GB vs 256 GB vs 512 GB
- 8 GB RAM vs 12 GB RAM
- Black vs Blue
- US unlocked vs carrier SKU
- Same model with different regional model number, unless official branding
  and hardware meaningfully differ

### 9.2 Canonical key

Create a deterministic `canonical_key`, but keep v1 intentionally simple.
External identities are the strongest dedupe signal; the canonical key is an
internal hint and a collision guard, not the primary truth.

V1 format:

```text
{brand_normalized}:{model_normalized}:{launch_year}
```

Example keys:

```text
apple:iphone-16-pro-max:2024
samsung:galaxy-s25-ultra:2025
google:pixel-9-pro-xl:2024
samsung:galaxy-z-fold6:2024
xiaomi:redmi-note-14-pro-plus:2024
```

Do not derive fragile `family` / `model_tier` / `form_factor` keys in v1. Store
those fields when extractors can infer them, but tune them using quarantine data
before making them part of the key.

Store the display slug separately. The slug remains optimized for URLs:

```text
samsung-galaxy-s25-ultra
```

### 9.3 Normalization rules

Normalize identity before matching:

1. Unicode normalize, lower-case, trim whitespace.
2. Remove trademarks and punctuation noise.
3. Collapse whitespace and separators.
4. Normalize plus variants: `plus`, `+`, `Plus` all map to `plus`.
5. Preserve differentiators: `pro`, `pro max`, `ultra`, `plus`, `fe`, `se`,
   `fold`, `flip`, `a`, `e`, `r`, `5g` when part of official model identity.
6. Strip configuration tokens: storage sizes, RAM sizes, colors, carrier names,
   unlocked, dual SIM, region suffixes, model numbers.
7. Normalize year-in-parentheses into generation when official: `Moto G Power
5G (2025)`.

Do not blindly strip `5G`. Sometimes it is the model differentiator.

### 9.4 Match order

For each candidate:

1. Exact external identity match in `phone_identities`.
2. Exact official URL match.
3. Exact canonical key match.
4. Same brand plus normalized model plus release year.
5. Model number/GTIN/SKU association.
6. pg_trgm fuzzy match against `phones.brand || phones.model` and
   `phone_aliases.alias`.
7. LLM disambiguation only if deterministic scores are ambiguous.

### 9.5 Match confidence

Suggested scoring:

| Signal                                                    |        Score |
| --------------------------------------------------------- | -----------: |
| Same `phone_identities(source_key, external_id)`          |         1.00 |
| Same official URL after URL canonicalization              |         0.98 |
| Same canonical key                                        |         0.95 |
| Same Wikidata QID                                         |         0.95 |
| Same brand, normalized model, release year within 30 days |         0.92 |
| Same model number and brand                               |         0.90 |
| High trigram similarity plus matching release year        | 0.82 to 0.89 |
| Name similarity only                                      |     max 0.75 |

Promotion thresholds:

- `>= 0.92`: auto-update existing phone.
- `0.85 to 0.91`: auto-update only if no close competing match.
- `< 0.85`: do not update or create; quarantine or pending review.
- If top two candidates are within `0.08`, quarantine as ambiguous.

### 9.6 LLM disambiguation guardrail

Use a narrow structured prompt only for ambiguous cases. Inputs:

- candidate name/source URL
- existing candidate matches
- normalized tokens
- release dates
- known aliases
- model numbers

Output:

```ts
{
  action: 'same_phone' | 'new_phone' | 'configuration' | 'uncertain',
  phoneSlug?: string,
  confidence: number,
  reason: string
}
```

If the LLM returns `uncertain` or confidence below `0.85`, quarantine. Never let
the LLM override an exact external identity match.

Hard budget:

- `catalog_runs.max_llm_calls` defaults to 5.
- Once the run hits the budget, remaining ambiguous cases become
  `pending_review` with issue code `llm_budget_exhausted`.

### 9.7 Legacy phone backfill

Before the first real catalog refresh, existing seeded phones need canonical
identity data.

Add `scripts/backfill/canonical-keys.ts`:

1. Load all existing `phones`.
2. Derive v1 `canonical_key` from `brand`, `model`, and `launch_date`.
3. Upsert `phone_identities` rows:
   - `identity_type='legacy_slug'`, `source_key='recsy_seed'`,
     `external_id=phones.slug`.
   - `identity_type='canonical_key'`, `source_key='recsy_seed'`,
     `external_id=canonical_key`.
   - Manual official URLs / Wikidata QIDs where the seed already knows them or
     an operator-provided mapping exists.
4. Set `catalog_last_seen_at = now()`,
   `last_catalog_refresh_at = now()`, and an initial
   `metadata_confidence` / `spec_completeness`.
5. Fail the backfill if two active phones produce the same canonical key.

Matcher safety while backfill is incomplete:

- If an existing active phone has no `canonical_key`, treat it as a legacy row.
- Block auto-create when slug/model trigram similarity against a legacy row is
  above the duplicate threshold.
- Require the backfill before enabling the scheduled GitHub Actions workflow.

### 9.8 Auto alias generation

Add `src/services/catalog/aliases.ts`. This module must be conservative because
`phone_aliases` drives ingestion matching and disambiguation.

Alias tiers:

| Tier |  Priority | Examples                                                                     | Auto-seed rule                                                                    |
| ---- | --------: | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A    | 90 to 100 | `Samsung Galaxy S25 Ultra`, `Galaxy S25 Ultra`, official Wikidata/OEM labels | Always, if normalized alias is not assigned to another active phone.              |
| B    |  40 to 70 | `S25 Ultra`, `Pixel 9 Pro XL`, `Phone (3a) Pro`                              | Only if unique within brand family and not a substring of a longer sibling model. |
| C    |  10 to 30 | Abbreviations such as `S25U`, `P9 Pro XL`, `16 PM`                           | Only from a curated rule per brand/family or operator approval.                   |

Never auto-seed bare generation tokens such as `S25`, `16 Pro`, `Nord`, or
`Fold` unless a uniqueness check proves there is no active sibling collision
and no higher-priority alias would be shadowed.

On promotion:

1. Generate candidate aliases.
2. Normalize using the same lower-case/punctuation handling as the ingest alias
   matcher.
3. Check for collisions in `phone_aliases`.
4. Insert safe aliases.
5. Write `catalog_quality_issues` rows for rejected aliases with code
   `alias_collision` or `alias_too_broad`.

### 9.9 Market variants and regional editions

Most regional SKUs are configurations, not new phones. However, China-only or
market-exclusive devices can share a family name while changing chipset,
cameras, dimensions, or official model name.

Add `market_variant` to normalization and configuration handling:

- If the official page title, URL path, or source profile indicates a market
  edition (`/cn/`, `china`, `japan`, `global`, `india`, etc.), keep that marker
  in `normalized_identity_json`.
- If branding is identical and hardware deltas are minor, attach it as
  `phone_configurations.market_variant`.
- If chipset family, rear camera count/type, display size, or battery capacity
  differs beyond validation thresholds, quarantine for separate-phone review or
  create a separate canonical row when official evidence is clear.

---

## 10. Pipeline Flow

### 10.1 Schedule

Main cadence:

- Weekly lightweight discovery: Mondays at `01:17 UTC`, Wikidata staging plus
  limited official OEM enrichment, no MobileAPI calls.
- Monthly full refresh: first day of the month at `01:47 UTC`, including
  MobileAPI when the optional API key is configured.
- Manual dispatch: source, brand, limit, dry-run, resume, and force flags.

Reasoning:

- The current review ingest cron runs daily at `02:17 UTC`.
- Running catalog refresh at `01:17 UTC` lets new phones become ingest-due
  before the same day's ingest pass.
- The weekly job prevents a monthly-only cadence from missing launch-week
  devices while keeping licensed API usage at zero.
- The monthly job is the budgeted structured-source pass for deeper promotion.

### 10.2 CLI

Add:

```bash
pnpm catalog:refresh
pnpm catalog:refresh --dry-run
pnpm catalog:refresh --resume
pnpm catalog:refresh --source wikidata --limit 50
pnpm catalog:refresh --brand Samsung --limit 20
pnpm catalog:refresh --max-new 10 --max-requests 200 --max-wall-ms 1800000
pnpm catalog:report --days 30
pnpm catalog:promote --candidate <id>
```

### 10.3 Stage 0: schema guard and advisory lock

Before work:

1. Run schema guard for all catalog tables/columns.
2. Acquire a Postgres advisory lock such as `catalog_refresh`.
3. If `--resume`, load the latest `catalog_runs.status in ('partial','running','failed')`,
   preferring `partial` because it may already have promoted some candidates.
4. Otherwise create a new `catalog_runs` row.
5. Initialize run budgets from CLI flags or source profile defaults.

If another run is active, exit 0 with a clear message.

### 10.4 Stage 1: discovery

Discovery writes candidates only. It does not fetch full pages or write phones.
It upserts global `catalog_candidates` rows by `stable_key`, not by `(run_id,
source)` only.

Adapters:

1. `WikidataCatalogAdapter`
   - One bounded SPARQL query per run.
   - Scope to smartphones, relevant brands, and release/announcement dates in
     a rolling window.
   - Send a descriptive User-Agent and honor query limits/429.
   - Store QID, label, aliases, release date, manufacturer, official website,
     image property if present.

2. `OemSitemapCatalogAdapter`
   - Load `catalog_source_profiles` for enabled OEM sources.
   - Fetch sitemap indexes and sitemaps through polite HTTP.
   - Filter URLs through `allowed_url_patterns`.
   - Use `lastmod` plus source profile cursor to avoid re-fetching old pages.
   - Upsert URL candidates.

3. `MobileApiCatalogAdapter` (optional)
   - Enabled only when `MOBILEAPI_API_KEY` is set.
   - Use by-year and manufacturer endpoints with strict monthly request
     budgeting.
   - Prefer current and previous launch year, not full database scans.

4. `SearchResolverAdapter` (optional)
   - Site-restricted resolver for official product URLs only.
   - Never treated as source evidence by itself.

### 10.5 Stage 2: fetch source snapshots

For each candidate:

1. Look up the latest `catalog_snapshots` row for the candidate's canonical URL.
2. Skip if `content_hash` matches a recent successful snapshot and the prior
   promotion confidence is still above threshold.
3. Use `If-None-Match` and `If-Modified-Since` when prior headers exist.
4. Fetch full page/API payload through polite HTTP.
5. Store `catalog_snapshots` metadata and, when useful for debugging,
   compressed body in Supabase Storage.
6. Link `catalog_candidates.last_snapshot_id`.
7. Mark candidate `fetched`.

Do not store huge HTML bodies forever by default. Keep compressed snapshots only
for the latest run or for quarantined candidates that need debugging.

### 10.6 Stage 3: extraction and normalization

Extract fields in this order:

1. Source-specific extractor, if configured.
2. JSON-LD `Product` parser.
3. Open Graph/Twitter metadata for title/image hints.
4. HTML specs table parser.
5. Fallback text extraction only for source claims, not direct promotion.

Normalize:

- Units: mm, g, inches, Hz, nits, mAh, W.
- Currency: keep native currency and calculate USD only if explicitly needed.
- Dates: store precision, not just a fake day.
- Region: map source profile region into `region_availability`.
- Model strings: run canonical identity normalizer.

Write candidate-stage claims into `catalog_candidates.claims_json`. Copy only
promoted/current/disputed claims into `catalog_source_claims` during promotion.

### 10.7 Stage 4: matching and dedupe

Run the match algorithm from Section 9.
Use the ordered escape hatch: exact identities and canonical URL checks first,
then canonical key, then model-number/GTIN/SKU, and only then pg_trgm fuzzy
matching. Fuzzy matching should not run when an exact identity already resolved
the candidate.

Outcomes:

- `skip_duplicate`: candidate is already represented and has no new claims.
- `update`: candidate maps to an existing phone with useful new metadata.
- `create`: candidate is a new canonical phone.
- `configuration`: candidate is a configuration of an existing phone.
- `pending_review`: confidence or source evidence is not strong enough.
- `quarantine`: blocked by validation, source conflict, or ambiguity.

### 10.8 Stage 5: validation and quality gate

Run validation before promotion.

Hard blockers:

- Required fields missing.
- Invalid `PhoneSpecSchema` compatibility fields.
- Canonical key collides with a different high-confidence phone.
- Source URL disallowed by robots/profile.
- Future release date too far out unless official.
- Specs outside plausible ranges.
- `image_url` points to an unvalidated or non-image resource.
- Source conflict on identity: two high-trust sources disagree on whether the
  candidate is a separate model.

Soft warnings:

- No image available.
- No official URL but licensed source is present.
- Price missing.
- Region missing.
- Spec completeness below target but above minimum.
- Third-party and official specs differ.

Suggested plausibility ranges:

| Field             | Acceptable range                              |
| ----------------- | --------------------------------------------- |
| MSRP USD          | 50 to 3000                                    |
| Display size      | 3.0 to 9.0 inches                             |
| Refresh rate      | 30 to 240 Hz                                  |
| Battery           | 1000 to 10000 mAh                             |
| Weight            | 80 to 350 g                                   |
| Wired charging    | 0 to 240 W                                    |
| Wireless charging | 0 to 100 W                                    |
| RAM               | 1 to 32 GB                                    |
| Storage           | 16 to 4096 GB                                 |
| Rear camera MP    | 0.3 to 250 MP                                 |
| Launch date       | no more than 18 months future unless official |

### 10.9 Stage 6: media acquisition

See Section 11 for details. Media should run before promotion if a source image
is part of the candidate confidence, but lack of media should not block
otherwise good phone rows.

### 10.10 Stage 7: promotion transaction

Promote each validated candidate in one DB transaction:

1. Insert or update `phones`.
2. Upsert `phone_identities`.
3. Upsert `phone_configurations`.
4. Upsert `phone_aliases`.
5. Upsert `phone_media_assets`.
6. Copy candidate claims to `catalog_source_claims.phone_id`.
7. Update candidate status to `promoted`.

For new phones:

```ts
nextIngestAt: null,
lastIngestAt: null,
lastIngestStatus: null,
nextScorecardAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
specEmbedding: null,
```

Why `nextScorecardAt` is not null for new phones:

- In this repo, null means "eligible immediately," so null would make
  `scorecard:auto` race the first ingest attempt.
- A 7 day grace window gives repeated ingest/resume runs time to collect
  evidence.
- If ingestion writes chunks sooner, the existing ingest hook brings
  `next_scorecard_at` forward to roughly 24 hours after new evidence.
- Add a scorecard scheduler guard for fresh catalog-created phones:
  if `last_ingest_at IS NULL`, `catalog_last_seen_at IS NOT NULL`, and the phone
  was created recently, skip with `skipReason='first_ingest_pending'` and
  reschedule a few days later instead of writing neutral rows.

For changed specs:

- Set `spec_embedding = NULL`.
- Add the phone to a spec-embedding backfill queue or run a phone-specific
  `spec-embed:backfill --phone <slug>` follow-up.

### 10.11 Stage 8: reporting

`pnpm catalog:report --days 30` prints:

- Sources polled and request counts.
- Candidates discovered/fetched/promoted/quarantined.
- New phones created.
- Existing phones updated.
- Duplicate/configuration candidates skipped.
- Quality issue distribution.
- Media status distribution.
- Phones without images.
- Phones with low spec completeness.
- Stale catalog presence candidates and phones not seen in recent trusted OEM
  refreshes.

### 10.12 Global candidate dedupe

Across runs, discovery should update existing candidates instead of creating
run-local duplicates.

Rules:

1. Build `stable_key` from `(source_key, external_id)` when an external ID
   exists.
2. Otherwise build it from `(source_key, canonical_url_hash)`.
3. Upsert `catalog_candidates` by `stable_key`.
4. Store `last_run_id` and `seen_count`.
5. Skip fetch/extract when the latest snapshot is unchanged and the candidate
   has no unresolved issue codes.
6. If the same source URL maps to a different canonical key than last month,
   quarantine with `source_identity_changed`.

### 10.13 Lifecycle and discontinued phones

Phones should never be hard-deleted because old recommendations, source chunks,
and scorecards may still reference them.

Lifecycle rule:

- If an active phone is not seen in trusted official/OEM sources for 3
  consecutive monthly runs, has `launch_date` older than 2 years, and still has
  no recent source confirming active sale, set `status='discontinued'`.
- Write `catalog_quality_issues` with code `stale_catalog_presence` before the
  status change.
- Do not discontinue phones purely because Wikidata or an aggregator omitted
  them in one run.

---

## 11. Image and Media Strategy

### 11.1 Requirements

1. Product image must not break when a source URL changes.
2. We should not hotlink third-party images as the long-term primary image.
3. We should not cache images unless license/provider terms allow it.
4. Every cached image must retain attribution and origin metadata.
5. UI should still degrade gracefully with the existing placeholder.

### 11.2 Preferred image source order

1. Licensed structured API image, if terms allow caching/display.
2. Wikimedia Commons image with extmetadata license/credit captured.
3. Official OEM press/media asset when reuse terms allow caching/display.
4. Official OEM product-page image as remote-only fallback if terms are unclear.
5. Placeholder.

### 11.3 Media workflow

For each candidate image:

1. Canonicalize URL and remove tracking parameters.
2. If a media asset with the same origin URL and known SHA already exists for
   the phone, skip HEAD/GET unless the media TTL expired.
3. HEAD request through polite HTTP.
4. Validate content type, bytes, and cache headers.
5. If source is Wikimedia Commons, fetch `imageinfo&iiprop=extmetadata` and
   store license, license URL, artist, credit, and copyright status.
6. If source is licensed API, store provider license reference.
7. If source is OEM, require a `rights_status` decision from the source
   profile. Default is `remote_only`.
8. Download only if `rights_status = 'cache_allowed'`.
9. Validate image dimensions and decodeability.
10. Compute SHA-256 and perceptual hash.
11. Upload original to Supabase Storage:

```text
phone-media/{phone_id}/{sha256}.{ext}
```

12. Let Supabase Storage transformations serve resized variants.
13. Set `phones.image_url` to the local public storage URL only when a primary
    cached asset is valid.
14. Otherwise store the remote image in `phone_media_assets` but leave
    `phones.image_url` null or use a previously validated local image.

### 11.4 Validation checks

Reject images when:

- Non-image content type.
- Less than 300 px on the longest edge.
- More than 5 MB unless explicitly allowed.
- Decode fails.
- Looks like a logo-only image when product photo is required.
- License/rights status is `blocked` or `unknown` for caching.
- Perceptual hash matches a known wrong image for another product.

### 11.5 Stale image handling

Monthly:

- HEAD-check remote origins for active media assets.
- If local cached copy exists, origin failure is only a warning.
- If primary image is remote-only and fails, clear `phones.image_url` and fall
  back to placeholder.
- Never delete old local images immediately; mark stale and prune after 180
  days if not referenced.
- Run an orphan object scan before pruning Supabase Storage paths. SHA-based
  paths make this safe and cheap.

### 11.6 Rendering contract

`PhoneImage` currently uses a native `<img>` and works with Supabase public
storage URLs without `next/image` remote patterns. Keep that path for catalog
images.

If a future UI path switches back to `next/image`, add the project's Supabase
storage hostname to `next.config.ts` `images.remotePatterns` when the bucket URL
is known. Do not block catalog media on a Next.js image optimizer allowlist.

---

## 12. Redundant Call Avoidance

Catalog refresh must be cheap by design.

Mechanisms:

1. Source-level monthly request budgets in `catalog_source_profiles`.
2. Persisted per-source cursors and `last_successful_at`.
3. Wikidata filters on recent release/announcement dates plus any available
   modified-date or last-seen cursor in `cursor_json`.
4. Sitemap `lastmod` filtering where available.
5. Global URL -> snapshot map across runs.
6. HTTP `ETag` and `Last-Modified` reuse.
7. Content hash pre-check before extraction.
8. Skip extraction if the snapshot hash is unchanged and the prior promoted
   metadata confidence remains above threshold.
9. Candidate URL/stable-key dedupe before fetch.
10. One bounded Wikidata query per run.
11. Optional MobileAPI requests only for current/previous launch years and
    only when the monthly budget allows. The sync CLI defaults to
    `--max-requests 50`, persisted month-to-date usage from `catalog_runs`, and
    `--min-request-gap-ms 12500`, so cumulative usage stays within the free
    plan's 50 requests/month and 5 requests/minute limits.
12. A single shared MobileAPI budget counter in the orchestrator, not
    per-adapter local counters.
13. No LLM call in normal discovery, extraction, validation, or matching.
14. LLM disambiguation only for ambiguous identity cases, capped by run budget.
15. Run pg_trgm fuzzy matching only after exact identity, URL, key, and SKU
    matching fail.
16. Skip image HEAD/GET when the same origin URL and SHA are already known.
17. Image hash dedupe before upload.
18. Store source claims so unchanged fields are not reprocessed downstream.

Expected monthly request profile for low-budget mode:

| Source                        |            Expected calls |
| ----------------------------- | ------------------------: |
| Wikidata SPARQL               |                    1 to 3 |
| OEM sitemap indexes           |                  10 to 30 |
| Changed/new OEM product pages |                 10 to 100 |
| Wikimedia metadata            | only for image candidates |
| MobileAPI                     |          0 unless enabled |
| LLM                           |                 usually 0 |

---

## 13. Resumability and Failure Handling

### 13.1 State machine

Candidate statuses:

```text
discovered -> fetched -> normalized -> matched -> validated -> promoted
```

Terminal or operator-paused statuses:

```text
promoted
skipped
pending_review
quarantine
failed
```

Do not add separate status values such as `failed_transient`,
`rate_limited`, or `quota_exhausted`. Use `status='failed'` plus
`error_code`, `issue_codes`, and `retry_after`. Permanent vs retriable failure
is derived from those fields. `pending_review` and `quarantine` are not retried
automatically unless an operator changes the decision or passes a force flag.

### 13.2 Resume behavior

`pnpm catalog:refresh --resume`:

1. Finds the latest unfinished `catalog_runs` row, preferring `partial` over
   `failed` over `running`.
2. Reuses `checkpoint_json`.
3. Skips already terminal or operator-paused candidates.
4. Retries candidates where `retry_after IS NULL OR retry_after <= now()`.
5. Reuses stored content hashes and snapshots.
6. Continues from the first incomplete stage.
7. Never double-promotes: promotion upserts by `phone_identities`, slug, and
   canonical key; already-promoted candidates are terminal.

### 13.3 Idempotency keys

Use these natural keys:

- Candidate: `(source_key, external_id)` when external ID exists.
- Candidate fallback: `(source_key, canonical_url_hash)`.
- Snapshot: `(source_key, content_hash)`.
- Phone identity: `(source_key, external_id)`.
- Source claim: `(phone_id, source_key, source_url, field_path, content_hash)`.
- Media: `(phone_id, sha256)`.
- Configuration: `(phone_id, region, model_number, ram_gb, storage_gb, color)`.

### 13.4 Transaction boundaries

Use small transactions:

- Candidate insert/upsert: one transaction per source batch.
- Candidate stage update: one transaction per candidate.
- Promotion: one transaction per phone/candidate.
- Media upload: outside DB transaction, then DB transaction records result.

If media upload succeeds but DB write fails, the next resume detects the same
SHA and attaches it.

Throughput note:

- Keep promotion per candidate in v1. With the scheduled cap of 10 to 20 new
  promotions, correctness is more valuable than batching complexity.
- If promotion volume grows, batch validated candidates in groups of 5 with
  per-candidate savepoints or equivalent rollback isolation. Do not let one bad
  candidate abort the whole group.

### 13.5 Error classification

Reuse the spirit of ingestion error classification:

- `rate_limit`: set `retry_after` from `Retry-After` or backoff.
- `network_error`: retry in the same or next resume run.
- `not_found`: permanent for that URL, but not necessarily for the phone.
- `schema_error`: quarantine candidate or extractor bug.
- `source_changed`: extractor fixture needs update.
- `license_blocked`: terminal for media caching, not for phone creation.
- `ambiguous_identity`: pending review.
- `validation_failed`: quarantine.

---

## 14. Integration With Existing Pipelines

### 14.1 Ingestion

On new phone promotion:

- Insert aliases.
- Set `next_ingest_at = NULL`.
- Existing daily `ingest:auto` picks it up.
- Existing `ingest:auto --resume-failed` handles quota/rate-limit retries.

No new coupling is required in the ingestion orchestrator.

Optional hot-launch bootstrap:

- If `CATALOG_BOOTSTRAP_INGEST=1`, the catalog job is running in GitHub Actions,
  and a promoted phone is `status='active'` with launch date within the hot-tier
  window, dispatch `.github/workflows/ingest-on-new-phone.yml` via the GitHub
  API/`gh workflow run`.
- This requires workflow `permissions: actions: write`.
- Keep it env-flagged so local dry-runs and forks do not trigger network
  workflows.
- Dispatch at most 5 bootstrap jobs per catalog run; the normal daily
  `ingest:auto` remains the fallback.

### 14.2 Scorecard

On new phone promotion:

- Set `next_scorecard_at = now + 7d`, not null. In this repo null means "due
  now."
- If ingestion writes chunks, existing post-ingest hook brings it forward to
  around 24h after evidence appears.
- Add a scorecard scheduler guard for fresh catalog-created phones:
  `last_ingest_at IS NULL AND catalog_last_seen_at IS NOT NULL AND
created_at > now() - interval '14 days'` should skip with
  `skipReason='first_ingest_pending'` and reschedule. This avoids neutral rows
  before the first ingest has had a fair chance.
- If ingestion repeatedly finds no evidence, scorecard can eventually write
  honest neutral rows after the grace window.

### 14.3 Recommender

For `status = 'active'` phones:

- Candidate appears in recommender once promoted.
- If no scorecard exists yet, existing no-scorecard honesty behavior applies.
- Specs should be valid enough that spec-only ranking is meaningful.

For `status = 'upcoming'` phones:

- Ingest can pre-warm evidence.
- Recommender currently excludes them because it loads active phones only.

### 14.4 Browse and compare

Browse and compare continue reading `phones` and `spec_json`.

Future enhancement:

- Expose `phone_configurations` in compare details, but do not block this phase.

### 14.5 Spec embeddings

Add a phone-specific spec embedding command:

```bash
pnpm spec-embed:backfill --phone <slug>
```

Catalog promotion should enqueue or invoke this for:

- New phone.
- Meaningful spec change.
- Canonical identity change.

### 14.6 Shared URL and HTTP utilities

Do not duplicate URL canonicalization across catalog and review ingestion.

- Extract or reuse shared helpers for `canonicalUrl()`, tracking-param removal,
  robots-aware polite HTTP, ETag/Last-Modified handling, and host rate limits.
- `src/services/catalog/http.ts` can wrap and re-export
  `src/services/ingest/http.ts` behavior where practical.
- Reuse GSMArena URL normalization/discovery ideas only as T3 cross-checks; do
  not fork a second incompatible GSMArena URL parser.

### 14.7 Operator notification

The pipeline should be quiet on normal no-op runs and loud when automation is
stuck.

Minimum v1:

- `catalog:report` exits 0 but prints a high-signal warning when quarantined
  candidates exceed a threshold.
- Internal pipeline page shows pending/quarantined catalog candidates.

Optional:

- Slack/email notification when `quarantine` count exceeds `CATALOG_ALERT_THRESHOLD`
  or when the latest scheduled run ends `failed`/`partial`.

---

## 15. Implementation Phases

### Phase 0: ADR, docs, and legacy backfill

Files:

- `docs/adr/0018-automated-phone-catalog-refresh.md`
- `docs/ingest/README.md` or new `docs/catalog/README.md`
- `docs/RECSY_V2_PROJECT_CONTEXT.md`
- `docs/RECSY_V2_PROJECT_GUIDE.md`
- `scripts/backfill/canonical-keys.ts`

Decision to capture:

- Staged catalog candidates.
- Source tiering.
- Canonical phone vs configuration.
- License-gated media caching.
- Monthly schedule before ingestion.
- `PhoneSpec` projection compatibility.
- Canonical key v1 and legacy backfill.

Outcome:

- Existing seeded phones have `canonical_key`, seed identities, and
  `catalog_last_seen_at`.
- Scheduled catalog refresh remains disabled until this backfill passes.

### Phase 1: schema, snapshots, and global dedupe

Files:

- `src/services/db/schema.ts`
- `drizzle/migrations/XXXX_catalog_refresh.sql`
- `drizzle/rls.sql`

Add:

- `catalog_runs`
- `catalog_source_profiles`
- `catalog_candidates`
- `catalog_snapshots`
- `phone_identities`
- `phone_configurations`
- `catalog_source_claims`
- `phone_media_assets`
- `catalog_quality_issues`
- new `phones` columns from Section 7.1

RLS:

- Public anon read should not expose operational catalog tables.
- `phones`, existing public tables remain as they are.

Verification:

```bash
pnpm db:generate
pnpm db:setup
pnpm db:smoke
pnpm typecheck
```

Outcome:

- Global candidate upsert keys exist.
- Snapshot refs are durable.
- Catalog operational tables are private under RLS.

### Phase 2: pure identity, validation, and PhoneSpec projection

Files:

- `src/services/catalog/identity.ts`
- `src/services/catalog/canonical-key.ts`
- `src/services/catalog/spec-normalize.ts`
- `src/services/catalog/spec-project.ts`
- `src/services/catalog/validation.ts`
- `src/services/catalog/confidence.ts`
- `src/services/catalog/types.ts`

Tests:

- `identity.test.ts`
- `canonical-key.test.ts`
- `spec-normalize.test.ts`
- `spec-project.test.ts`
- `validation.test.ts`
- `confidence.test.ts`

Coverage must include:

- iPhone storage variants.
- Galaxy base/plus/ultra separation.
- Pixel Pro vs Pro XL separation.
- Redmi/Poco/Xiaomi sub-brand naming.
- `5G` preserved when differentiating.
- Motorola year-in-parentheses models.
- Bad specs rejected.
- Every promoted fixture passes `PhoneSpecSchema.parse()`.

### Phase 3: Wikidata discovery, matcher, and dry-run promotion

Files:

- `src/services/catalog/http.ts` or reuse `src/services/ingest/http.ts`
- `src/services/catalog/source-profiles.ts`
- `src/services/catalog/snapshots.ts`
- `scripts/seed/catalog-source-profiles.ts`
- `src/services/catalog/adapters/wikidata.ts`
- `src/services/catalog/matcher.ts`
- `src/services/catalog/candidates.ts`
- `src/services/catalog/issues.ts`
- `src/services/catalog/promote.ts`
- `src/services/catalog/orchestrator.ts`

Design:

- Prefer reusing `makePoliteHttp`.
- Add source request budgeting.
- Add ETag/Last-Modified handling.
- Add source cursor persistence.
- Implement matcher before broad OEM extraction so legacy dedupe is proven.
- Dry-run promotion writes no `phones` changes but prints exact create/update/
  config/quarantine decisions.

Tests:

- Existing identity exact match.
- New phone create decision.
- Configuration decision.
- Ambiguous duplicate quarantine.
- Resume skips terminal candidates.
- Dry-run promotion does not mutate `phones`.

### Phase 4: one OEM brand end-to-end

Files:

- `src/services/catalog/adapters/oem-sitemap.ts`
- `src/services/catalog/adapters/oem-product.ts`
- `src/services/catalog/adapters/index.ts`

Scope:

- Start with one brand, preferably Google or Samsung.
- Prove sitemap -> product page -> extraction -> `PhoneSpec` projection ->
  match/promote using fixtures.
- Do not implement six OEM extractors in parallel; template drift will dominate
  operational cost.

Fixture tests:

- Store sample sitemap indexes.
- Store official product page fixtures for the selected brand.
- Store JSON-LD product fixtures.

Do not write integration tests that depend on live external services.

### Phase 5: media pipeline, Commons first

Files:

- `src/services/catalog/adapters/commons.ts`
- `src/services/catalog/media.ts`
- `src/services/catalog/media-license.ts`
- `src/services/catalog/storage.ts`

Behavior:

- Validate license before caching.
- Upload to Supabase Storage.
- Record all media metadata.
- Update `phones.image_url` only for valid local primary assets.
- Keep catalog UI rendering on native `<img>`.

Tests:

- Commons license metadata accepted.
- Unknown OEM rights defaults to remote-only.
- Invalid MIME rejected.
- Duplicate SHA skips upload.

### Phase 6: alias generator and ingest bootstrap hook

Files:

- `src/services/catalog/aliases.ts`
- `src/services/catalog/bootstrap-ingest.ts`
- `.github/workflows/catalog-refresh.yml` update for optional dispatch

Behavior:

- Generate conservative aliases with collision checks.
- Write quality issues for skipped aliases.
- Optionally dispatch `ingest-on-new-phone.yml` for hot active promotions when
  `CATALOG_BOOTSTRAP_INGEST=1`.
- Keep `next_ingest_at = NULL` as the primary bootstrap mechanism.

Tests:

- Bare generation aliases are rejected unless unique.
- Existing alias collisions are logged, not overwritten.
- Bootstrap dispatch is skipped without env flag.

### Phase 7: remaining OEMs and optional licensed API

Files:

- Additional `catalog_source_profiles` seeds.
- Additional OEM extractor fixtures.
- `src/services/catalog/adapters/mobileapi.ts`

Behavior:

- Add one brand/source at a time.
- Keep MobileAPI or other licensed APIs optional and budgeted.
- Aggregators remain T3 cross-checks only.

### Phase 8: GitHub Actions, reporting, and review UI

Files:

- `.github/workflows/catalog-refresh.yml`
- `.github/workflows/catalog-discover.yml` optional lightweight scout
- `scripts/catalog-refresh.ts`
- `scripts/catalog-report.ts`
- `scripts/backfill-spec-embeddings.ts` update for `--phone`
- `package.json`

Behavior:

- Monthly workflow runs capped budgets:

```yaml
on:
  schedule:
    - cron: '17 1 1 * *'
  workflow_dispatch:
```

Scheduled workflow:

1. Secrets gate.
2. Install Node/pnpm.
3. Run schema guard.
4. Run `pnpm exec tsx scripts/catalog-refresh.ts --limit 150 --max-new 20`.
5. Run `pnpm exec tsx scripts/catalog-report.ts --days 30`.

Concurrency:

```yaml
concurrency:
  group: catalog-refresh
  cancel-in-progress: false
```

Review UI:

- Add `/internal/pipeline/catalog` or extend existing internal pipeline page.
- Show pending/quarantined candidates.
- Show source claims for a phone.
- Show image/license status.
- Allow copyable SQL/CLI commands for manual promotion.

---

## 16. File Summary

| File                                               | Action       | Purpose                                                   |
| -------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `src/services/db/schema.ts`                        | Modify       | Catalog tables and `phones` metadata fields               |
| `drizzle/migrations/XXXX_catalog_refresh.sql`      | New          | Generated migration                                       |
| `drizzle/rls.sql`                                  | Modify       | Keep catalog ops tables private                           |
| `src/services/catalog/types.ts`                    | New          | Shared catalog types                                      |
| `src/services/catalog/identity.ts`                 | New          | Name/config token normalization                           |
| `src/services/catalog/canonical-key.ts`            | New          | Canonical key generation                                  |
| `src/services/catalog/spec-normalize.ts`           | New          | Unit/spec mapping into `spec_json`                        |
| `src/services/catalog/spec-project.ts`             | New          | Claim-to-`PhoneSpecSchema` projection                     |
| `src/services/catalog/validation.ts`               | New          | Hard/soft quality gates                                   |
| `src/services/catalog/confidence.ts`               | New          | Source and match confidence scoring                       |
| `src/services/catalog/snapshots.ts`                | New          | Snapshot hashing, storage refs, ETag/Last-Modified        |
| `src/services/catalog/aliases.ts`                  | New          | Conservative alias generation and collision checks        |
| `src/services/catalog/bootstrap-ingest.ts`         | New          | Optional `ingest-on-new-phone` workflow dispatch          |
| `src/services/catalog/adapters/*.ts`               | New          | Wikidata/OEM/Commons/MobileAPI adapters                   |
| `src/services/catalog/matcher.ts`                  | New          | Dedupe and config detection                               |
| `src/services/catalog/media.ts`                    | New          | Media validation pipeline                                 |
| `src/services/catalog/storage.ts`                  | New          | Supabase Storage integration                              |
| `src/services/catalog/promote.ts`                  | New          | Transactional phone promotion                             |
| `src/services/catalog/orchestrator.ts`             | New          | End-to-end catalog run                                    |
| `scripts/catalog-refresh.ts`                       | New          | CLI for monthly/manual refresh                            |
| `scripts/catalog-report.ts`                        | New          | Operator digest                                           |
| `scripts/backfill/canonical-keys.ts`               | New          | One-time legacy phone canonical key and identity backfill |
| `scripts/seed/catalog-source-profiles.ts`          | New          | Supported source configs                                  |
| `scripts/backfill-spec-embeddings.ts`              | Modify       | Add `--phone` flag                                        |
| `package.json`                                     | Modify       | Add `catalog:*` scripts                                   |
| `.github/workflows/catalog-refresh.yml`            | New          | Monthly automation                                        |
| `.github/workflows/catalog-discover.yml`           | Optional New | Weekly lightweight discovery scout                        |
| `docs/adr/0018-automated-phone-catalog-refresh.md` | New          | Architecture decision                                     |
| `docs/catalog/README.md`                           | New          | Operator guide                                            |

---

## 17. Verification Plan

### 17.1 Unit tests

```bash
pnpm test src/services/catalog
```

Required tests:

- Identity normalization.
- Canonical key generation.
- Configuration detection.
- Legacy canonical-key backfill collision detection.
- `PhoneSpecSchema` projection from claims.
- Match confidence scoring.
- Plausibility validation.
- Source tier promotion rules.
- Media license handling.
- Alias generation and collision rejection.
- Resume state transitions.
- Global candidate dedupe by `stable_key`.

### 17.2 Fixture tests

Run adapters against local HTML/JSON fixtures:

```bash
pnpm test src/services/catalog/adapters
```

Assertions:

- Official product fixtures extract expected fields.
- Schema.org Product parser handles JSON-LD arrays and graphs.
- Sitemap parser respects `lastmod`.
- Wikidata response maps QID, label, aliases, release date.
- Commons image metadata stores license and attribution.
- Snapshot fixtures preserve `content_hash`, headers, and body refs.
- Promoted fixture specs pass `PhoneSpecSchema.parse()`.

### 17.3 Local dry run

```bash
pnpm catalog:refresh --dry-run --limit 20
```

Expected:

- Creates a `catalog_runs` row.
- Upserts global staged candidates and updates `last_run_id`.
- Makes no changes to `phones`.
- Prints source request counts and candidate decisions.

### 17.4 Promotion smoke test

Use a fixture-only candidate:

```bash
pnpm catalog:refresh --source fixture --limit 1
```

Expected DB checks:

```sql
SELECT slug, canonical_key, next_ingest_at, next_scorecard_at
FROM phones
WHERE slug = '<new-phone-slug>';

SELECT alias FROM phone_aliases
WHERE phone_id = (SELECT id FROM phones WHERE slug = '<new-phone-slug>');

SELECT source_key, external_id FROM phone_identities
WHERE phone_id = (SELECT id FROM phones WHERE slug = '<new-phone-slug>');
```

Expected:

- `next_ingest_at` is null.
- `next_scorecard_at` is roughly 7 days in the future unless ingestion already
  wrote chunks and nudged it earlier.
- Aliases exist.
- Identity rows exist.

### 17.5 Resume test

1. Run catalog refresh with an injected failure after fetch.
2. Confirm candidates are not promoted.
3. Re-run with `--resume`.
4. Confirm the run continues without rediscovering/refetching unchanged pages.
5. Confirm a `partial` run with one promoted candidate does not double-promote
   that candidate on resume.

### 17.6 Duplicate test

Create staged candidates:

- `iPhone 16 Pro 128GB`
- `iPhone 16 Pro 256GB`
- `iPhone 16 Pro Max`

Expected:

- First two map to the same phone with two configuration rows.
- Pro Max maps to a separate phone.
- Auto-generated aliases do not include unsafe bare aliases that collide with
  siblings.

### 17.7 Media test

Expected:

- Commons image with license metadata is cached and becomes local `image_url`.
- OEM image with unknown rights is recorded as `remote_only` and does not
  overwrite local `image_url`.
- Broken image URL is rejected and logged as a quality issue.

### 17.8 Existing pipeline integration test

After promoting a fixture phone:

```bash
pnpm ingest:auto --dry-run --limit 5
```

Expected:

- The new phone appears in picked phones because `next_ingest_at` is null.
- The new phone is not immediately scored before first ingest because
  `next_scorecard_at` is delayed and the scheduler guard handles fresh
  catalog-created phones.

---

## 18. Operational Queries

Recent run summary:

```sql
SELECT status, stage, created_count, updated_count, quarantined_count, request_count, started_at, finished_at
FROM catalog_runs
ORDER BY started_at DESC
LIMIT 10;
```

Quarantined candidates:

```sql
SELECT candidate_title, source_key, confidence, issue_codes, last_error
FROM catalog_candidates
WHERE decision IN ('quarantine', 'pending_review')
ORDER BY updated_at DESC
LIMIT 50;
```

Duplicate/config decisions:

```sql
SELECT decision, count(*)
FROM catalog_candidates
WHERE created_at > now() - interval '30 days'
GROUP BY decision
ORDER BY count(*) DESC;
```

Phones missing durable images:

```sql
SELECT slug, brand, model, media_status, image_url
FROM phones
WHERE status = 'active'
  AND (image_url IS NULL OR media_status IS DISTINCT FROM 'local_ok')
ORDER BY brand, model;
```

Low completeness:

```sql
SELECT slug, spec_completeness, metadata_confidence
FROM phones
WHERE status = 'active'
  AND (spec_completeness IS NULL OR spec_completeness < 0.75)
ORDER BY spec_completeness NULLS FIRST;
```

New phones waiting for first ingest:

```sql
SELECT slug, created_at, next_ingest_at, last_ingest_status
FROM phones
WHERE status IN ('active', 'upcoming')
  AND last_ingest_at IS NULL
ORDER BY created_at DESC;
```

---

## 19. Risk Register

| Risk                                            | Severity | Mitigation                                                                                   |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| Duplicate phones from storage/RAM/color configs | High     | Canonical key, `phone_configurations`, config-token stripping, unique identities             |
| `PhoneSpecSchema` mismatch after promotion      | High     | Mandatory projection layer and fixture tests that parse promoted specs                       |
| Alias collisions from auto-generation           | High     | Tiered alias rules, uniqueness checks, quality issues for rejected aliases                   |
| Copyright issues from cached images             | High     | License-gated media cache; unknown OEM images are remote-only                                |
| Polluting `phones` with rumors or bad specs     | High     | Staging, source tier rules, validation, quarantine                                           |
| Fragile source templates                        | Medium   | Fixture tests per source, versioned extractors, quarantine on schema drift                   |
| Monthly cadence misses launch-day devices       | Medium   | Manual dispatch, optional weekly lightweight scout, env-flagged hot ingest bootstrap         |
| Monthly rediscovery/re-extraction waste         | Medium   | Global candidate stable keys plus snapshot hash short-circuit                                |
| GH Actions timeout on large promote batch       | Medium   | Run budgets, max-new cap, staged workflow split if needed                                    |
| Wikidata incomplete/stale                       | Medium   | Use for discovery/cross-check only, not sole spec evidence                                   |
| Licensed API cost/vendor lock-in                | Medium   | Optional adapter; pipeline works in official/open-source mode                                |
| Scorecard races before first ingest             | Medium   | New phones get `next_scorecard_at = now + 7d`; scheduler skip guard for fresh catalog phones |
| Source request overuse                          | Medium   | Budgets, ETag/Last-Modified, content hashes, cursors                                         |
| LLM wrong on ambiguous identity                 | Medium   | LLM only after deterministic ambiguity; low confidence quarantines                           |
| Two operators run manual and scheduled catalog  | Medium   | Advisory lock and workflow concurrency                                                       |
| Supabase storage orphan objects                 | Low      | SHA paths, 180d prune, orphan scan before delete                                             |
| Spec schema grows too large                     | Low      | Keep query-critical columns small; store rich details in JSON plus claims                    |
| Catalog operational tables grow                 | Low      | Prune old snapshots and old non-blocker quality issues after retention window                |

---

## 20. Senior Engineering Review Pass

This section is the critical review of the plan as if it came from another
engineer. The fixes listed here are already folded into the plan above.

### Finding 1: "Just scrape GSMArena monthly" is not robust enough

Severity: High

Problem:

GSMArena-like sites are useful references, but making them the primary source
creates legal, operational, and data-shape risk. They may not offer stable APIs,
HTML can change, and reuse rights are unclear.

Fix incorporated:

The plan uses official/OEM, Wikidata, Commons, and optional licensed APIs as the
core. Aggregators are secondary cross-check sources only.

### Finding 2: Directly inserting discovered phones would pollute the DB

Severity: High

Problem:

Any automated source will occasionally produce partial, duplicate, regional, or
wrong records. Writing these straight to `phones` would damage recommender and
browse quality.

Fix incorporated:

All candidates go through `catalog_candidates`, validation, source claims,
confidence scoring, and promotion transactions. Low-confidence candidates stay
pending or quarantined.

### Finding 3: The "same phone" rule needs a data model, not just code

Severity: High

Problem:

Without a configuration table, the system will either lose storage/RAM/color
data or accidentally create duplicate phones.

Fix incorporated:

`phone_configurations` stores SKU/RAM/storage/color/region data. `phones`
remains one canonical row per user-comparable model.

### Finding 4: Product images are a legal and durability trap

Severity: High

Problem:

Caching arbitrary official or third-party images may violate reuse rights, but
hotlinking them is brittle.

Fix incorporated:

The media pipeline has explicit rights states. Only cache `cache_allowed`
images. Wikimedia Commons metadata and licensed provider terms are captured.
Unknown OEM images are not promoted to local cached `image_url`.

### Finding 5: New phones might get neutral scorecards before ingestion

Severity: Medium

Problem:

If a new phone has `next_scorecard_at = NULL`, the scorecard cron might run
before review ingestion and write neutral rows.

Fix incorporated:

New phones get `next_scorecard_at = now + 7d`; review ingestion still gets
`next_ingest_at = NULL`. If ingestion writes chunks, the existing hook brings
scorecard timing forward. The scorecard scheduler also gets a
`first_ingest_pending` skip guard for fresh catalog-created phones.

### Finding 6: Monthly-only cadence can miss high-profile launches

Severity: Medium

Problem:

Phones launch throughout the month. A strict monthly cadence means a product
can be absent for weeks.

Fix incorporated:

The baseline remains monthly as requested, but the design includes manual
dispatch and leaves room for a future weekly lightweight discovery scout that
does not run expensive enrichment.

### Finding 7: Overusing LLMs would make the pipeline expensive and unstable

Severity: Medium

Problem:

LLMs are unnecessary for most identity matching and could hallucinate.

Fix incorporated:

All normal extraction, normalization, validation, and matching is deterministic.
LLM disambiguation is only used for ambiguous identity cases and cannot override
exact source identities.

### Finding 8: Rich metadata can become untraceable

Severity: Medium

Problem:

A large `spec_json` blob without provenance makes it impossible to audit why a
field changed.

Fix incorporated:

`catalog_source_claims` stores field-level source, value, confidence, content
hash, and observed time.

### Finding 9: Optional paid API could silently become a hard dependency

Severity: Medium

Problem:

MobileAPI or PhoneArena licensing might improve completeness, but the project
should still run without paid services.

Fix incorporated:

Licensed APIs are optional adapters behind env vars and request budgets. The
official/open-source mode is the default.

### Finding 10: Source pages change, so extractors need regression fixtures

Severity: Medium

Problem:

OEM page templates will change and silently break parsing.

Fix incorporated:

Every source adapter requires HTML/JSON fixtures and extractor tests. Schema
drift quarantines candidates instead of promoting partial data.

### Finding 11: `spec_json` v2 can break existing consumers

Severity: High

Problem:

The current app reads `phones.spec_json` through `PhoneSpecSchema`. A rich v2
blob that does not project into that schema would break browse, compare,
recommendations, and spec embeddings.

Fix incorporated:

Promotion now has a mandatory claim-to-`PhoneSpec` projection step. Extended
metadata stays in claims/config/media tables or optional passthrough metadata,
and every promotion fixture must parse with `PhoneSpecSchema`.

### Finding 12: Legacy phones need identity backfill first

Severity: High

Problem:

Seeded phones currently lack catalog identities. Enabling a monthly refresh
without backfill risks duplicate active phones.

Fix incorporated:

Phase 0 now includes `scripts/backfill/canonical-keys.ts`, seed identities, and
a hard requirement that scheduled catalog refresh stays disabled until the
legacy backfill passes without collisions.

### Finding 13: Run-scoped candidates waste work every month

Severity: Medium

Problem:

If candidates are unique only per `run_id`, every monthly run rediscovers the
same QIDs and URLs as fresh rows.

Fix incorporated:

`catalog_candidates` is now global with `stable_key`, `first_run_id`,
`last_run_id`, `seen_count`, and snapshot short-circuiting.

### Finding 14: Snapshot references need a real storage contract

Severity: Medium

Problem:

Claims with `raw_snapshot_ref` are useless if there is no table/object layout
that survives resume and debugging.

Fix incorporated:

The plan now includes `catalog_snapshots` plus a Supabase Storage layout and
retention policy.

### Finding 15: Auto aliases can damage ingestion precision

Severity: High

Problem:

Short aliases such as `S25` or `16 Pro` can match the wrong sibling model and
increase disambiguator load.

Fix incorporated:

Alias generation is now its own conservative module with tiered priorities,
collision checks, and quality issues for skipped aliases.

### Finding 16: `next_scorecard_at = NULL` would be a regression

Severity: Medium

Problem:

In this repo, null `next_scorecard_at` means "eligible now." Using null as a
"wait for ingest" sentinel would make scorecard generation race the first
catalog-triggered ingestion.

Fix incorporated:

New catalog phones use a 7-day scorecard grace window, and the scorecard
scheduler gets an explicit `first_ingest_pending` skip guard for fresh
catalog-created phones.

### Finding 17: One monolithic monthly workflow can time out

Severity: Medium

Problem:

Full discovery, extraction, media, promotion, and reporting for hundreds of
phones can exceed hosted runner budgets.

Fix incorporated:

`catalog_runs` now carries wall-clock, request, promotion, and LLM budgets.
Scheduled runs cap new promotions and the plan allows a weekly lightweight
discovery workflow.

---

## 21. Final Recommended Build Order

1. Write ADR 0018, `docs/catalog/README.md`, and the legacy canonical-key
   backfill.
2. Add schema tables, snapshot storage, global candidate dedupe, migrations,
   and RLS.
3. Build pure identity, canonical-key v1, validation, and `PhoneSpec`
   projection modules.
4. Add Wikidata discovery, matcher, candidate state machine, and dry-run
   promotion.
5. Add one OEM brand end-to-end with fixtures before expanding sources.
6. Add Commons-first media pipeline with license gate and Supabase Storage.
7. Add conservative alias generation and optional hot-launch
   `ingest-on-new-phone` dispatch.
8. Add remaining OEMs and optional licensed API adapters one at a time.
9. Add `catalog:refresh`, `catalog:report`, `spec-embed:backfill --phone`, and
   GitHub Actions with capped budgets.
10. Add internal dashboard/pending review view and optional notifications.

The most important design choice is the staging boundary. Once that exists,
sources can improve over time without risking the production catalog.
