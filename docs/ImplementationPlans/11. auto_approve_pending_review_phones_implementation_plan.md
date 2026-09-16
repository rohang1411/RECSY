# Automate Catalog Refresh & Ease Spec Validation

This plan addresses the automation of the catalog pipeline and the relaxation of the `PhoneSpecSchema` validation to allow more phones to be automatically promoted out of `pending_review`.

## Open Questions

> [!IMPORTANT]
> **OEM Scraping**: You mentioned fetching from OEM websites first. Currently, there is no logic in the system to scrape specs directly from OEM sites (Apple, Samsung, Xiaomi, etc.). Building a universal OEM scraper is highly brittle because every manufacturer's website is different and changes frequently.
>
> **Question**: Is it acceptable to rely entirely on our licensed structured API (`MobileAPI`) as the automated source for full specifications, instead of building brittle OEM scrapers? (If you meant a specific site like GSMArena, please let me know, though our GSMArena adapter is currently only used for fetching text reviews, not structured specs).

## Proposed Changes

### 1. Easing `PhoneSpecSchema`

I ran a dry-run of the MobileAPI sync against the database. The results showed that all candidates were blocked from promotion because the MobileAPI payload frequently omits several strict fields.

To safely ease the validation without breaking the product, I will make the following fields optional in `src/features/phones/schema.ts` (as they shouldn't fundamentally break the recommender UI):

#### [MODIFY] `src/features/phones/schema.ts`

- `DisplaySchema.refresh_rate_hz`: make `.optional()`
- `DisplaySchema.panel_type`: make `.optional()`
- `ChargingSchema.wired_w` and `wireless_w`: make `.optional()`
- `ConnectivitySchema.wifi`, `bluetooth`, `nfc`: make `.optional()`
- `PhoneSpecSchema.front_camera`: make `.optional()`
- `PhoneSpecSchema.rear_cameras`: make `.optional()` or `.default([])`
- `PhoneSpecSchema.weight_g`: make `.optional()`
- `PhoneSpecSchema.os`: make `.optional()`

### 2. Automating the Pipeline (`catalog-auto.ts`)

To make this process completely automated and run regularly without manual intervention, I will create a new scheduled automation script.

#### [NEW] `scripts/catalog-auto.ts`

- Create an automated script that orchestrates the refresh flow:
  1. Runs `discoverRecentWikidataPhones()` to find new phone metadata.
  2. Runs the MobileAPI sync (`fetchRecords`) to fetch the full structured specifications for these new phones.
  3. Promotes the candidates automatically if they pass the (eased) `PhoneSpecSchema`.
- This script will respect the `MOBILEAPI_FREE_MONTHLY_REQUESTS` budget and `MOBILEAPI_FREE_MIN_GAP_MS` to ensure we do not get rate-limited or banned from the API.

#### [MODIFY] `package.json`

- Add a new npm script: `"catalog:auto": "tsx --env-file=.env.local scripts/catalog-auto.ts"`.

## Verification Plan

### Automated Tests

- Run `pnpm typecheck` to ensure schema changes do not break downstream code.
- Run `pnpm catalog:auto --dry-run` to verify that the script correctly orchestrates discovery and MobileAPI fetching, and that phones now successfully pass validation.

### Manual Verification

- Execute `pnpm catalog:auto` and verify that the pending phones are successfully moved from `pending_review` to `promoted` status in the DB and are visible in the Pipeline UI.
