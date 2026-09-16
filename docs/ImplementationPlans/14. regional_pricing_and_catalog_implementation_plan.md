# Regional Pricing & Catalog Customization — Implementation Plan v2

> **Status**: Draft · **Reviewers**: Engineering, Design, Product  
> **Last Updated**: 2026-05-20 · **Scope**: US + India launch; extensible to N regions

---

## Table of Contents

1. [Goal & Problem Statement](#1-goal--problem-statement)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Deep-Dive Flaw Analysis](#3-deep-dive-flaw-analysis)
4. [Database Design](#4-database-design)
5. [Backend & API Architecture](#5-backend--api-architecture)
6. [LLM Pipeline Integration](#6-llm-pipeline-integration)
7. [Frontend Architecture & Data Flow](#7-frontend-architecture--data-flow)
8. [UI/UX — Region Selector Design](#8-uiux--region-selector-design)
9. [Catalog Ingestion Pipeline Updates](#9-catalog-ingestion-pipeline-updates)
10. [Exchange Rate Strategy](#10-exchange-rate-strategy)
11. [Performance & Caching Strategy](#11-performance--caching-strategy)
12. [Security Considerations](#12-security-considerations)
13. [SEO & Metadata Localization](#13-seo--metadata-localization)
14. [Accessibility & i18n Considerations](#14-accessibility--i18n-considerations)
15. [Migration & Rollout Strategy](#15-migration--rollout-strategy)
16. [Verification Plan](#16-verification-plan)
17. [File Change Summary](#17-file-change-summary)

---

## 1. Goal & Problem Statement

RECSY currently shows all prices in **USD** (`phones.msrp_usd`) and makes no distinction between markets. This is hardcoded across the entire stack — from the DB schema, to LLM prompts, to UI formatting functions. The system is used globally and needs to:

1. **Auto-detect the user's country** via server-side IP headers (zero blocking latency, no geo-permissions required).
2. **Persist region in a cookie** for SSR consistency across page navigations — preventing hydration mismatches.
3. **Display localized prices** in the user's local currency, with correct locale-specific number formatting (e.g., Indian lakh/crore format: `₹1,19,999`).
4. **Filter the catalog** to only surface phones officially available in the user's market.
5. **Adapt the LLM recommender** to interpret user-specified budgets in local currency (e.g., _"under 50k"_ = ₹50,000 in India, not $50,000).
6. **Support manual region override** through an artful, premium UI.
7. **Be fully extensible** — adding a third region (UK, EU, UAE, etc.) should require zero schema changes and minimal code additions.

---

## 2. System Architecture Overview

```
User Request
     │
     ▼
┌─────────────────────────────────┐
│  Next.js Edge Middleware        │  ← Detects region from x-vercel-ip-country
│  src/middleware.ts              │    or cf-ipcountry, writes recsy_region cookie
└──────────────┬──────────────────┘
               │ cookie: recsy_region=IN
               ▼
┌─────────────────────────────────┐
│  Next.js Server Components      │  ← Reads cookie via next/headers, passes
│  (layout, pages, AppHeader)     │    RegionConfig to child components as prop
└──────────────┬──────────────────┘
               │ regionCode
               ▼
┌─────────────────────────────────┐
│  Service Layer                  │  ← Catalog query joins phone_regional_details
│  loadRecommendationCatalog(db,  │    for region-specific price & availability
│    regionCode)                  │
│  browseWhereFromState(filter,   │
│    regionCode)                  │
└──────────────┬──────────────────┘
               │ PhoneCatalogEntry w/ localPrice
               ▼
┌─────────────────────────────────┐
│  LLM Recommender Pipeline       │  ← Budget extracted in local currency
│  extractUserRequirements(llm,   │    match.ts compares local price vs budget
│    message, region)             │
└─────────────────────────────────┘
```

---

## 3. Deep-Dive Flaw Analysis

### 3.1 🔴 CRITICAL: Hydration Mismatch — Server/Client Region Disagreement

**Root Cause**: If region detection happens on the client (e.g., in a `useEffect` calling an IP API), the server renders default USD prices. The client then changes them to INR. React's reconciliation detects `$799 → ₹65,900` mismatches and throws uncaught hydration errors.

**Observed code**: `src/app/browse/page.tsx` line 74 calls `formatUsdFromNumericString(p.msrpUsd)` directly in a server component with no region context. Same in `compare/page.tsx` (line 303), `p/[slug]/page.tsx` (line 51), and `RecommendationCard` in `recommend-client.tsx` (line 536).

**Fix**: Region detection MUST happen in Next.js Middleware before the server component tree renders. The middleware writes the cookie before the response body. All server components read it via `cookies()` from `next/headers`. The client never computes region independently — it relies on what the server embedded in the rendered HTML.

---

### 3.2 🔴 CRITICAL: Budget Filtering Compares Apples to Oranges

**Root Cause**: In `src/services/recommender/match.ts` lines 157–171, the `passesHardFilters` function reads `requirements.budget_usd?.max` and compares it against `entry.msrpUsd` — both in USD. If an Indian user says _"under ₹50,000"_ and the LLM extracts `budget_usd.max = 50000`, the filter will pass nearly every phone (since most phones cost < $50,000 USD) rather than filtering to phones under ~₹50,000 (~$600 USD).

**The inverse is equally broken**: A user in India budgeting ₹80,000 might be filtered to zero phones because the LLM interprets "80,000" as $80,000 USD and nothing in the catalog costs that.

**Fix**:

1. Rename the concept to `budget_local` carrying `{ min, max, currency }`.
2. When loading the catalog, always return `localPrice` (the resolved price in the region's currency, whether official or estimated from exchange rate).
3. The `passesHardFilters` function must compare `budget_local` against `entry.localPrice` using the same currency.

---

### 3.3 🔴 CRITICAL: LLM Prompt Hardcodes USD

**Root Cause**: `src/services/recommender/extract-requirements.ts` line 33: `"Infer budget in USD when the user mentions price"`. This prompt will misbehave for any non-USD region.

**Fix**: The system prompt must dynamically inject the active currency and its contextual examples (e.g., _"Users in India typically budget between ₹15,000 for entry-level to ₹1,50,000 for flagship"_).

---

### 3.4 🔴 CRITICAL: `PhoneCatalogEntry` Has No Local Price Field

**Root Cause**: `src/services/recommender/catalog.ts` defines `PhoneCatalogEntry` with `msrpUsd: string | null` only. There is nowhere to attach regional price to a catalog entry. The `ScoredCandidate` type in `match.ts` also only has `msrpUsd`. The `RecommendApiPick` in `run-recommendation.ts` exposes `msrpUsd` to the frontend.

**Fix**: Add `localPrice: string | null` and `localCurrency: string` to all three types. The full propagation chain is: `PhoneCatalogEntry → ScoredCandidate → RecommendApiPick → ApiPick (client)`.

---

### 3.5 🟡 HIGH: `BrowseFilterState` URL Schema is USD-Hardcoded

**Root Cause**: `src/features/browse/search-params.ts` defines `minPriceUsd` and `maxPriceUsd` as the URL parameters `?min=` and `?max=`. The docstring says _"USD MSRP bounds"_. The `BrowseFiltersForm` labels them _"Min price USD"_ / _"Max price USD"_. The `browseWhereFromState` in `query.ts` compares them directly against `phones.msrp_usd`.

**Fix**: When region is IN, the URL params `?min=` and `?max=` should be treated as INR bounds. The DB query must join `phone_regional_details` and compare against the local price column, not `msrp_usd`. Rename the state fields to `minPrice` / `maxPrice` (currency-agnostic). The filter form label should dynamically show the active currency symbol.

---

### 3.6 🟡 HIGH: `run-recommendation.ts` Calls `loadRecommendationCatalog` Without Region

**Root Cause**: Line 159: `const fullCatalog = await loadRecommendationCatalog(input.db)`. The catalog loader has no region awareness. This means the Indian recommendation engine uses USD prices and includes phones not available in India.

**Fix**: Pass `regionCode` through the entire call chain: `POST /api/recommend` → `runRecommendationPipeline` → `loadRecommendationCatalog`.

---

### 3.7 🟡 HIGH: `recommendationTurns.extractedRequirements` Will Store Stale Currency Context

**Root Cause**: The extracted requirements (including `budget_usd`) are serialized to DB in `recommendationTurns.extracted_requirements` (see `route.ts` line 115). On multi-turn sessions, these are loaded back by `getLatestRequirementsForSession` in `session.ts`. If the user changes their region mid-session, the requirements from the previous turn carry the old currency, causing incorrect comparisons.

**Fix**: Store `regionCode` alongside `extractedRequirements` in the session turn. When loading previous requirements, if the region has changed, treat prior budget context as stale and re-extract fresh requirements for the new region.

---

### 3.8 🟡 HIGH: Compare Page Shows "MSRP USD" Label Regardless of Region

**Root Cause**: `src/app/compare/page.tsx` line 300: `metricRow('MSRP USD', ...)`. The compare table will always say "MSRP USD" and display USD prices. An Indian user comparing phones should see `MSRP INR` and ₹ prices.

**Fix**: The compare page server component must read the `recsy_region` cookie, join regional details, and dynamically label the price row with the active currency (e.g., `MSRP INR`).

---

### 3.9 🟡 HIGH: The Recommender `RecommendationCard` Initial Prompt Text is USD-Centric

**Root Cause**: `recommend-client.tsx` line 40: `"great camera, under $700, strong battery, not too heavy"`. This example is USD-centric.

Also line 395 — the `textarea` placeholder: `"Under $700, great camera, long battery, not too heavy..."`.

**Fix**: Make the placeholder dynamic based on active region. Indian users should see: _"Great camera, under ₹50,000, long battery..."_.

---

### 3.10 🟡 HIGH: Initial Chat Line is USD-Centric

**Root Cause**: `recommend-client.tsx` lines 37–41 shows: `"Just describe the phone you want... any price preference. For example: great camera, under $700..."`.

**Fix**: This needs to be region-aware. Since `recommend-client.tsx` is a `'use client'` component, it cannot directly read cookies. The parent server component should pass the region as a prop.

---

### 3.11 🟠 MEDIUM: Cookie-Based Region Change Doesn't Refresh Page Data

**Root Cause**: When a user changes their region via the selector UI (client action), we write a new `recsy_region` cookie via a fetch to a new API route `/api/set-region`. But the currently displayed data (prices, catalog, prices in filter form) was rendered server-side based on the _old_ region cookie. A full page reload is required.

**Fix**: After setting the region cookie via `/api/set-region`, do a `window.location.reload()` or a `router.refresh()` (Next.js App Router approach). This triggers a server re-render with the new cookie, giving the user the correct regionalized data.

---

### 3.12 🟠 MEDIUM: No Exchange Rate Staleness Indicator

**Root Cause**: The plan proposes using a hardcoded exchange rate (e.g., 1 USD = 83.5 INR). If we hardcode this in `src/lib/regions.ts`, it will become wrong over time.

**Fix**: Introduce a `src/lib/exchange-rates.ts` module that:

- Stores a last-known rate with a `lastUpdatedAt` timestamp.
- Is updated by a periodic background script (e.g., `scripts/update-exchange-rates.ts`) that fetches from a free API (e.g., `https://open.er-api.com/v6/latest/USD`).
- Stores rates in an environment variable or a tiny DB table (`exchange_rates`).
- Marks estimated prices clearly in the UI with a small disclaimer: _"Estimated price · converted from USD"_.

---

### 3.13 🟠 MEDIUM: `AppHeader` is a Server Component but Region Selector Needs Client Interactivity

**Root Cause**: `src/components/AppHeader.tsx` is a pure Server Component (no `'use client'` directive). The region selector requires client-side state (dropdown open/close, hover effects, animation). This means we need to carefully split the header into a server wrapper + client island for the region button.

**Fix**: Create a `RegionSelectorButton` client component. The parent server component (`AppHeader`) reads the cookie and passes the current `RegionConfig` as a prop. The client component handles the UI interaction and calls the API to persist changes.

---

### 3.14 🟠 MEDIUM: Catalog Filter by Availability is Not Implemented

**Root Cause**: The original plan mentions filtering phones by regional availability but `browseWhereFromState` has no such filter. Currently, all `active` phones appear regardless of their availability in a specific market.

**Fix**: When `regionCode !== 'US'` (i.e., a non-default region), the browse query should:

1. `INNER JOIN phone_regional_details` on `phone_id` and `country_code`.
2. Filter by `is_available = true`.
   This ensures only officially-available-in-India phones show up for Indian users.
   For the US region, fall back to the current behavior (all `active` phones).

---

### 3.15 🟢 LOW: The `INITIAL_LINES` Array in `recommend-client.tsx` Cannot Be Dynamic

**Root Cause**: `INITIAL_LINES` is defined as a module-level constant at line 37–42 and always contains a USD example. It cannot reference a runtime cookie value since it runs at module load time.

**Fix**: Convert `INITIAL_LINES` from a constant to a function `getInitialLines(regionConfig: RegionConfig): ChatLine[]` and call it during component initialization.

---

### 3.16 🟢 LOW: SEO & Open Graph Metadata is Not Region-Aware

**Root Cause**: `src/app/layout.tsx` sets a static meta description: _"phone picks... grounded in real reviews"_. This content is not localized for Indian users (language, example prices, etc.).

**Fix**: Generate dynamic metadata (description, keywords) at the page level based on the detected region for key pages like `/browse` and `/recommend`.

---

## 4. Database Design

### 4.1 New Table: `phone_regional_details`

This table decouples country-specific data from the core `phones` table, enabling N-country support without schema migrations.

```typescript
// src/services/db/schema.ts — ADD this table
export const phoneRegionalDetails = pgTable(
  'phone_regional_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** FK to phones.id — cascade deletes regional data when a phone is removed. */
    phoneId: uuid('phone_id')
      .notNull()
      .references(() => phones.id, { onDelete: 'cascade' }),

    /** ISO 3166-1 alpha-2 country code. e.g. 'US', 'IN', 'GB' */
    countryCode: text('country_code').notNull(),

    /** Official launch price in the local currency. NULL = not officially priced. */
    price: numeric('price', { precision: 12, scale: 2 }),

    /** ISO 4217 currency code. e.g. 'USD', 'INR', 'GBP'. Redundant with countryCode but
     *  denormalized for fast display without joining the regions config. */
    currency: text('currency').notNull(),

    /** Whether the phone is officially sold in this market.
     *  false = discontinued or never launched in this region. */
    isAvailable: boolean('is_available').notNull().default(true),

    /** Regional official product or buy page URL (e.g. samsung.com/in). */
    officialUrl: text('official_url'),

    /** Source of this record: 'catalog_pipeline', 'manual', 'estimated' */
    priceSource: text('price_source').notNull().default('catalog_pipeline'),

    /** Whether price is official or a USD → local-currency estimate. */
    isEstimated: boolean('is_estimated').notNull().default(false),

    /** Exchange rate used if is_estimated=true. Stored for audit trail. */
    exchangeRateUsed: numeric('exchange_rate_used', { precision: 10, scale: 6 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Primary deduplication: one row per phone per country
    uniqueIndex('phone_regional_details_phone_country_uniq').on(t.phoneId, t.countryCode),
    // Index for "give me all phones for country X" queries (browse, catalog)
    index('phone_regional_details_country_available_idx').on(t.countryCode, t.isAvailable),
    // Index for the catalog refresh pipeline to find phones missing regional data
    index('phone_regional_details_phone_idx').on(t.phoneId),
  ],
);
```

### 4.2 New Table: `exchange_rates`

Stores periodically refreshed FX rates to avoid hardcoding.

```typescript
// src/services/db/schema.ts — ADD this table
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    /** e.g. 'USD', 'INR' */
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: numeric('rate', { precision: 14, scale: 8 }).notNull(),
    source: text('source').notNull().default('open.er-api.com'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('exchange_rates_pair_uniq').on(t.baseCurrency, t.quoteCurrency)],
);
```

### 4.3 Schema Migration Steps

```bash
# 1. Generate the Drizzle migration
pnpm db:generate

# 2. Apply to dev DB
pnpm db:migrate

# 3. Backfill US data: for all existing phones, create a phone_regional_details row
#    with countryCode='US', currency='USD', price=msrp_usd, isEstimated=false
pnpm run scripts/backfill-regional-us.ts

# 4. Seed estimated IN data: for phones where no IN row exists,
#    create one with isEstimated=true using USD price * current exchange rate
pnpm run scripts/seed-regional-india-estimates.ts
```

---

## 5. Backend & API Architecture

### 5.1 Central Region Registry: `src/lib/regions.ts` (NEW)

```typescript
/**
 * Central region registry — add new regions here, nowhere else.
 * Each entry drives DB queries, LLM prompts, UI formatting, and middleware.
 */
export interface RegionConfig {
  readonly countryCode: string; // ISO 3166-1 alpha-2
  readonly currency: string; // ISO 4217
  readonly symbol: string; // Display symbol: '$', '₹'
  readonly locale: string; // BCP 47 locale for Intl.NumberFormat
  readonly label: string; // Display name: 'United States'
  readonly flag: string; // Emoji flag
  readonly budgetExampleMax: number; // Example budget used in recommender prompt
  readonly budgetExampleLabel: string; // Human label e.g. '₹50,000' or '$700'
  readonly searchPlaceholder: string; // Recommender textarea placeholder
}

export const REGIONS: Record<string, RegionConfig> = {
  US: {
    countryCode: 'US',
    currency: 'USD',
    symbol: '$',
    locale: 'en-US',
    label: 'United States',
    flag: '🇺🇸',
    budgetExampleMax: 700,
    budgetExampleLabel: '$700',
    searchPlaceholder: 'Great camera, under $700, long battery, not too heavy...',
  },
  IN: {
    countryCode: 'IN',
    currency: 'INR',
    symbol: '₹',
    locale: 'en-IN',
    label: 'India',
    flag: '🇮🇳',
    budgetExampleMax: 50000,
    budgetExampleLabel: '₹50,000',
    searchPlaceholder: 'Great camera, under ₹50,000, long battery, lightweight...',
  },
};

export const SUPPORTED_REGION_CODES = Object.keys(REGIONS) as string[];
export const DEFAULT_REGION_CODE = 'US';

export function getRegionConfig(code: string | null | undefined): RegionConfig {
  if (!code) return REGIONS[DEFAULT_REGION_CODE]!;
  return REGIONS[code.toUpperCase()] ?? REGIONS[DEFAULT_REGION_CODE]!;
}

export function isSupportedRegion(code: string): boolean {
  return code.toUpperCase() in REGIONS;
}
```

### 5.2 Currency Formatting: `src/lib/format-currency.ts` (NEW)

Replaces `src/lib/format-usd.ts` for all non-internal display code.

```typescript
/**
 * Format a price for display in the given region.
 *
 * @param price - Raw numeric string from DB or a number
 * @param regionConfig - The active region from getRegionConfig()
 * @param options.isEstimated - When true, appends '~' prefix to indicate conversion
 * @returns Formatted string e.g. '₹65,999' or '~₹67,400 est.' or null
 */
export function formatLocalPrice(
  price: string | number | null | undefined,
  regionConfig: RegionConfig,
  options?: { isEstimated?: boolean },
): string | null {
  if (price == null || price === '') return null;
  const n = typeof price === 'string' ? Number.parseFloat(price) : price;
  if (!Number.isFinite(n)) return null;

  const formatted = n.toLocaleString(regionConfig.locale, {
    style: 'currency',
    currency: regionConfig.currency,
    maximumFractionDigits: 0,
  });

  return options?.isEstimated ? `~${formatted}` : formatted;
}

/**
 * Keep legacy USD-only function for internal dashboard and pipeline telemetry.
 * All user-facing code should use formatLocalPrice instead.
 */
export function formatUsdFromNumericString(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
```

### 5.3 New API Route: `POST /api/set-region` (NEW)

Handles client-side region changes (when user clicks the selector). Does not use LLM or DB — pure cookie mutation.

```typescript
// src/app/api/set-region/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { isSupportedRegion } from '@/lib/regions';

const bodySchema = z.object({ countryCode: z.string().min(2).max(3) });

export const runtime = 'edge'; // No DB needed — edge function is fastest

export async function POST(req: NextRequest): Promise<Response> {
  const json: unknown = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid country code' }, { status: 400 });
  }
  const { countryCode } = parsed.data;
  if (!isSupportedRegion(countryCode)) {
    return NextResponse.json({ error: 'Unsupported region' }, { status: 422 });
  }

  const res = NextResponse.json({ ok: true, countryCode });
  res.cookies.set({
    name: 'recsy_region',
    value: countryCode.toUpperCase(),
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
```

### 5.4 Next.js Middleware: `src/middleware.ts` (NEW)

Runs on all page requests. Zero external API calls — reads only edge-injected headers.

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRegionConfig, isSupportedRegion } from '@/lib/regions';

export const REGION_COOKIE = 'recsy_region';

export function middleware(request: NextRequest) {
  const existingCookie = request.cookies.get(REGION_COOKIE)?.value;

  // 1. Valid cookie already present — pass through, no-op.
  if (existingCookie && isSupportedRegion(existingCookie)) {
    return NextResponse.next();
  }

  // 2. Auto-detect from edge headers (zero latency — injected by Vercel/Cloudflare).
  const detected =
    request.headers.get('x-vercel-ip-country') || // Vercel production
    request.headers.get('cf-ipcountry') || // Cloudflare
    request.headers.get('x-country-code') || // Self-hosted nginx
    'US'; // Safe default

  // Validate: if unsupported country, fall back to default
  const region = getRegionConfig(detected).countryCode;

  const response = NextResponse.next();
  response.cookies.set({
    name: REGION_COOKIE,
    value: region,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // MUST be false so client JS can read it for display
  });

  return response;
}

export const config = {
  matcher: [
    // Match all routes EXCEPT static files, api routes, and Next internals
    '/((?!api|_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)',
  ],
};
```

> **Note on `httpOnly: false`**: The region cookie must be readable by client JS (e.g., `RegionSelectorButton`) so it can display the current region without a server round-trip. This is not a security issue since region is non-sensitive data.

### 5.5 Region Resolver: `src/lib/get-active-region.ts` (NEW)

Server-side utility to read the active region in Server Components and API routes.

```typescript
import { cookies } from 'next/headers';
import { getRegionConfig, type RegionConfig } from './regions';

/**
 * Reads the active region from the cookie set by middleware.
 * Only call from Server Components, API routes, or Server Actions.
 * Never call from client components — use the prop passed by the parent server component.
 */
export async function getActiveRegion(): Promise<RegionConfig> {
  const jar = await cookies();
  const code = jar.get('recsy_region')?.value;
  return getRegionConfig(code);
}
```

---

## 6. LLM Pipeline Integration

### 6.1 Requirements Schema Update: `src/services/recommender/requirements-schema.ts`

Add a new `budget_local` field alongside the existing `budget_usd` (which we preserve for backward compatibility with stored session data).

```typescript
// Replace the budgetUsdSchema section
const budgetLocalSchema = z.preprocess((v) => {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { max: v };
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[$,₹,]/g, ''));
    if (Number.isFinite(n) && n > 0) return { max: n };
  }
  return v;
}, z.object({
  min: z.coerce.number().nonnegative().optional(),
  max: z.coerce.number().positive(),
  currency: z.string().default('USD'),
}).nullable());

// In userRequirementsSchema:
export const userRequirementsSchema = z.object({
  budget_usd: budgetUsdSchema.optional().nullable(), // Legacy — keep for session data migration
  budget_local: budgetLocalSchema.optional().nullable(), // NEW: currency-aware budget
  // ... rest unchanged
});

export type UserRequirements = Omit<UserRequirementsLlm, ...> & {
  budget_usd: { min?: number; max: number } | null; // Legacy
  budget_local: { min?: number; max: number; currency: string } | null; // NEW
  // ... rest unchanged
};
```

### 6.2 Extract Requirements: `src/services/recommender/extract-requirements.ts`

```typescript
export async function extractUserRequirements(input: {
  readonly llm: LlmProvider;
  readonly userMessage: string;
  readonly previous: UserRequirements | null;
  readonly regionCode: string; // NEW
}): Promise<UserRequirements> {
  const config = getRegionConfig(input.regionCode);
  const previous = shouldResetRequirementState(input.userMessage) ? null : input.previous;
  const out = await input.llm.structured({
    model: env.LLM_CHAT_MODEL,
    messages: buildMessages({ userMessage: input.userMessage, previous, regionConfig: config }),
    schema: userRequirementsSchema,
    // ...
  });
  return mergeUserRequirements({
    previous,
    extracted: normalizeUserRequirements(out.value),
    userMessage: input.userMessage,
  });
}

function buildMessages(input: {
  readonly userMessage: string;
  readonly previous: UserRequirements | null;
  readonly regionConfig: RegionConfig;
}): { role: 'system' | 'user'; content: string }[] {
  const { currency, symbol, label, budgetExampleMax } = input.regionConfig;
  const system = `You are RECSY's preference extractor for phone shoppers.
The user is shopping in ${label}. The local currency is ${currency} (${symbol}).

Rules:
- Infer budget_local in ${currency} when the user mentions price.
  Examples of local price expressions: "under ${symbol}${budgetExampleMax}", "about ${budgetExampleMax} ${currency}", 
  "${(budgetExampleMax / 1000).toFixed(0)}k", "around ${budgetExampleMax / 1000}K".
- If currency is ambiguous (no symbol, no unit), default to ${currency}.
- If the user explicitly states a foreign currency (e.g. "200 dollars" when in India), convert it to ${currency}
  at the approximate market rate. State the conversion in a clarifying note if needed.
- budget_local: { min?: number, max: number, currency: "${currency}" }
- budget_usd: Set this only if the user explicitly mentions USD or dollars.
- priorities, must_haves, deal_breakers: unchanged rules apply.
... [rest of existing rules] ...`;

  // ... rest of buildMessages
}
```

### 6.3 Match Logic: `src/services/recommender/match.ts`

Update `passesHardFilters` to compare `budget_local` against `entry.localPrice`:

```typescript
export function passesHardFilters(
  entry: PhoneCatalogEntry,
  requirements: UserRequirements,
  opts: FilterPassOptions,
): boolean {
  // ... existing brand/platform/form_factor filters unchanged ...

  // NEW: use budget_local (currency-aware) if present, fall back to budget_usd (USD)
  const budget =
    requirements.budget_local ??
    (requirements.budget_usd ? { ...requirements.budget_usd, currency: 'USD' } : null);

  // Compare against the right price field
  const entryPrice =
    budget?.currency === 'USD'
      ? entry.msrpUsd != null
        ? Number.parseFloat(entry.msrpUsd)
        : null
      : entry.localPrice != null
        ? Number.parseFloat(entry.localPrice)
        : null;

  if (budget?.max != null && entryPrice != null) {
    const max =
      opts.budgetMaxOverride ??
      (opts.relaxBudgetMax ? budget.max * RECOMMEND_BUDGET_RELAX_FACTOR : budget.max);
    if (!Number.isNaN(entryPrice) && entryPrice > max) return false;
  }
  if (budget?.min != null && entryPrice != null) {
    if (!Number.isNaN(entryPrice) && entryPrice < budget.min) return false;
  }

  return true;
}
```

---

## 7. Frontend Architecture & Data Flow

### 7.1 `AppHeader.tsx` — Server Wrapper with Client Island

```
AppHeader (server)
  ├── reads recsy_region cookie → RegionConfig
  ├── renders nav links (server)
  └── renders <RegionSelectorButton regionConfig={config} /> (client island)
```

### 7.2 Passing Region Through Page Trees

All server component pages must read and pass region config:

```typescript
// Pattern for every page that shows prices:
import { getActiveRegion } from '@/lib/get-active-region';

export default async function BrowsePage({ searchParams }: PageProps) {
  const region = await getActiveRegion(); // reads cookie server-side
  // ... pass `region` to child components
}
```

### 7.3 `RecommendClient.tsx` — Region Context

Since `recommend-client.tsx` is a client component, it cannot read cookies. The parent server page at `src/app/recommend/page.tsx` should:

1. Read the region.
2. Pass it as a prop to `<RecommendClient regionConfig={region} />`.
3. The client then uses it for placeholder text, sends `regionCode` in the POST body to `/api/recommend`.

```typescript
// Modified POST body in recommend-client.tsx send():
body: JSON.stringify({ message, regionCode: regionConfig.countryCode });
```

### 7.4 Browse Price Filter URL Params

The URL params `?min=` and `?max=` are now always in the active currency. Server components know the currency from the cookie, so they can interpret the values correctly:

```typescript
// src/features/browse/search-params.ts — update docstring + types
export interface BrowseFilterState {
  readonly brands: readonly string[];
  readonly minPrice: number | null; // Was: minPriceUsd — now currency-agnostic
  readonly maxPrice: number | null; // Was: maxPriceUsd
  readonly foldable: BrowseFoldableFilter;
}
```

The filter form's price labels must be dynamic. Since `BrowseFiltersForm` is a server component, pass `regionConfig` as a prop:

```tsx
<label>Min price {regionConfig.symbol}</label>
<label>Max price {regionConfig.symbol}</label>
```

---

## 8. UI/UX — Region Selector Design

### 8.1 Design Philosophy

The region selector should feel like a **precision instrument**, not a dropdown. RECSY's visual language is brutalist: sharp edges, monospace type, no border-radius, dark-on-dark depth through hairlines and gradients. The selector should extend this language but feel **alive** — a small, tasteful deviation that signals "this is a globally-aware product."

The selector is not a country list that opens a menu. It is a **signal beacon** in the header — a compact element that shows the current region at a glance and expands into a focused drawer on interaction.

### 8.2 Anatomy of the Region Selector

**Desktop (header, right side of nav):**

```
┌─────────────────────────────┬──────────────────────────────────────────┬──────────────────┐
│  RECSY V2                   │  RECOMMEND  BROWSE  COMPARE  ABOUT       │  🇮🇳 IN  ▸       │
└─────────────────────────────┴──────────────────────────────────────────┴──────────────────┘
```

The region pill lives at the far right of the header bar, separated by the existing `from-accent/80` gradient hairline divider.

**The Pill (collapsed state):**

- Width: ~80px
- Content: `[flag emoji]  [countryCode]  [▸ arrow icon, small, chevron-right rotated on open]`
- Font: JetBrains Mono, 10px, tracking-[0.18em] uppercase
- Border: 1px `border-outline-variant`
- Background: `bg-background`
- On hover: `border-accent`, accent left-edge hairline appears (using `::before` pseudo with accent gradient), text becomes `text-primary`
- Transition: 150ms border-color, accent hairline slides in from left

**The Panel (expanded state):**

- Opens as a **floating panel** anchored to the button, appearing _below_ the header bar
- Panel appears with a `clip-path: inset(0 0 100% 0) → inset(0 0 0% 0)` reveal animation (250ms, `ease-editorial`) — a sharp downward reveal, not a fade
- Panel uses `position: fixed` so it always sits above page content
- Width: 240px
- Background: `bg-background`, 1px solid `border-outline-variant` border, box-shadow: `0 16px 48px rgba(0,0,0,0.7)` for depth

**Panel interior layout:**

```
┌──────────────────────────────────────────┐
│  REGION                       [× close]  │  ← meta-label header
├──────────────────────────────────────────┤
│                                          │
│  🇺🇸  UNITED STATES          USD $       │  ← Active: subtle accent left border
│      ──────────────────────────────      │
│  🇮🇳  INDIA                  INR ₹       │
│                                          │
│  ──────────────────────────────────────  │
│  LOCATION IS AUTO-DETECTED VIA IP        │  ← 9px monospace footer note
└──────────────────────────────────────────┘
```

Each region row:

- Height: 52px
- Layout: `flex items-center justify-between px-4`
- Left: `[flag]  [country name in mono, 11px, tracking-wide, uppercase]`
- Right: `[currency code + symbol in accent color, 10px mono]`
- Active row: `border-l-2 border-accent bg-surface-container text-primary`
- Inactive row: `text-muted-foreground hover:text-primary hover:bg-surface-container` on hover
- Click: immediately calls `POST /api/set-region`, shows a loading spinner in the row for 300ms, then `window.location.reload()`

**Mobile (bottom of mobile nav bar):**

- The mobile nav bar already scrolls horizontally (see `AppHeader` mobile nav).
- Add the region pill as the last item in the mobile nav scrollable list.
- On tap: opens a **bottom sheet modal** — full-width, slides up from bottom, dim overlay behind.

### 8.3 Component Structure

```
src/components/
  RegionSelector/
    RegionSelectorButton.tsx  ('use client' — pill + panel open/close)
    RegionSelectorPanel.tsx   ('use client' — panel content, region list, selection handler)
    RegionSelectorModal.tsx   ('use client' — mobile bottom sheet version)
    region-selector.css       — keyframe animations (clip-path reveal, slide-up)
```

### 8.4 Interaction States

| State               | Visual                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Default             | Pill: outline border, dim flag + country code                                                            |
| Hover               | Pill: accent border-left hairline slides in, text brightens                                              |
| Active (panel open) | Pill: accent border, chevron rotates 90°                                                                 |
| Changing region     | Selected row shows mini `Loader2` spinner, opacity 0.6 on others                                         |
| Changed             | Panel closes, pill animates: brief glow pulse (1 cycle of `pipeline-pulse` keyframe), flag + code update |
| Region confirmed    | `sonner` toast (already installed): `"Region set to India · ₹ INR"` — top-right, 2s duration             |

### 8.5 First-Visit Location Prompt

When the middleware detects an unknown or ambiguous country (one not in `REGIONS`), set the cookie to `'UNKNOWN'`. The `AppHeader` server component checks for this and passes a `promptRegionSelection: true` prop to the client header. On mount, the client renders a **non-blocking overlay banner** (not a modal — don't interrupt the user):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  📍  We couldn't detect your location automatically.   [ CHOOSE REGION ]  ×  │
└──────────────────────────────────────────────────────────────────────────────┘
```

This banner:

- Sits below the header with `position: sticky; top: 64px` (header height)
- Background: `bg-surface-container`, `border-b border-accent/30`
- Font: JetBrains Mono, 11px
- The `[CHOOSE REGION]` button opens the `RegionSelectorPanel`
- The `×` dismisses and sets cookie to `DEFAULT_REGION_CODE` ('US')
- The banner does NOT block scrolling or any interaction

### 8.6 Animation Keyframes to Add to `globals.css`

```css
@keyframes region-reveal {
  from {
    clip-path: inset(0 0 100% 0);
    opacity: 0;
  }
  to {
    clip-path: inset(0 0 0% 0);
    opacity: 1;
  }
}

@keyframes region-slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes region-pill-glow {
  0% {
    box-shadow: 0 0 0 0 rgb(216 107 56 / 0);
  }
  40% {
    box-shadow: 0 0 0 6px rgb(216 107 56 / 0.4);
  }
  100% {
    box-shadow: 0 0 0 0 rgb(216 107 56 / 0);
  }
}
```

```css
.region-panel-enter {
  animation: region-reveal 250ms var(--ease-editorial) forwards;
}

.region-sheet-enter {
  animation: region-slide-up 320ms var(--ease-editorial) forwards;
}

.region-pill-confirmed {
  animation: region-pill-glow 600ms var(--ease-editorial) forwards;
}
```

---

## 9. Catalog Ingestion Pipeline Updates

### 9.1 `promote.ts` — Write Regional Details on Promote

When promoting a new phone candidate, check if the raw spec data contains regional pricing. GSMArena and many OEM pages include pricing for multiple markets.

```typescript
// In src/services/catalog/promote.ts, within the promote function:
async function upsertRegionalDetails(
  db: AppDb,
  phoneId: string,
  claims: CatalogImportSchema,
  exchangeRates: Map<string, number>,
) {
  const rows = [];

  // If we have regional prices in the claims (from future enrichment):
  for (const [countryCode, priceDef] of Object.entries(claims.regionalPrices ?? {})) {
    rows.push({
      phoneId,
      countryCode,
      price: String(priceDef.price),
      currency: priceDef.currency,
      isAvailable: true,
      priceSource: 'catalog_pipeline',
      isEstimated: false,
    });
  }

  // Always ensure a US row from msrpUsd
  if (claims.msrpUsd) {
    rows.push({
      phoneId,
      countryCode: 'US',
      price: String(claims.msrpUsd),
      currency: 'USD',
      isAvailable: true,
      priceSource: 'catalog_pipeline',
      isEstimated: false,
    });
  }

  // For supported regions without official data, create estimated rows
  for (const code of ['IN']) {
    if (!rows.find((r) => r.countryCode === code) && claims.msrpUsd) {
      const rate = exchangeRates.get(`USD_${code}`) ?? FALLBACK_RATES[code];
      rows.push({
        phoneId,
        countryCode: code,
        price: String(Math.round(Number(claims.msrpUsd) * rate)),
        currency: REGIONS[code]!.currency,
        isAvailable: true, // assume global availability; refine later
        priceSource: 'estimated',
        isEstimated: true,
        exchangeRateUsed: String(rate),
      });
    }
  }

  if (rows.length > 0) {
    await db
      .insert(phoneRegionalDetails)
      .values(rows)
      .onConflictDoUpdate({
        target: [phoneRegionalDetails.phoneId, phoneRegionalDetails.countryCode],
        set: {
          price: sql`excluded.price`,
          isEstimated: sql`excluded.is_estimated`,
          updatedAt: sql`now()`,
        },
      });
  }
}
```

### 9.2 New Script: `scripts/update-exchange-rates.ts`

Runs nightly via `pg_cron` or GitHub Actions:

```typescript
// scripts/update-exchange-rates.ts
import { exchangeRates } from '@/services/db/schema';

async function updateExchangeRates(db: AppDb) {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  const data = await res.json();

  const pairs = [{ base: 'USD', quote: 'INR', rate: data.rates.INR }];

  for (const { base, quote, rate } of pairs) {
    await db
      .insert(exchangeRates)
      .values({ baseCurrency: base, quoteCurrency: quote, rate: String(rate) })
      .onConflictDoUpdate({
        target: [exchangeRates.baseCurrency, exchangeRates.quoteCurrency],
        set: { rate: sql`excluded.rate`, fetchedAt: sql`now()` },
      });
  }
}
```

---

## 10. Exchange Rate Strategy

| Scenario                                                     | Behavior                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Phone has an official INR price in `phone_regional_details`  | Show official price, no disclaimer                                                  |
| Phone has USD price only; `is_estimated=true` INR row exists | Show estimated price with `~` prefix and _"Estimated · Converted from USD"_ tooltip |
| Phone has no price in any region                             | Show _"Price not listed"_ as today                                                  |
| Exchange rate table is empty (first deploy)                  | Fall back to hardcoded rates in `FALLBACK_RATES` in `regions.ts`                    |
| Exchange rate is > 30 days old                               | Log a warning in server startup; still use it (stale rate is better than no rate)   |

**Important: Never show an estimated price without the disclaimer.** Users in India may make purchasing decisions based on RECSY prices — misleading them with a bad conversion is a trust and legal risk.

---

## 11. Performance & Caching Strategy

### 11.1 DB Query Impact

Adding a `LEFT JOIN phone_regional_details` to every browse and catalog query increases query complexity. Benchmark this carefully:

- **Browse page**: The additional join on `(phone_id, country_code)` uses the unique index — O(1) per phone. Acceptable.
- **Catalog loader**: Currently loads all active phones. The join doubles the row count for phones with regional data but the aggregation loop handles this. Monitor for N>100 phones.
- **Cache opportunity**: The recommendation catalog is loaded on every `/api/recommend` call. Consider a **server-side in-memory LRU cache** (keyed by `regionCode`, TTL 5 minutes) to avoid re-querying the full catalog + regional data on every request.

```typescript
// src/services/recommender/catalog-cache.ts (NEW)
import LRU from 'quick-lru'; // Or use Map with manual TTL

const CATALOG_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { data: PhoneCatalogEntry[]; at: number }>();

export async function loadCachedCatalog(
  db: AppDb,
  regionCode: string,
): Promise<PhoneCatalogEntry[]> {
  const cached = cache.get(regionCode);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.data;

  const data = await loadRecommendationCatalog(db, regionCode);
  cache.set(regionCode, { data, at: Date.now() });
  return data;
}
```

### 11.2 Next.js Route Caching

Browse page and phone detail pages currently use `export const dynamic = 'force-dynamic'` — they always rerender. This is correct since prices and region can change per request.

Do NOT cache these pages at the CDN level since the response varies by cookie. Ensure `Vary: Cookie` response headers are set, or use private cache-control headers.

### 11.3 Static Site Generation Exclusion

The sitemap (`src/app/sitemap.ts`) and robots (`src/app/robots.ts`) should not be affected by regional logic since they serve canonical URLs regardless of user region.

---

## 12. Security Considerations

### 12.1 Cookie Validation — Server-Side

The middleware's `isSupportedRegion()` check ensures only valid region codes are stored. But since cookies are user-controlled, any server component or API route that reads `recsy_region` MUST validate it through `getRegionConfig()` (which falls back to default). Never trust the raw cookie value directly in SQL queries.

```typescript
// ✅ Safe
const region = getRegionConfig(jar.get('recsy_region')?.value);
const code = region.countryCode; // Always valid enum value

// ❌ UNSAFE - could contain SQL injection if used directly
const code = jar.get('recsy_region')?.value;
db.where(eq(phoneRegionalDetails.countryCode, code)); // Never do this
```

### 12.2 `/api/set-region` Input Sanitization

The `POST /api/set-region` route validates the `countryCode` against `SUPPORTED_REGION_CODES` before writing any cookie. It is an edge function with no DB access, so attack surface is minimal.

### 12.3 GDPR / Privacy

IP-based geolocation does not store any IP address. The middleware reads the already-resolved country code from the edge header — not the raw IP. The `recsy_region` cookie stores a 2-letter country code (e.g., `IN`) which is not PII. No consent banner is required for this cookie under GDPR (it's a functional preference cookie, not tracking).

### 12.4 Currency Conversion Disclaimer

If showing estimated prices (USD → INR conversion), clearly label them in the UI. Do not present estimated prices with the same visual weight as official prices. This reduces legal exposure to currency misrepresentation claims.

---

## 13. SEO & Metadata Localization

### 13.1 Page-Level Metadata Update

For the `/browse` page, dynamically generate descriptions that mention the local market:

```typescript
// src/app/browse/page.tsx
export async function generateMetadata(): Promise<Metadata> {
  const region = await getActiveRegion();
  return {
    title: region.countryCode === 'IN' ? 'Browse Phones in India — RECSY' : 'Browse Phones — RECSY',
    description:
      region.countryCode === 'IN'
        ? 'Explore the latest smartphones available in India with official ₹ INR prices.'
        : 'Explore the active phone catalog with US MSRP prices.',
  };
}
```

### 13.2 `hreflang` Consideration

For a US/India split, consider adding `<link rel="alternate" hreflang="en-in" href="...">` tags when serving Indian users. This is optional for MVP but helps Google understand the audience segmentation.

### 13.3 Structured Data (JSON-LD)

The phone detail page (`/p/[slug]`) currently shows a single price. If the user is in India, the JSON-LD `Product` schema should include the INR price with `priceCurrency: "INR"`. This enables Google to show ₹ prices in Indian search results.

---

## 14. Accessibility & i18n Considerations

### 14.1 `aria-label` on Region Selector

The region pill button must have a descriptive `aria-label`:

```tsx
<button aria-label={`Current region: ${regionConfig.label}. Click to change.`}>
  {regionConfig.flag} {regionConfig.countryCode}
</button>
```

### 14.2 Announce Region Change to Screen Readers

After a region change, announce to screen readers via an `aria-live` region:

```tsx
<div role="status" aria-live="polite" className="sr-only">
  {regionChanged
    ? `Region changed to ${newRegion.label}. Prices now shown in ${newRegion.currency}.`
    : ''}
</div>
```

### 14.3 Right-to-Left (RTL) Readiness

India uses LTR scripts (Devanagari is LTR; English is used in tech contexts). Future regions like Arabic (UAE, Saudi Arabia) would need RTL layout consideration. Add `dir="ltr"` explicitly to the `<html>` element to avoid browser auto-detect surprises, and note that RTL support would require a separate feature flag.

### 14.4 Number Format Correctness

Indian number formatting is distinct:

- `1,00,000` (one lakh) not `100,000`
- `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` handles this correctly.
- Test with amounts like 10000, 100000, 1000000 to verify grouping.

---

## 15. Migration & Rollout Strategy

### Phase 1 — Foundation (No User-Visible Change)

- Add DB schema (`phone_regional_details`, `exchange_rates`).
- Run migration + US backfill script.
- Add `src/lib/regions.ts`, `src/lib/format-currency.ts`, `src/lib/get-active-region.ts`.
- Add `src/middleware.ts` — writes cookie but all existing UI still ignores it.
- Add `POST /api/set-region` route.
- No UI changes yet. **Zero user-visible impact.**

### Phase 2 — Indian Region Data

- Seed estimated INR data via `scripts/seed-regional-india-estimates.ts`.
- For major phones (Samsung, Apple flagships), manually verify INR prices against official sites and mark `is_estimated=false`.
- Update `catalog-promote.ts` to populate regional rows on future ingestion.

### Phase 3 — Backend Wiring

- Update `loadRecommendationCatalog` to accept and use `regionCode`.
- Update `runRecommendationPipeline` and `/api/recommend` to pass `regionCode`.
- Update `browseWhereFromState` for regional price filtering.
- Update LLM prompts in `extract-requirements.ts`.
- Update `passesHardFilters` in `match.ts`.
- **Feature flag**: Use `env.ENABLE_REGIONAL_PRICING` to gate the new behavior. Default off. Test in dev.

### Phase 4 — UI Rollout

- Build `RegionSelectorButton` + `RegionSelectorPanel`.
- Update `AppHeader` to pass region config.
- Update all price display points (`browse/page.tsx`, `compare/page.tsx`, `p/[slug]/page.tsx`, `recommend-client.tsx`).
- Update `BrowseFiltersForm` labels.
- Update recommender placeholder text.
- **Enable `ENABLE_REGIONAL_PRICING=true` on staging.**

### Phase 5 — Hardening

- Add `update-exchange-rates` script to nightly cron.
- Add `aria-live` region announcements.
- Add Vitest unit tests for all new utility functions.
- Add Playwright E2E test for region selector.
- **Production deploy.**

---

## 16. Verification Plan

### 16.1 Unit Tests (Vitest)

```typescript
// src/lib/regions.test.ts
describe('getRegionConfig', () => {
  it('returns US config for null input', () => { ... });
  it('returns IN config for "IN"', () => { ... });
  it('returns US config for unsupported code "XY"', () => { ... });
  it('is case-insensitive: "in" === "IN"', () => { ... });
});

// src/lib/format-currency.test.ts
describe('formatLocalPrice', () => {
  it('formats INR 65000 as ₹65,000', () => { ... }); // Indian grouping
  it('formats INR 100000 as ₹1,00,000', () => { ... }); // Lakh format
  it('formats USD 1200 as $1,200', () => { ... });
  it('returns null for null input', () => { ... });
  it('prepends ~ for estimated prices', () => { ... });
});

// src/services/recommender/match.test.ts — new budget test cases
describe('passesHardFilters with budget_local', () => {
  it('filters by INR budget when entry has localPrice', () => { ... });
  it('allows a phone priced at ₹48,000 through a ₹50,000 budget', () => { ... });
  it('blocks a phone priced at ₹80,000 for a ₹50,000 budget', () => { ... });
});
```

### 16.2 Integration Tests

- **Middleware test**: Simulate request with `x-vercel-ip-country: IN` header — verify response sets `recsy_region=IN` cookie.
- **Catalog query test**: Seed `phone_regional_details` with a test phone available in IN; verify it appears in a browse query with `countryCode=IN`.
- **Availability filter**: Seed a phone with `is_available=false` for IN; verify it does NOT appear in browse results for IN.

### 16.3 Manual QA Checklist

| Test                                                       | Expected                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Set `recsy_region=IN` cookie in browser; open `/browse`    | Prices show ₹, filter labels say ₹ symbol                      |
| Set `recsy_region=IN`; open `/p/samsung-galaxy-s25-ultra`  | Header price shows official INR MSRP or estimated INR          |
| Set `recsy_region=IN`; open `/compare?a=...&b=...`         | Compare table row label says "MSRP INR"                        |
| Set `recsy_region=IN`; open `/recommend`; type "under 50k" | LLM extracts ₹50,000, returns phones priced under ₹50k         |
| Click region pill in header                                | Panel opens with clip-path reveal animation                    |
| Select India from panel                                    | Cookie updates, page reloads, all prices now in ₹              |
| Visit with unknown country cookie `recsy_region=UNKNOWN`   | Banner appears asking user to choose region                    |
| Screen reader focus on region button                       | Reads "Current region: United States. Click to change."        |
| Verify Indian number formatting                            | ₹1,00,000 not ₹100,000                                         |
| Estimated price display                                    | Shows `~₹67,400` with tooltip "Estimated · Converted from USD" |

---

## 17. File Change Summary

| File                                                     | Change Type | Notes                                              |
| -------------------------------------------------------- | ----------- | -------------------------------------------------- |
| `src/services/db/schema.ts`                              | MODIFY      | Add `phoneRegionalDetails`, `exchangeRates` tables |
| `src/lib/regions.ts`                                     | NEW         | Central region registry                            |
| `src/lib/format-currency.ts`                             | NEW         | Replaces `format-usd.ts` for user-facing displays  |
| `src/lib/get-active-region.ts`                           | NEW         | Server-side cookie reader                          |
| `src/middleware.ts`                                      | NEW         | Edge middleware for IP detection                   |
| `src/app/api/set-region/route.ts`                        | NEW         | Client region change API                           |
| `src/components/RegionSelector/RegionSelectorButton.tsx` | NEW         | Client pill component                              |
| `src/components/RegionSelector/RegionSelectorPanel.tsx`  | NEW         | Client panel/dropdown                              |
| `src/components/RegionSelector/RegionSelectorModal.tsx`  | NEW         | Mobile bottom sheet                                |
| `src/components/AppHeader.tsx`                           | MODIFY      | Read region, pass to RegionSelector                |
| `src/app/layout.tsx`                                     | MODIFY      | Pass region to header                              |
| `src/app/browse/page.tsx`                                | MODIFY      | Pass region to query + formatLocalPrice            |
| `src/app/browse/browse-filters-form.tsx`                 | MODIFY      | Dynamic currency labels                            |
| `src/app/compare/page.tsx`                               | MODIFY      | Regional price + dynamic "MSRP ₹/$ " label         |
| `src/app/p/[slug]/page.tsx`                              | MODIFY      | Pass region to PhoneHeader + PhoneSpecSummary      |
| `src/app/recommend/page.tsx`                             | MODIFY      | Read region, pass to RecommendClient               |
| `src/app/recommend/recommend-client.tsx`                 | MODIFY      | Accept regionConfig prop, dynamic placeholder      |
| `src/app/settings/settings-client.tsx`                   | MODIFY      | Add region setting section                         |
| `src/features/browse/search-params.ts`                   | MODIFY      | Rename priceUsd fields to price                    |
| `src/features/browse/query.ts`                           | MODIFY      | Join regional details, availability filter         |
| `src/services/recommender/catalog.ts`                    | MODIFY      | Accept regionCode, join regional details           |
| `src/services/recommender/catalog-cache.ts`              | NEW         | In-memory LRU cache per region                     |
| `src/services/recommender/requirements-schema.ts`        | MODIFY      | Add budget_local schema                            |
| `src/services/recommender/extract-requirements.ts`       | MODIFY      | Inject region into LLM prompt                      |
| `src/services/recommender/match.ts`                      | MODIFY      | Use budget_local vs localPrice                     |
| `src/services/recommender/run-recommendation.ts`         | MODIFY      | Pass regionCode through pipeline                   |
| `src/components/phone/PhoneHeader.tsx`                   | MODIFY      | Use formatLocalPrice                               |
| `src/components/phone/PhoneSpecSummary.tsx`              | MODIFY      | Use formatLocalPrice                               |
| `src/lib/recommend-session.ts`                           | MODIFY      | Store regionCode in session snapshot               |
| `src/app/globals.css`                                    | MODIFY      | Add region-reveal, slide-up, pill-glow keyframes   |
| `src/services/catalog/promote.ts`                        | MODIFY      | Upsert phone_regional_details on promote           |
| `scripts/backfill-regional-us.ts`                        | NEW         | One-time: create US rows from msrp_usd             |
| `scripts/seed-regional-india-estimates.ts`               | NEW         | One-time: create estimated INR rows                |
| `scripts/update-exchange-rates.ts`                       | NEW         | Nightly FX rate refresh                            |
| `drizzle/migrations/XXXXXX_add_regional_tables.sql`      | NEW         | Generated by drizzle-kit                           |
