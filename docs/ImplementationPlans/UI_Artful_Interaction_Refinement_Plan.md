# UI Artful Interaction Refinement Implementation Plan

## Purpose

This plan refines the current RECSY technical editorial UI without replacing its design language. The target feeling is still absolute-dark, sharp, gridded, technical, and precise, but the interface should become more desirable to touch: richer hover states, subtle steel-gray gradient headings, tactile transitions, livelier pipeline storytelling, and clearer user-facing terminology.

The work should feel like polishing an industrial instrument panel into an interactive art object. It must not become mainstream SaaS gloss, soft cards, rounded shapes, decorative blobs, or a generic gradient product site.

## Source References

- Design guide: `design/stitch_recsy_modern_platform_redesign/technical_editorial/DESIGN.md`
- Current app design tokens: `src/styles/theme.css`
- Current global CSS and motion utilities: `src/app/globals.css`
- Recommend page: `src/app/recommend/recommend-client.tsx`
- Compare page: `src/app/compare/page.tsx`
- Compare picker: `src/app/compare/compare-phone-pickers.tsx`
- Internal pipeline page: `src/app/internal/pipeline/page.tsx`
- Workflow references for pipeline tables:
  - `.github/workflows/ci.yml`
  - `.github/workflows/creator-watch.yml`
  - `.github/workflows/ingest-on-new-phone.yml`
  - `.github/workflows/ingest-resume.yml`
  - `.github/workflows/ingest-tiered.yml`
  - `.github/workflows/ingest.yml`
  - `.github/workflows/scorecard-auto.yml`

## Design Principles

1. Preserve the technical editorial identity.
   Use sharp 1px grid structure, mono metadata, oversized Hanken Grotesk headings, dark surfaces, flat tonal layering, and border-defined depth.

2. Add beauty through precision, not decoration.
   Use steel-gray text gradients, faint orange data glints, animated grid activation, subtle image reveal, line motion, and status light movement. Do not add decorative blobs, soft shadows, rounded cards, or unrelated imagery.

3. Make interactions explain the system.
   Every animation should communicate state: evidence moving from source to chunk to extraction to retrieval, recommendation sets moving into history, comparison slots expanding as phones are selected.

4. Keep the UI calm under reduced motion.
   All animations must respect `prefers-reduced-motion`. Reduced motion should still show complete information with static active states.

5. Avoid extra database cost.
   Prefer derived presentation from already-loaded rows. When new data is needed, use single bounded queries, `Promise.allSettled`, small limits, and indexed filters. No polling, no GitHub API calls, and no unbounded count queries in critical route rendering.

6. Remove programmer-facing labels from the UI.
   No visible underscores, raw variable names, or schema field names. UI labels should read like "Battery", "Source diversity", "Minimum price USD", "Main rear camera MP", not `battery_mah`, `source_diversity`, or `MIN_PRICE_USD`.

## Global UI Foundation

### 1. Steel Gradient Heading System

Add reusable heading utilities in `src/app/globals.css`:

- `.text-gradient-steel`
  - Background: linear gradient from `#ffffff` to `#bfc3c4` to `#747879`.
  - Use `background-clip: text` and transparent fill only where supported.
  - Provide fallback `color: var(--primary)` before gradient declarations.
  - Keep contrast safe by using high-luminance stops only. Avoid low-contrast charcoal in actual text.

- `.text-gradient-accent-edge`
  - Same steel base, with a very small warm stop near one edge using `rgb(216 107 56 / 0.55)`.
  - Use only on large headings, never body text.

- `.heading-scanline`
  - A pseudo-element hairline sweep on hover/focus within large headings.
  - Motion duration: 700-900 ms.
  - Disabled under `prefers-reduced-motion`.

Apply to:

- Main page headings on Recommend, Browse, Compare, About, Settings.
- Pipeline Observatory H1.
- Empty-state headings such as "Tell us what you want".

Do not apply to dense table headers, labels, body copy, or small controls.

### 2. Motion Tokens

Add motion custom properties:

- `--motion-fast: 150ms`
- `--motion-medium: 260ms`
- `--motion-slow: 520ms`
- `--ease-editorial: cubic-bezier(0.16, 1, 0.3, 1)`
- `--ease-schematic: cubic-bezier(0.65, 0, 0.35, 1)`

Use them across new transitions instead of ad hoc durations. The site should feel consistent: quick for controls, slower for page-level rearrangements, and deliberate for pipeline flows.

### 3. Universal Interactive Surface Class

Create a shared class in `src/app/globals.css`:

- `.interactive-panel`
  - 1px outline border.
  - Faint dark surface.
  - `transition-property: border-color, background-color, transform, opacity, filter`.
  - Hover: border moves toward primary or accent, background rises one tonal tier, optional `translateY(-1px)`.
  - Focus-visible: same visual state plus existing ring.

Use this for recommendation cards, pipeline schematic cards, source cards, chunk rows, compare picker options, and workflow tables.

### 4. Image Reveal Rule

Current images already move toward color on hover. Standardize this:

- Default state: slight grayscale, contrast 0.95, brightness 0.92.
- Hover/focus-within: grayscale 0, brightness 1, very slight scale 1.015 to 1.03.
- Keep overlays readable with gradient scrims.
- Respect reduced motion by removing scale, keeping color reveal.

### 5. User-Facing Label Formatter

Add `src/lib/display-label.ts`:

- `humanizeKeyLabel(value: string): string`
  - Convert underscores and hyphens to spaces.
  - Preserve known units: USD, GB, MP, mAh, Hz, W, IP, OS.
  - Convert known field names:
    - `battery_mah` -> `Battery`
    - `rear_cameras` -> `Rear cameras`
    - `front_camera` -> `Front camera`
    - `refresh_rate_hz` -> `Refresh rate`
    - `msrp_usd` -> `MSRP USD`
    - `min_price_usd` -> `Minimum price USD`
    - `max_price_usd` -> `Maximum price USD`
  - Return title/sentence case appropriate to the caller.

Implementation rule:

- Do not rename actual schema fields, API payload keys, or query params.
- Only convert labels at render boundaries.
- Add unit tests for the known labels and generic underscore handling.

## Internal Pipeline Plan

### Current Issues

- `/internal/pipeline?phone=google-pixel-9-pro-xl` must complete reliably.
- Global count queries can time out and should not block page rendering.
- Discovery shows only a small slice of sources, so YouTube can exist below in chunk viewer but not appear in the lifecycle explorer.
- Source bubbles need thumbnails or type-specific visual cards.
- Chunk viewer uses expandable rows but does not feel rich enough when clicked.
- LLM hub can show deeper synthesis signals, not just aspect count.
- Ingest, Process, and Retrieve schematic cards look clickable but do not reveal anything.
- Retrieval event needs to explain what matched and why the phone was recommended.
- Ingestion run tables need more visual status and more pipeline/workflow context.

### Data Loading Contract

Refactor pipeline data loading into small helpers:

- `loadPipelineShellData(db)`
  - Phone picker options.
  - Bounded metrics.
  - Latest runs.
  - Must use fallbacks if counts timeout.

- `loadDeviceLifecycleData(db, selectedPhoneId)`
  - Sources, chunks, aspects, sample recommendation turns.
  - Use `Promise.allSettled` or existing `optionalQuery`.
  - No single optional query should block the full page longer than 900-1500 ms.

- `deriveLifecycleInsights(data)`
  - Source mix.
  - Evidence density.
  - Source diversity.
  - Extraction coverage.
  - Strongest signal.
  - Retrieval state.
  - Query match reasons.

Avoid raw `count(*)` on large tables in the critical path. Preferred alternatives:

- Use bounded summary values derived from already-loaded rows where possible.
- For global metrics, use `optionalQuery` with fallback `0` or "syncing".
- If exact counts remain important later, add a cached summary table or materialized metrics source rather than live counts on page load.

### Route Reliability

Keep `/internal/pipeline` as the canonical user-facing URL.

Implementation preference:

1. First investigate why the direct route falls through or hangs in dev.
2. Prefer a direct `src/app/internal/pipeline/page.tsx` route with `src/app/internal/layout.tsx` allowing this route when internal dashboards are enabled.
3. Avoid a permanent middleware/proxy workaround unless direct routing cannot be made stable.
4. If a backing route remains necessary, use Next 16 `proxy.ts` instead of deprecated `middleware.ts`.

Acceptance:

- `curl --max-time 10 "http://localhost:3000/internal/pipeline?phone=google-pixel-9-pro-xl"` returns HTTP 200.
- Page includes "Pipeline Observatory", "Google Pixel 9 Pro XL", and lifecycle insights.
- No route depends on long-running DB counts.

### Lifecycle Schematic Interactions

Convert Ingest, Process, and Retrieve cards into interactive inspector cards:

- Use a client component `PipelineSchematicExplorer`.
- Keep cards visually sharp, border-based, and aligned to the existing grid.
- Clicking a card opens an inline inspector below the schematic, not a modal.
- The active card uses a faint orange border and animated data path.

Ingest inspector should show:

- Source type mix: YouTube, Reddit, article, GSMArena.
- Latest fetched source.
- Queue state: queued/running counts if available.
- Mini animation: source particles moving into a capture line.

Process inspector should show:

- Chunk count loaded for selected phone.
- Token distribution from visible chunks.
- Scorecard aspect count.
- Embedding and chunking stages as three thin progress rails:
  - Normalize
  - Chunk
  - Embed

Retrieve inspector should show:

- Latest matched recommendation query, if available.
- Candidate rank for selected phone.
- Matched aspects and source evidence chips.
- Mini animation: lines from aspect bubbles to retrieval card.

### LLM Hub Insight Bubbles

In the Synthesis stage, replace the static "LLM hub" feel with a live-looking synthesis core:

- Central hub remains circular and geometric.
- Around it, render 5-7 insight bubbles derived from `deviceAspects`.
- Example bubble labels:
  - Camera confidence
  - Battery signal
  - Value pressure
  - Performance read
  - Display quality
  - Dissent count
  - Evidence support

Bubble content:

- Aspect name.
- Score.
- Confidence.
- Supporting/dissenting counts.
- One-line summary.

Interaction:

- Bubbles gently pop in/out using opacity and small Y movement.
- Hover/focus pauses the bubble and expands a compact detail strip.
- Click locks the bubble open.
- Keyboard access: each bubble is a button with `aria-expanded`.

Performance:

- Pure CSS animation for idle movement.
- No canvas needed.
- Do not animate layout; animate transform/opacity only.

### Source Thumbnails

Add a helper `src/lib/source-thumbnail.ts`:

- `getSourceThumbnail(source): SourceThumbnail`
- For YouTube:
  - Extract video ID from common YouTube URL forms.
  - Use `https://i.ytimg.com/vi/{id}/hqdefault.jpg`.
  - If extraction fails, use a type tile with play glyph.
- For Reddit:
  - Use a structured text tile: subreddit/author/title.
- For articles and GSMArena:
  - Use a text tile with source type, hostname, and title.

Do not fetch remote metadata server-side.

Discovery source selection:

- Ensure at least one source per available type appears in the lifecycle explorer before filling remaining slots by recency.
- This fixes the "YouTube exists in chunk viewer but not in lifecycle explorer" issue.

Visual:

- Bubble/card hybrid: circular icon anchor plus rectangular expanding detail.
- Thumbnail remains monochrome by default and colorizes on hover/focus.
- Maintain readable text overlay with a dark gradient.

### Chunk Viewer Rich Display

Convert chunk viewer into a split "chunk workbench":

- Left: source rows and chunk chips.
- Right: active chunk detail panel.
- On click or keyboard selection:
  - Show source title, source type, chunk index, token count.
  - Show first 3-5 lines of chunk text.
  - Add "Expand chunk" button to reveal full text.
  - Add related aspect chips if known from source/aspect coverage.

Implementation:

- Use a client component with `useState(activeChunkId)`.
- Receive already-loaded `deviceSources` and `deviceChunks` as props.
- No new API calls.
- Use `<button>` for selectable chunks, not clickable `<div>`.

Accessibility:

- Active chunk button uses `aria-pressed`.
- Detail region has `aria-live="polite"` only for selected chunk title, not the entire text.
- Full text expansion uses `aria-expanded`.

### Retrieval Event Rich Explanation

When the retrieval event card opens, show:

- Query text.
- Candidate rank.
- Matched preference chips from `recommendationTurns.extractedRequirements` if already selected; otherwise derive from `topAspects`.
- Why this phone surfaced:
  - "Matched camera priority"
  - "Battery evidence available"
  - "Within budget" if MSRP exists and query budget can be inferred.
  - "Scorecard confidence" if aspects are available.
- Evidence rail:
  - Top 3 chunks or source titles connected to reason chips.

No new LLM call should be made. This is a visualization of stored retrieval/recommendation telemetry, not a fresh explanation generation.

### Workflow and Run Tables

Replace one large ingestion table with collapsed technical tables:

- "Recent ingestion runs" from `ingestRuns`.
- "Scorecard generation" from `scorecardRuns`.
- "Resume ingestion candidates" from `crawlQueue` and/or latest failed/retryable `ingestRuns`.
- "GitHub Actions schedules" from static workflow metadata:
  - CI
  - Creator watch
  - Ingest on new phone
  - Resume ingestion
  - Tiered ingest
  - Manual ingest
  - Scorecard auto

Implementation:

- Use `<details>` sections collapsed by default.
- Each section header shows count, last status, and a glowing status dot.
- Do not call GitHub APIs. Static workflow names and descriptions are enough for this UI layer.
- If real workflow run status is desired later, add an authenticated server route with caching. That is explicitly out of scope for this refinement.

Status dot design:

- Success: soft green glow.
- Running: orange pulse.
- Queued: gray/white dim pulse.
- Failed: red static outline plus text.
- Color is never the only signal; include status text.

### Pipeline Performance Budget

- First server response target: under 3 seconds on local dev with Pixel 9 Pro XL selected.
- No query should block the page beyond its timeout fallback.
- Use `Promise.allSettled` for optional sections.
- Limit selected phone sources to 10-12, chunks to 24-32, aspects to 7, sample turns to 3.
- Keep all animation CSS transform/opacity based.
- Lazy render deep details behind `<details>` where possible.

## Compare Page Plan

### Current Issues

- Picker UI is functional but basic.
- Native selects cannot show photos or animated expanded details.
- The page only supports two selected phones.
- Better-spec highlighting needs to scale to 2 or 3 phones.

### Three-Phone Comparison Model

Update URL contract:

- Existing links keep working:
  - `/compare?a=phone-one&b=phone-two`
- Optional third phone:
  - `/compare?a=phone-one&b=phone-two&c=phone-three`

Server logic:

- Parse `a`, `b`, and optional `c`.
- Deduplicate slugs.
- Require at least 2 unique phones to show comparison.
- Query active phones using a single `inArray` call.
- Preserve order from query params.

Spec table:

- Replace `specLine(label, left, right, winner)` with dynamic row model:
  - `ComparisonMetric`
  - `values: Array<{ slug, displayValue, numericValue? }>`
  - `higherIsBetter`
  - `winnerSlugs`
- Highlight winner cells across 2 or 3 columns with subtle orange outline only.
- Ties should show no winner highlight unless a tie indicator is useful.

### Artful Compare Picker

Replace native selects with an accessible custom combobox component:

- `ComparePhonePickerBoard`
  - Client component.
  - Receives options from server.
  - Each option includes slug, label, brand, model, imageUrl, msrpUsd, and basic specs derived from `specJson`.
  - No extra client-side DB call.

Layout:

- Two large side-by-side slots by default.
- Each slot is a bordered selection plane with:
  - Empty state: "Select phone".
  - Selected state: photo, brand, model, price, two micro specs.
  - Remove/change button.
- A sharp square "+" button adds the third slot.
- Third slot can be removed.

Dropdown/listbox:

- Opens as a grid-aligned panel below the slot.
- Options are rows that expand on hover/focus:
  - Default: model, brand, price.
  - Expanded: phone image thumbnail, battery, display refresh, main camera.
- Keyboard:
  - Arrow keys move active option.
  - Enter selects.
  - Escape closes.
  - Tab order remains predictable.
- ARIA:
  - `role="combobox"` or button plus `role="listbox"` depending implementation.
  - Active option announced.
  - Selected value announced.

Animation:

- Use `motion` dependency or CSS transitions.
- Animate listbox open with opacity/Y, not height thrash.
- Use `layout` animation for slot expansion to third column.

Submission:

- Generate hidden inputs `a`, `b`, `c`.
- Disable Compare button until at least two unique phones are selected.
- Preserve no-JS fallback by keeping a minimal server form if needed, or ensure the client component hydrates from server-rendered markup.

## Recommend Page Plan

### Current Issues

- Recommendation cards are static on hover.
- A new query clears previous recommendations instead of preserving them as navigable answers.
- Users should be able to revisit previous recommendation sets and return to the latest answer smoothly.

### Recommendation Snapshot State Model

Add a snapshot model in `src/lib/recommend-session.ts`:

```ts
type RecommendationSnapshot = {
  id: string;
  query: string;
  assistantText: string;
  picks: readonly ApiPick[];
  relaxed: readonly string[];
  refined: boolean;
  scoresTied: boolean;
  scorecardMissing: boolean;
  topAspects: readonly string[];
  savedAt: number;
};
```

State in `RecommendClientLoaded`:

- `snapshots: RecommendationSnapshot[]`
- `activeSnapshotId: string | null`
- `latestSnapshotId: string | null`
- `pendingQuery: string | null`

Behavior:

1. User submits a new query.
2. If current recommendations exist and are not already in snapshots, freeze them into history.
3. Clear the hero recommendation area and show a precise loading state for the new query.
4. When results arrive, create a new snapshot, mark it as latest, and set it active.
5. If user clicks a previous snapshot:
   - Render that snapshot in the hero recommendation area.
   - Keep the latest snapshot visible in the timeline as "Latest answer".
6. If user clicks the latest snapshot:
   - Return latest snapshot to hero area.
7. The data is not recomputed. Switching snapshots is local state only.

Storage:

- Persist last 8 snapshots in localStorage through `recommend-session`.
- Bound localStorage payload size by keeping only fields needed to render cards.
- Provide migration from old single-session shape.

### Recommendation Timeline UI

Add a compact "Answer timeline" rail above or beside recommendations:

- Latest answer is first and visually active by default.
- Previous answers show:
  - Query excerpt.
  - Top pick model.
  - Time label.
  - Count of picks.
- Clicking expands selected answer in the main hero section.
- Use a horizontal rail on desktop and stacked collapsed rows on mobile.

Animation:

- Use `AnimatePresence` and layout transitions if using `motion`.
- Hero cards use shared `layoutId` so previous/latest swaps feel physical.
- Pending query animates as a thin scanline placeholder, not a spinner-only state.

Accessibility:

- Timeline items are buttons.
- Active item uses `aria-current="true"`.
- Loading state uses `aria-busy` on the recommendations region.
- Reduced motion uses instant swap with a static active border.

### Recommendation Card Hover

Enhance `RecommendationCard`:

- Border brightens and image colorizes on hover/focus.
- Featured card:
  - Subtle image scale.
  - Score value ticks up visually only if possible without hydration mismatch; otherwise static.
  - Summary panel reveals a small "why this fits" line from summary/top aspect.
- Runner-up cards:
  - Slight horizontal scanline.
  - Arrow slides 2-4 px.

Do not animate text size. Do not cause layout shift.

## Variable-Like Naming Cleanup

Audit all user-facing strings in:

- `src/app`
- `src/components`
- `src/features`

Fix labels such as:

- `MIN_PRICE_USD` -> `Minimum price USD`
- `MAX_PRICE_USD` -> `Maximum price USD`
- `brand_vector` -> `Brand`
- `result_manifest` -> `Recommendations`
- `Open_record` -> `Phone details`
- `battery_mah` -> `Battery`
- `rear_cameras` -> `Rear cameras`
- `refresh_rate_hz` -> `Refresh rate`

Testing:

- Add a lightweight test for `humanizeKeyLabel`.
- Add a grep-based CI guard if desired:
  - Search rendered source strings for known banned terms.
  - Do not block on legitimate code identifiers.

## Accessibility and WCAG 2.2 Requirements

### Contrast

- Body text must remain at least 4.5:1 contrast.
- Large text gradients must remain at least 3:1 across all visible stops.
- Orange accent is not used alone for meaning. Pair with text labels or icons.

### Keyboard

- Every clickable visual surface must be reachable by keyboard.
- Custom compare picker must support keyboard navigation.
- Pipeline source bubbles, chunk rows, workflow tables, and insight bubbles must use buttons or native disclosure elements.

### Focus

- Preserve existing visible focus ring.
- Do not remove outlines.
- Focus state should match hover state plus ring.

### Motion

- Respect `prefers-reduced-motion`.
- Avoid flashing more than three times per second.
- No critical information should depend on animation.
- Auto-moving bubbles must pause on hover/focus where practical.

### Touch Targets

- Interactive controls should be at least 44px tall on mobile.
- Dense desktop rows can be smaller only where keyboard focus and text readability remain strong.

### Semantics

- Use `details/summary` for simple disclosure.
- Use `button` for state changes.
- Use `Link` only for navigation.
- Tables remain real tables for tabular data.

## Performance Plan

### Rendering

- Keep heavy pages server-rendered for initial data.
- Use client components only for actual interaction:
  - Compare picker board.
  - Pipeline lifecycle explorer controls.
  - Pipeline chunk workbench.
  - Recommend snapshot timeline.

### Database

- No new DB calls for hover states, expanded chunks, or snapshot switching.
- Pipeline uses existing selected phone data and static workflow metadata.
- Compare picker uses one server query for options with added fields.
- Recommend history is local state and localStorage only.

### Bundles

- `motion` is already installed. Use it only on Recommend and Compare where layout transitions matter.
- Keep Pipeline animation mostly CSS to avoid a large client bundle.
- Avoid adding new animation libraries.

### Images

- Use existing `PhoneImage`.
- Use derived YouTube thumbnail URLs without metadata fetches.
- Add `loading="lazy"` where thumbnails are below the fold.
- Keep overlay gradients GPU-friendly.

## Implementation Phases

### Phase 0: CI Cleanup

- Format the nine design HTML files reported by CI.
- Run `pnpm format:check`.

### Phase 1: Global Polish

Files:

- `src/app/globals.css`
- `src/styles/theme.css`
- `src/lib/display-label.ts`
- `src/lib/display-label.test.ts`

Tasks:

- Add gradient heading utilities.
- Add motion tokens.
- Add interactive panel utility.
- Add label humanizer and tests.
- Apply gradients selectively to page headings.
- Verify contrast manually and with browser inspection.

### Phase 2: Internal Pipeline

Files:

- `src/app/internal/pipeline/page.tsx`
- New: `src/app/internal/pipeline/_components/lifecycle-explorer.tsx`
- New: `src/app/internal/pipeline/_components/chunk-workbench.tsx`
- New: `src/app/internal/pipeline/_components/workflow-tables.tsx`
- New: `src/lib/source-thumbnail.ts`
- Optional tests for thumbnail and data derivation helpers.

Tasks:

- Stabilize route and data loading.
- Make global counts non-blocking.
- Add source thumbnail cards with at least one source per type.
- Add LLM hub insight bubbles.
- Add interactive schematic inspectors.
- Add rich retrieval event detail.
- Replace chunk viewer with chunk workbench.
- Add collapsed workflow tables and glowing status dots.

### Phase 3: Compare

Files:

- `src/app/compare/page.tsx`
- `src/app/compare/compare-phone-pickers.tsx`
- New or renamed: `src/app/compare/compare-picker-board.tsx`
- Optional: `src/app/compare/compare-metrics.ts`

Tasks:

- Support optional third phone.
- Generalize winner logic to N phones.
- Replace native selects with accessible rich picker.
- Add plus button for third phone.
- Animate selected slots and dropdown rows.
- Preserve two-phone URLs from recommendation links.

### Phase 4: Recommend

Files:

- `src/app/recommend/recommend-client.tsx`
- `src/lib/recommend-session.ts`
- Tests for snapshot reducer/session migration.

Tasks:

- Add recommendation snapshots.
- Add answer timeline.
- Animate latest/previous answer swaps.
- Improve card hover/focus states.
- Keep previous recommendations locally without extra API calls.

### Phase 5: QA and Hardening

Commands:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Browser checks:

- `/recommend`
  - Submit a query.
  - Submit a second query.
  - Previous answer remains accessible.
  - Latest answer can be restored.
  - Keyboard can operate timeline.

- `/compare`
  - Select two phones.
  - Add third phone with plus button.
  - Dropdown hover/focus shows image and specs.
  - URL with `a`, `b`, `c` renders correctly.

- `/internal/pipeline?phone=google-pixel-9-pro-xl`
  - Completes under 10 seconds.
  - YouTube source appears when present in source set.
  - Chunk click updates rich detail panel.
  - Workflow tables expand.
  - Schematic cards reveal inspectors.

## Acceptance Criteria

- CI formatting failure is resolved.
- No visible user-facing raw variable names with underscores remain in main app surfaces.
- Gradient headings improve visual richness while maintaining WCAG contrast.
- All new interactions work with mouse, keyboard, and reduced-motion settings.
- Pipeline selected-phone view does not hang on Pixel 9 Pro XL.
- Pipeline lifecycle feels active and explanatory without new external network calls.
- Compare supports 2 or 3 phones and keeps existing 2-phone URLs working.
- Recommend preserves previous answers locally and lets users switch between latest and previous recommendations smoothly.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Risk Register

### Risk: Custom compare dropdown accessibility regression

Mitigation:

- Use native semantics carefully.
- Add keyboard tests.
- Keep visible focus states.
- Do not rely on hover-only behavior.

### Risk: Pipeline page becomes heavy

Mitigation:

- Keep most animations CSS-only.
- Bound all data queries.
- Render deep tables collapsed.
- Derive insights from existing rows.

### Risk: Recommendation history creates confusing mental model

Mitigation:

- Label the active answer clearly.
- Keep "Latest answer" always visible.
- Avoid replacing conversation history; only snapshot recommendation sets.
- Use animation to communicate movement between hero area and timeline.

### Risk: Gradients hurt readability

Mitigation:

- Use gradients only on large display text.
- Keep fallback solid color.
- Avoid low-contrast gradient stops.
- Validate contrast manually.

### Risk: Variable-label formatter touches code identifiers

Mitigation:

- Only call formatter at render boundaries.
- Do not transform API keys, query params, schema keys, or form names.
- Add tests around intended outputs.

## Review Pass

### Senior UI/UX Designer Review

The plan keeps the brutalist editorial structure intact and adds beauty through material behavior: steel gradients, active grid lines, source thumbnails, and precise motion. It avoids rounded softness and decorative filler. The strongest design improvement is making the Pipeline page explain itself as a living system rather than a static dashboard. The compare picker and recommendation timeline also give users a clearer sense of place and continuity.

Adjustment made during review:

- Gradient text is limited to large headings only to protect readability and preserve the technical data-table feel.
- Source thumbnails are type-aware and restrained, not glossy editorial cards.
- Pipeline interactions reveal detail inline rather than using modal overlays, so the schematic remains the main object.

### Senior Web Developer Review

The plan is technically feasible within the existing Next.js architecture. It avoids new dependencies, keeps database calls bounded, and limits client components to interactive islands. The main engineering concern is the internal pipeline route and slow count queries; the plan explicitly handles both by preferring direct route stability and non-blocking optional metrics.

Adjustment made during review:

- Added a data-loading contract for Pipeline.
- Added no-live-GitHub-API rule for workflow tables.
- Added specific performance budgets and query limits.
- Added state model for recommendation snapshots before UI work.

### User Review

The plan serves the user goal: the app should feel more interesting, smooth, and desirable without losing clarity. It keeps terminology human-readable, makes past recommendations easy to revisit, allows richer comparison, and makes the internal pipeline understandable through visual storytelling.

Adjustment made during review:

- Added explicit "Latest answer" restoration behavior for Recommend.
- Added the requirement that YouTube sources must appear in Lifecycle Explorer when present.
- Added clear acceptance checks for Pixel 9 Pro XL on `/internal/pipeline`.
- Added status text alongside glowing dots so the UI is accessible and not color-only.

---

## Expert Critique & Remediation (Post-Review Pass)

This section documents findings from a deep code-level audit of the plan against the actual codebase, the DESIGN.md tokens, WCAG 2.2 requirements, and end-user experience. Each finding includes severity, the issue, and a concrete remediation that must be folded into implementation.

### Category A: Factual Errors & Incorrect Assumptions

#### A1. DESIGN.md path is wrong

**Severity:** Blocker for onboarding.

The Source References section pointed to `C:\Users\rohan\Documents\RECSY\Docs\DESIGN.md`. The actual path is `design/stitch_recsy_modern_platform_redesign/technical_editorial/DESIGN.md`. This has been corrected above.

#### A2. `scorecardRuns` table exists but the plan assumes it will be queried — pipeline page does not query it today

**Severity:** Medium — data gap.

The plan references "Scorecard generation" tables from `scorecardRuns`, but the current `loadPipelineData()` does not query `scorecardRuns` at all. The `scorecardRuns` table (schema line 303) has columns: `phoneId`, `aspect`, `status`, `score`, `confidence`, `nSources`, `durationMs`, `error`, `startedAt`, `finishedAt`.

**Remediation:** Add an explicit `optionalQuery` call for `scorecardRuns` in the data-loading contract, limited to 8 rows ordered by `startedAt desc`. Filter by `selectedPhone.id` when a phone is selected, or show global latest when no phone is selected. This is a new DB call — document it in the Performance Plan section. The `scorecardRuns` table has an index on `phoneId` and `startedAt`, so this query will be fast.

#### A3. `extractedRequirements` is a JSONB field, not a typed array — plan treats it loosely

**Severity:** Low — but implementation will hit this.

The plan says retrieval event should show "matched preference chips from `recommendationTurns.extractedRequirements`". The actual schema stores this as `jsonb('extracted_requirements').$type<Record<string, unknown>>()`. The service layer parses it via `userRequirementsSchema` in `src/services/recommender/session.ts`. The plan should specify that the pipeline page must apply the same Zod parse when displaying these chips, or else fall back to `topAspects` derivation.

**Remediation:** Add to Retrieval Event Rich Explanation: "Parse `extractedRequirements` via `userRequirementsSchema` (imported from `@/services/recommender/session`). If parse fails, fall back to deriving preference chips from `deviceAspects` sorted by confidence."

#### A4. `motion` library is v12 — not `framer-motion`

**Severity:** Low — naming only.

The plan references `AnimatePresence` and `layout` transitions from `motion`. The package is `motion` v12.38.0 (the rename of framer-motion). Import paths should be `from 'motion/react'`, not `from 'framer-motion'`. The plan should make this explicit to avoid confusion during implementation.

**Remediation:** Add a note under the Bundles section: "Import from `motion/react` (not `framer-motion`). The project uses the `motion` package v12+."

### Category B: Design System Alignment Issues

#### B1. Steel gradient stops may violate DESIGN.md luminance rules

The DESIGN.md says: "High-luminance off-whites and pure whites are reserved for typography." The proposed gradient goes from `#ffffff` → `#bfc3c4` → `#747879`. The darkest stop `#747879` has a luminance of ~0.18 against the `#000000` background, yielding a contrast ratio of approximately 4.1:1. This barely passes WCAG AA for large text (3:1) but could fail if the gradient blends toward the dark end in the middle of a word.

**Remediation:** Raise the darkest gradient stop to `#8e9192` (the `--outline` token, luminance ~0.29, contrast ~6.3:1 against black). This keeps the gradient visible and stays safely above the 3:1 large-text threshold. Update the gradient definition to: `linear-gradient(135deg, #ffffff 0%, #c4c7c8 55%, #8e9192 100%)`.

#### B2. The accent-edge gradient uses `rgb(216 107 56 / 0.55)` — semi-transparent orange on black yields muddy brown

**Severity:** Medium — visual quality.

A 55% opacity orange on pure black computes to approximately `#6d3a1c`, which is a dark brown that won't read as "warm accent edge" — it'll look dirty. This defeats the purpose.

**Remediation:** Use an opaque color blended against black instead: `#a85a2c` or increase opacity to `0.80`. Better: use the accent at full opacity but restrict to the final 5% of the gradient width so it's a hairline warm flare, not a muddy wash. Revised: `linear-gradient(135deg, #ffffff 0%, #c4c7c8 50%, #8e9192 92%, #d86b38 100%)`.

#### B3. DESIGN.md says shapes are "strictly Sharp (0px)" — but source bubbles in Discovery use `rounded-full`

The current pipeline source icons use `rounded-full` (a circle). The DESIGN.md explicitly states: "Any rounding is avoided. The only exception is for circular icon buttons." The source icon bubbles are acceptable under this exception since they are icon containers, but the plan proposes "Bubble/card hybrid: circular icon anchor plus rectangular expanding detail" for source thumbnails. This is fine — just document that the circular portion is an icon button exception, not a new shape pattern, so implementers don't start rounding other things.

**Remediation:** Add a note to Source Thumbnails: "The circular icon anchor is the DESIGN.md icon-button exception. The rectangular detail panel, all borders, and all other containers remain 0px radius."

#### B4. Missing `letterSpacing` alignment with DESIGN.md tokens

DESIGN.md specifies `display-xl` at `-0.04em` and `headline-lg` at `-0.02em`, but the existing CSS uses `tracking-normal` (0em) on `.display-heading` and most `font-display` usages in TSX. The plan's gradient headings inherit this 0em tracking. The gradient headings should adopt the DESIGN.md negative tracking to feel properly "architectural".

**Remediation:** Add to Steel Gradient Heading System: "Apply `letter-spacing: -0.04em` on `display-xl` scale (≥80px) and `-0.02em` on `headline-lg` scale (48px). Update `.display-heading` in globals.css to match."

### Category C: Engineering & Performance Issues

#### C1. Pipeline page has 7 `count(*)` queries on page load — plan says "make non-blocking" but doesn't specify which to remove

The current `loadPipelineData()` fires `count(*)` on `phones`, `sources`, `chunks`, `crawlQueue` (×2 — queued + running). The plan says "avoid raw count(\*) on large tables" but keeps them as metrics cards. The `sources` and `chunks` tables could be very large.

**Remediation:** Wrap the three global counts (`phoneCountRows`, `sourceCountRows`, `chunkCountRows`) in individual `optionalQuery()` calls with 800ms timeouts and fallback `"—"`. Move them out of the main `Promise.all` so they don't block phone-specific data. The queue counts are on small indexed subsets and can stay in the main batch.

#### C2. Recommend snapshot localStorage vs sessionStorage conflict

The current `recommend-session.ts` uses `sessionStorage` (scoped to tab, clears on close). The plan proposes "Persist last 8 snapshots in localStorage through `recommend-session`." This is a fundamental change: localStorage persists across tabs and browser restarts. The plan should explicitly address:

- Migration from sessionStorage v1 to localStorage v2.
- What happens if user has a v1 sessionStorage entry AND a v2 localStorage entry.
- Tab isolation: two tabs could write conflicting snapshots to the same localStorage key.

**Remediation:** Add under Storage:

1. Use a new key `recsy:recommend:snapshots:v2` in localStorage.
2. On first load, if `recsy:session:recommend:v1` exists in sessionStorage, migrate it as the initial snapshot, then delete the sessionStorage entry.
3. Use a write-lock pattern: read → merge → write, never blind overwrite. Or scope the key per-tab using a tab-session ID stored in sessionStorage.
4. Set a max payload size guard (e.g., 256KB) by truncating `assistantText` and `picks[].summary` if the serialized payload exceeds the limit.

#### C3. Compare picker: custom combobox is a high-complexity accessibility component

The plan says "Use `role="combobox"` or button plus `role="listbox"` depending implementation." This is too vague for a WCAG 2.2-critical component. The ARIA Authoring Practices Guide (APG) combobox pattern is notoriously hard to get right.

**Remediation:** Commit to one pattern: a **disclosure button + listbox** (simpler, fewer ARIA states). Specifically:

- Trigger: `<button aria-haspopup="listbox" aria-expanded="{open}">`.
- Panel: `<ul role="listbox">` with `<li role="option" aria-selected>`.
- Active descendant: manage via `aria-activedescendant` on the listbox.
- Do NOT attempt a true combobox with text input + filtering unless search is needed (it isn't — the phone list is small enough to scroll).
- Add a reference to the APG Listbox pattern: https://www.w3.org/WAI/ARIA/apg/patterns/listbox/

#### C4. Compare picker hover-expand adds layout shift risk

The plan says dropdown options "expand on hover/focus" to show image and specs. If this changes the option height, it will shift all options below, creating a jumpy experience — especially on keyboard nav where focus moves through the list rapidly.

**Remediation:** Use a fixed-height option row (e.g., 64px) that contains a hidden detail region. On hover/focus, reveal the detail via `opacity` and `transform: translateY` within a positioned overlay or `position: absolute` detail card anchored to the option — NOT by expanding the option's height. Alternatively, show the expanded detail in a fixed sidebar/preview pane next to the listbox, so the list itself never shifts.

#### C5. `loadComparePickerOptions()` query needs new fields for the rich picker

The plan says the picker receives `slug, label, brand, model, imageUrl, msrpUsd, and basic specs derived from specJson`. Currently `loadComparePickerOptions()` only selects `slug, brand, model`. Adding `imageUrl, msrpUsd, specJson` to every option means sending potentially large specJson blobs to the client for 20+ phones.

**Remediation:** Select only the specific fields needed: `slug, brand, model, imageUrl, msrpUsd` and extract a narrow spec subset server-side (battery_mah, display.refresh_rate_hz, rear_cameras[0].mp) into a `miniSpec` object. Do NOT send raw `specJson` to the client. Estimate: ~200 bytes per option × 25 phones = ~5KB — acceptable.

#### C6. Three-phone comparison: `specLine()` function is hardcoded for left/right

The current `specLine()` function returns a `<tr>` with exactly 3 `<td>` cells (label, left, right). The `Winner` type is `'left' | 'right' | 'tie' | null`. Extending to 3 phones requires rewriting both the function signature and the winner logic. The plan acknowledges this with `ComparisonMetric` but doesn't address that the entire compare page.tsx rendering is structurally 2-column.

**Remediation:** Add an explicit refactoring note: "Replace `specLine()` and the `Winner` type entirely with a `ComparisonRow` component that accepts `N` values. The phone header cards grid must switch from `sm:grid-cols-2` to dynamic `grid-cols-{N}`. The spec table must render N+1 columns (label + N phones). Test with 2 and 3 phones to ensure the table doesn't overflow on mobile — add horizontal scroll for 3-phone comparisons on screens < 768px."

#### C7. No debounce on recommendation timeline rapid clicks

The plan describes switching snapshots as "local state only" which is fast, but rapid clicking on timeline items while `AnimatePresence` layout transitions are mid-flight could cause visual glitches (overlapping exit/enter animations).

**Remediation:** Add: "When a timeline item is clicked, immediately set `activeSnapshotId` but debounce the visual transition with a minimum 100ms gap. Use `AnimatePresence mode="wait"` to ensure exit completes before enter begins. Alternatively, use `mode="popLayout"` for overlapping transitions if the effect is smoother."

#### C8. Next.js Image Config for Remote Thumbnails

The plan says to use `https://i.ytimg.com/vi/{id}/hqdefault.jpg` for YouTube thumbnails. In Next.js, if these are rendered using the `<Image>` component, the external domain must be explicitly whitelisted in `next.config.ts`, otherwise the image will fail to load in production.

**Remediation:** Add a step in Phase 2: "Update `next.config.ts` (or `.js`) to include `i.ytimg.com` in the `images.remotePatterns` array. If using raw `<img>` instead of `next/image` to bypass this, specify `loading="lazy"` and explicit width/height to prevent Cumulative Layout Shift (CLS)."

#### C9. Compare Form Submission Page Reload breaks motion

The plan says: "Generate hidden inputs `a`, `b`, `c`... Preserve no-JS fallback". If the picker uses a standard HTML form submission, it will trigger a hard full-page reload. This breaks the smooth, app-like transition and clears any ephemeral layout animations.

**Remediation:** Add to Submission: "Intercept the form submit with `e.preventDefault()`. Use `const router = useRouter()` from `next/navigation` to perform a client-side navigation: `router.push('/compare?' + new URLSearchParams({ a, b, c }).toString())`. This ensures the UI updates smoothly without a hard refresh."

### Category D: UX & Interaction Design Issues

#### D1. Recommendation timeline mental model needs visual hierarchy

The plan says "Latest answer is first and visually active." But "first" is ambiguous — is it leftmost (chronological) or rightmost (most recent)? For a horizontal rail, users expect the most recent on the right (timeline convention). But for vertical stacked rows on mobile, most recent on top is more natural.

**Remediation:** Specify: "Desktop horizontal rail: most recent (latest) answer anchored to the LEFT (first in reading order), with older answers flowing right. This mirrors chat convention where newest is most prominent. Mobile stacked: most recent on TOP. Active item uses a 2px left border accent + `text-gradient-steel` on the query excerpt. Inactive items use 1px `outline-variant` border."

#### D2. The plan doesn't address what happens to the conversation panel when switching snapshots

Currently, the conversation panel (`lines` state) shows the full chat thread. When the user switches to a previous snapshot, should the conversation panel also rewind to show the conversation up to that point? Or stay showing the full thread?

**Remediation:** Add to Recommendation Snapshot State Model: "Each snapshot includes a `conversationUpToIndex` number indicating the last line index from the conversation that was visible when this recommendation was generated. When switching snapshots, the conversation panel scrolls to and highlights that index, but does NOT remove later lines. A faint horizontal divider marks 'Recommendations generated here' at the snapshot boundary. This preserves full conversation context while showing the user which part of the conversation produced the active results."

#### D3. Pipeline insight bubbles auto-animation may be distracting for a dashboard

The plan describes bubbles that "gently pop in/out using opacity and small Y movement." For a dashboard that engineers may keep open for extended periods, persistent ambient motion is a known source of cognitive fatigue and can trigger motion sensitivity issues even below the 3-flashes threshold.

**Remediation:** Make the bubble auto-animation fire only ONCE on initial render (a staggered entrance), then settle into a static layout. Hover/focus interactions still animate individually. Remove the perpetual pop-in/pop-out cycle. This keeps the "lively" first impression without the fatigue of ongoing ambient motion. Add a CSS class `bubble-entrance` with `animation-fill-mode: forwards` and `animation-iteration-count: 1`.

#### D4. Chunk workbench split layout may not work on narrow viewports

The plan proposes a left-right split ("Left: source rows and chunk chips. Right: active chunk detail panel"). On mobile or narrow internal dashboard views, this becomes unusable.

**Remediation:** Add: "On viewports < 768px, the chunk workbench uses a stacked layout: source/chunk list on top, selected chunk detail below in a collapsible `<details>` element. The detail panel uses `position: sticky; bottom: 0` so it's always visible while scrolling chunks."

#### D5. "Rate 450MB/s", "Latency 12ms", "Capacity 78%" in the schematic cards are hardcoded fake values

The current pipeline schematic cards show hardcoded strings like `'450MB/s'`, `'12ms'`, `'78%'` that are not computed from any data. The plan adds interactive inspectors below the cards but doesn't address these fake metrics.

**Remediation:** Replace hardcoded values with derived values from already-loaded data:

- Ingest: "Sources: {deviceSources.length}" / "Latest: {latestSourceDate}"
- Process: "Chunks: {deviceChunks.length}" / "Aspects: {deviceAspects.length}"
- Retrieve: "Queries: {sampleTurns.length}" / "State: {retrievalState}"

Or remove the stat/value row entirely and let the inspector provide the real data. Do not ship fake metrics.

#### D6. No empty/error states specified for the recommendation timeline

What does the timeline look like when there are zero snapshots? What if localStorage is corrupted? What if the user clears browser data mid-session?

**Remediation:** Add: "Zero snapshots: the timeline rail is hidden entirely (not shown with 'no history' text). If localStorage read fails or data is corrupted, silently fall back to empty snapshots array and log a console warning. The current session's recommendations remain unaffected since they live in React state. On corruption, clear the localStorage key to prevent repeated parse errors."

#### D7. Mobile Chunk Workbench Auto-Scroll Disconnect

Following remediation D4 (stacking the workbench on mobile), if the user clicks a chunk near the top of a long list, the detail panel fixed at the bottom might not grab their attention, or the list might be so long that the connection between the click and the detail update is lost.

**Remediation:** Add: "On viewports < 768px, when a user selects a chunk, programmatically scroll the viewport so the detail `<details>` panel is fully visible (e.g., using `element.scrollIntoView({ behavior: 'smooth' })`)."

#### D8. Missing Error State for Pending Recommendations

The plan describes animating the "Pending query" as a thin scanline placeholder, but omits what happens if the backend API fails, times out, or returns a 500 error.

**Remediation:** Add: "If the recommendation API fails, the pending timeline item must transition to an error state (e.g., outline border turns to `var(--error)` and text reads 'Failed to generate'). The main hero area should present a 'Retry' button using the `meta-mono` text style. Never leave the user stuck in an infinite scanline animation."

#### D9. Three-Phone Compare "Squish" on Small Desktops

On screen sizes around 1024px, dividing the main container into three equal columns might squish the technical specs (which use long strings like `256GB, 512GB, 1TB`) causing ugly text wrapping or layout breaks.

**Remediation:** Add: "In the Compare table and picker board, set a `min-width` for each phone slot (e.g., `min-w-[280px]`). If the viewport is too narrow to comfortably fit 3 slots, apply `overflow-x: auto` and `snap-x mandatory` to the container, allowing the user to smoothly scroll horizontally rather than breaking the layout."

### Category E: Missing Specifications

#### E1. No mobile responsive breakpoint specs for any new component

The plan mentions "horizontal rail on desktop and stacked collapsed rows on mobile" for the timeline but provides no breakpoint values. The compare picker, chunk workbench, and pipeline inspector also lack responsive specs.

**Remediation:** Add a global responsive contract:

- `< 640px (sm)`: Single column everywhere. Timeline stacked. Compare picker full-width stacked slots. Pipeline inspector below schematic full-width.
- `640–1024px (md)`: Two-column where applicable. Timeline horizontal. Compare picker side-by-side (2 slots).
- `> 1024px (lg)`: Full layout as designed. Three-column pipeline, side-by-side chunk workbench.

#### E2. No specification for transitions between compare picker states

The plan says the "+" button adds a third slot with `layout` animation but doesn't specify what happens to the existing two slots. Do they shrink? Does the grid reflow? What's the animation duration?

**Remediation:** Add: "When the third slot is added, the grid transitions from `grid-cols-2` to `grid-cols-3` using CSS `transition: grid-template-columns var(--motion-medium) var(--ease-editorial)`. The existing two slots shrink proportionally. The third slot fades in with `opacity 0→1` and `translateX(20px)→0` over `var(--motion-medium)`. The "+" button itself animates into the third slot (it becomes the slot). When removed, reverse the animation."

#### E3. No loading skeleton for pipeline inspector panels

When a schematic card is clicked, the inspector opens below. If the data is already loaded (it should be from `loadPipelineData`), the content appears instantly. But if a future optimization lazy-loads inspector data, there's no loading pattern specified.

**Remediation:** Since all inspector data is derived from already-loaded rows, the inspector should render synchronously. Add a note: "Inspector content is derived from props, never fetched on click. If a future iteration adds lazy data, use a 3-line skeleton with `animate-pulse` on `surface-container` backgrounds, matching the inspector panel height."

#### E4. No specification for how the "why this phone surfaced" chips are computed

The plan says to show chips like "Matched camera priority", "Battery evidence available", "Within budget". But doesn't specify the logic to derive these from the stored data.

**Remediation:** Add derivation rules:

- "Matched {aspect} priority": Show if `deviceAspects` contains an aspect that appears in `extractedRequirements.priorities` (after Zod parse).
- "Evidence available": Show for any aspect where `nSupporting > 0`.
- "Within budget": Show if `spec.msrpUsd` exists AND `extractedRequirements.budget` exists AND `msrpUsd <= budget`.
- "Scorecard confidence": Show if average `confidence` across `deviceAspects` > 0.6.
- Maximum 4 chips to avoid clutter.

### Category F: Additional Risks

#### F1. Risk: `motion/react` layout animations on server-rendered content cause hydration mismatch

`motion` components render with initial animation state on the server but animate on the client. If `layoutId` is used on server-rendered recommendation cards, the initial render won't match.

**Mitigation:** Use `motion` components only inside `'use client'` components that mount after hydration. The `RecommendClientLoaded` component already gates on `useClientMounted()`, so layout animations should be safe there. Add the same gate to the compare picker board. Do NOT add `motion` to server-rendered pipeline page sections — keep those CSS-only.

#### F2. Risk: localStorage quota on mobile Safari

Mobile Safari has a 5MB localStorage quota. With 8 snapshots each containing picks with summaries and conversation lines, the payload could grow large.

**Mitigation:** Add a payload size check before write. If `JSON.stringify(snapshots).length > 200_000` (200KB), evict the oldest snapshots until under limit. Truncate `assistantText` to 500 chars and `picks[].summary` to 200 chars in stored snapshots (display text is ephemeral anyway).

#### F3. Risk: YouTube thumbnail `hqdefault.jpg` returns 404 for deleted/private videos

**Mitigation:** Use `<img>` with an `onError` handler that replaces the `src` with the type-tile fallback. Since this is a client-rendered image, the fallback is straightforward. Add `loading="lazy"` since these are in the lifecycle explorer which may be below the fold.

### Summary of Changes Made to This Plan

1. **Fixed** incorrect DESIGN.md path in Source References.
2. **Added** 22 issue findings across 6 categories (Errors, Design Alignment, Engineering, UX, Missing Specs, Risks).
3. **Each finding** includes severity, root cause, and a concrete remediation.
4. **Key technical corrections:** scorecardRuns query gap, localStorage vs sessionStorage migration path, motion import path, combobox ARIA pattern commitment, fake pipeline metrics, gradient contrast math, `next/image` config for YouTube, and SPA client-side routing for Compare.
5. **Key UX corrections:** bubble animation fatigue, timeline directionality, conversation panel behavior on snapshot switch, chunk workbench responsive layout, compare hover layout shift prevention, mobile auto-scroll, and error states.
6. **No existing plan content was removed.** All original sections remain intact.
