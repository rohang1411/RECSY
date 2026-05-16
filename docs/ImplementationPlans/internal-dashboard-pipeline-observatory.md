# RECSY Pipeline Observatory — Internal Dashboard

> **Status**: Approved for implementation (2026-05-13).
> **Access**: `/internal/pipeline` — a separate URL opened manually, NOT linked from public nav.
> **Gate**: Only renders when `INTERNAL_DASHBOARD_ENABLED=true` in env. Returns 404 otherwise.

## 1. What This Is

An internal-only dashboard that visually showcases the entire RECSY data lifecycle for demos and portfolio presentations. It must feel **alive** — animated, data-backed, and modern — not like a stale admin panel.

**Primary audience**: Collaborators, recruiters, reviewers who need to understand RECSY's engineering without reading the codebase.

**Key constraint**: Read-only. Never mutates data. Retrieval and recommendation replays use **pre-computed cached results**, not live LLM calls (to avoid Gemini token cost during demos).

## 2. Project Context (for Codex)

RECSY v2 is a smartphone recommendation app. Key subsystems:

- **Ingestion**: Adapters (YouTube, Reddit, Article) discover review content → fetch → chunk → embed → store in Postgres
- **Storage**: `phones` (20 catalog entries), `sources` (ingested artifacts), `chunks` (embedded text segments with 768-dim vectors), `aspects` (scorecard scores per phone×aspect)
- **Retrieval**: Hybrid search (vector cosine + FTS + RRF fusion + MMR diversity + source coverage) produces grounded context for Q&A
- **Scorecard**: Batch pipeline extracts 7-axis consensus (camera, battery, performance, display, build, software, value) from chunks
- **Recommender**: Extracts structured requirements from user message → filters catalog → aspect-weighted scoring + semantic bump → top 3 diverse picks

### Tech Stack

- Next.js 16 (App Router), React 19, TypeScript strict
- Tailwind CSS v4 with OKLCH semantic tokens (dark default)
- `motion` (Framer Motion) for animations
- `lucide-react` for icons
- Fonts: Inter (body), JetBrains Mono (data/code)
- Drizzle ORM → Supabase Postgres + pgvector
- Design tokens in `src/styles/theme.css`, aliased in `src/app/globals.css`

### Key Schema Tables

| Table                  | Purpose                           | Key Columns                                                                                                                                 |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `phones`               | Catalog (20 phones)               | `slug`, `brand`, `model`, `spec_json`, `spec_embedding`, `status`, `image_url`, `msrp_usd`, `last_ingest_at`, `next_ingest_at`              |
| `sources`              | Ingested artifacts                | `phone_id`, `type` (youtube/reddit/article), `url`, `title`, `relevance`, `quality`, `sentiment_summary`, `aspects_covered`, `content_hash` |
| `chunks`               | Text segments with embeddings     | `source_id`, `phone_id`, `text`, `embedding` (768d), `start_ts`, `anchor`, `tokens`                                                         |
| `aspect_definitions`   | Methodology per axis              | `aspect`, `query_prompts`, `default_weight`, `version`                                                                                      |
| `aspects`              | Scorecard output per phone×aspect | `phone_id`, `score`, `confidence`, `n_sources`, `summary`, `supporting_quotes`                                                              |
| `ingest_runs`          | Telemetry per source attempt      | `adapter`, `phone_id`, `status` (started/success/failed/skipped), `chunks_created`, `rejected_reason`, `tier`                               |
| `chat_queries`         | Q&A logs                          | `phone_id`, `query`, `answer`, `citations`, `latency_ms`, `model`                                                                           |
| `recommendation_turns` | Recommender history               | `user_message`, `extracted_requirements`, `picks`, `candidate_phone_ids`                                                                    |
| `llm_cache`            | Cached LLM responses              | `prompt_hash`, `model`, `hits`, `last_hit_at`                                                                                               |
| `source_phone_links`   | Many-to-many source↔phone         | `source_id`, `phone_id`, `role` (primary/secondary)                                                                                         |

Schema is defined in `src/services/db/schema.ts`. DB client in `src/services/db/client.ts`.

### Key Existing Service Code

| Service                | Location                                          | What It Returns                                                                                                                               |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Hybrid retrieval       | `src/services/retrieval/retriever.ts`             | `RetrievalResult` with `chunks[]` + `debug: RetrievalDebug` (per-stage counts & timings)                                                      |
| Retrieval types        | `src/services/retrieval/types.ts`                 | `RetrievalDebug` interface: `vector{count,ms}`, `fts{count,ms}`, `rrf{count,ms}`, `mmr{count,ms}`, `coverage{sourceCount,relaxed}`, `totalMs` |
| Ask trace builder      | `src/lib/ask-retrieval-trace.ts`                  | `AskRetrievalTrace` — serializable stage summary for client                                                                                   |
| Recommender pipeline   | `src/services/recommender/run-recommendation.ts`  | `RecommendPipelineResult` with `picks[]`, `relaxed[]`, `scoresTied`, `scorecardMissing`, `topAspects`                                         |
| Ranking logic          | `src/services/recommender/match.ts`               | `rankCandidates()` returns `RankResult` with `picks`, `weights`, `scoresTied`, `scorecardMissing`                                             |
| Requirements schema    | `src/services/recommender/requirements-schema.ts` | `UserRequirements` type                                                                                                                       |
| Catalog loader         | `src/services/recommender/catalog.ts`             | `loadRecommendationCatalog()` returns `PhoneCatalogEntry[]`                                                                                   |
| Ingestion orchestrator | `src/services/ingest/orchestrator.ts`             | `PhoneIngestSummary` with per-adapter breakdown                                                                                               |
| Ingestion writer       | `src/services/ingest/writer.ts`                   | Transactional write to sources + chunks                                                                                                       |
| Scorecard agent        | `src/services/scorecard/agent.ts`                 | Extracts aspect scores from chunks                                                                                                            |

### Existing Design Tokens (from `src/styles/theme.css`)

The app uses semantic OKLCH color variables. Key ones for the dashboard:

- `--primary` (orange), `--accent` (cyan/turquoise)
- `--background`, `--foreground`, `--card`, `--card-foreground`
- `--muted`, `--muted-foreground`, `--border`
- `--success`, `--warning`, `--destructive`
- `--chart-1` through `--chart-5` (for data viz)
- `--radius` (border radius token)

Dark mode is default (`data-theme="dark"`). Use Tailwind utilities: `bg-card`, `text-foreground`, `border-border`, etc.

## 3. Design Specification

### Overall Aesthetic

The dashboard must match RECSY's existing visual language but feel like a **premium internal tool**:

- **Dark-first** with glassmorphic cards (`backdrop-blur-xl`, semi-transparent backgrounds)
- **Glowing accents**: Subtle border-glow on active/hovered elements using `box-shadow` with primary/accent colors
- **Alive feel**: Pulsing status indicators, animated data-flow lines, smooth transitions between views
- **Data-dense but scannable**: Monospace (JetBrains Mono) for numbers/data, Inter for labels
- **No dead whitespace**: Every area communicates something

### Color Assignments for Pipeline Stages

Use existing chart tokens + extend:

- Catalog/Phones: `--chart-1` (warm)
- Ingestion: `--chart-2`
- Sources/Chunks: `--chart-3`
- Scorecard: `--chart-4`
- Retrieval: `--accent` (cyan)
- Recommendation: `--primary` (orange)
- YouTube sources: red-ish (`oklch(0.65 0.2 25)`)
- Reddit sources: blue-ish (`oklch(0.65 0.15 260)`)
- Article sources: green-ish (`oklch(0.65 0.15 155)`)

### Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  RECSY Pipeline Observatory          [Phone Picker ▼]│  ← Sticky header
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─ Pipeline Hero Diagram ────────────────────────┐ │  ← Animated SVG flow
│  │ Catalog → Ingest → Sources → Chunks → Score →  │ │     with live counts
│  │          Retrieval → Recommend                  │ │     Click node = scroll
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Corpus Overview ──────────────────────────────┐ │  ← Metric cards grid
│  │ [Phones] [Sources] [Chunks] [Aspects] [Queries]│ │
│  │ [Cache Hits] [Ingest Runs] [Freshness]         │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Database Map ─────────────────────────────────┐ │  ← Grouped table cards
│  │ Catalog | Corpus | Scorecard | Ops | Usage     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  (Below: Phone Evidence, Retrieval, Recommendation  │
│   sections appear when phone is selected)            │
└─────────────────────────────────────────────────────┘
```

### Component Specifications

#### Pipeline Hero Diagram

- Horizontal flow of 7 connected nodes (SVG)
- Each node: rounded rect with icon + label + live count
- Connection lines with animated dashes (CSS `stroke-dashoffset` animation)
- Subtle particle dots flowing along connections (CSS keyframes)
- Nodes glow on hover, clicking scrolls to relevant section
- Must render at full viewport width

#### Metric Cards

- Glass effect: `bg-card/50 backdrop-blur-xl border border-border/50`
- Large number in JetBrains Mono, label below in Inter
- Subtle gradient underline in the stage color
- Hover: slight scale + glow

#### Phone Evidence Lens

- Source cards: type icon (YouTube/Reddit/Article), title, quality/relevance bars, sentiment badge, aspects as small tag pills
- Chunk viewer: virtual-scrolled list, each chunk shows text excerpt (truncated, expandable), token count, source attribution, YouTube timestamp link if applicable
- Scorecard radar: 7-axis radar chart (use SVG polygon, no heavy chart lib needed for radar)

#### Retrieval Funnel

- Horizontal stacked bars showing candidate count at each stage
- Each bar clickable to expand and show chunk details at that stage
- Animated: bars grow from left on load
- Color-coded: uses stage colors from the pipeline

#### Recommendation Score Breakdown

- Per-phone horizontal stacked bar showing: aspect score contributions (7 segments), must-have bonus, brand bonus, semantic bump
- Filter funnel above: "20 phones → N after budget → M after brand → K after deal-breakers → 3 picks"
- Requirements viewer: structured card showing extracted budget, priorities (bar chart), must-haves/deal-breakers as pills

### Animation Guidelines

Use `motion` (Framer Motion) for:

- Page section entry: `fadeInUp` with stagger on children (delay 0.05s per child)
- Pipeline nodes: `scale(0.95) → scale(1)` with spring
- Metric numbers: Counter animation from 0 to value on mount
- Connection lines: `stroke-dashoffset` CSS animation (2s loop)
- Funnel bars: `width: 0% → width: N%` with spring easing
- Panel expand/collapse: `AnimatePresence` with height animation

Respect `prefers-reduced-motion` (already handled in `globals.css`).

## 4. File Structure

```
src/app/internal/
  layout.tsx                        # Env gate + internal layout (no public nav)
  pipeline/
    page.tsx                        # Main observatory (RSC, fetches snapshot)
    _components/
      pipeline-hero.tsx             # Animated SVG pipeline diagram (client)
      corpus-overview.tsx           # Metric cards grid (server)
      database-map.tsx              # Grouped table cards (server)
      phone-evidence-section.tsx    # Phone evidence lens (client, loads on select)
      phone-picker.tsx              # Searchable phone dropdown (client)
      source-card.tsx               # Individual source card (client)
      chunk-viewer.tsx              # Virtual-scrolled chunk list (client)
      scorecard-radar.tsx           # 7-axis SVG radar (client)
      retrieval-section.tsx         # Retrieval replay section (client)
      retrieval-funnel.tsx          # Stage funnel visualization (client)
      recommend-section.tsx         # Recommendation replay section (client)
      score-breakdown.tsx           # Per-phone score decomposition (client)
      requirements-viewer.tsx       # Structured requirements card (client)
      metric-card.tsx               # Reusable glassmorphic stat card (client)
      animated-counter.tsx          # Number counter animation (client)
      evidence-timeline.tsx         # Ingest history timeline (client)
      section-heading.tsx           # Reusable section header with icon (server)
      guided-walkthrough.tsx        # Step-through walkthrough overlay (client)

src/services/internal/
  pipeline-snapshot.ts              # Aggregate queries for overview metrics
  phone-evidence.ts                 # Phone-level evidence queries
  retrieval-explain.ts              # Pre-computed retrieval replay data
  recommend-explain.ts              # Pre-computed recommendation replay data
```

## 5. Data Service Layer

### `src/services/internal/pipeline-snapshot.ts`

Exports `getPipelineSnapshot()` that returns:

```ts
interface PipelineSnapshot {
  phones: { total: number; withEvidence: number; withScorecard: number; withSpecEmbedding: number };
  sources: { total: number; byType: Record<string, number> }; // { youtube: 3, article: 7, reddit: 0 }
  chunks: { total: number; avgPerPhone: number };
  aspects: { total: number; phonesWithAspects: number };
  ingestRuns: { total: number; byStatus: Record<string, number> }; // { success: 8, skipped: 3, failed: 2 }
  chatQueries: { total: number };
  recommendationTurns: { total: number };
  llmCache: { total: number; totalHits: number };
  freshness: { newestIngest: Date | null; oldestIngest: Date | null; overduePhones: number };
  tableGroups: TableGroup[];
}

interface TableGroup {
  name: string; // e.g. "Catalog", "Corpus", "Scorecard"
  description: string;
  tables: { name: string; rowCount: number; purpose: string; writtenBy: string; readBy: string }[];
}
```

Implementation: Use Drizzle `select({ count: count() }).from(table)` queries. Group into a single function with `Promise.all` for parallel execution. The table groups metadata is static (hardcoded descriptions), only row counts are dynamic.

### `src/services/internal/phone-evidence.ts`

Exports `getPhoneEvidence(slug: string)` that returns:

```ts
interface PhoneEvidence {
  phone: {
    id: string;
    slug: string;
    brand: string;
    model: string;
    imageUrl: string | null;
    msrpUsd: string | null;
    specJson: Record<string, unknown>;
    hasSpecEmbedding: boolean;
    lastIngestAt: Date | null;
    nextIngestAt: Date | null;
  };
  sources: {
    id: string;
    type: string;
    url: string;
    title: string;
    author: string | null;
    relevance: string | null;
    quality: string | null;
    sentimentSummary: string | null;
    aspectsCovered: string[];
    publishedAt: Date | null;
    chunkCount: number;
  }[];
  chunks: {
    id: string;
    sourceId: string;
    text: string;
    tokens: number;
    startTs: number | null;
    anchor: string | null;
    sourceTitle: string;
    sourceType: string;
  }[];
  aspects: {
    aspect: string;
    score: string;
    confidence: string;
    nSources: number;
    summary: string;
    nSupporting: number;
    nDissenting: number;
  }[];
  ingestRuns: {
    id: string;
    adapter: string;
    status: string;
    chunksCreated: number;
    startedAt: Date;
    rejectedReason: string | null;
    tier: string | null;
  }[];
}
```

Implementation: Join queries using Drizzle with the phone's ID. Chunks should be paginated (limit 200, load more on demand).

### `src/services/internal/retrieval-explain.ts` and `recommend-explain.ts`

These return **pre-computed demo data** (not live LLM calls). Store demo scenarios as JSON fixtures:

```
fixtures/internal-demos/
  retrieval-pixel-9-pro-xl.json     # Pre-computed retrieval replay
  recommend-camera-phone.json       # Pre-computed recommendation replay
```

Generate these fixtures by running the real pipelines once with logging, then saving the intermediate state. Export functions:

```ts
// retrieval-explain.ts
export async function getRetrievalDemo(phoneSlug: string): Promise<RetrievalDemoData | null>;
// Returns pre-computed stage-by-stage data or null if no demo exists for this phone

// recommend-explain.ts
export async function getRecommendDemo(scenario: string): Promise<RecommendDemoData | null>;
// Returns pre-computed recommendation breakdown or null
```

For phones without pre-computed demos, the UI should show a "No demo data available for this phone" state.

## 6. Implementation Phases

### Phase 1 — Foundation + Pipeline Hero (do first)

**Files to create:**

1. `src/app/internal/layout.tsx` — Check `process.env.INTERNAL_DASHBOARD_ENABLED === 'true'`, return `notFound()` if not. Minimal layout with dark bg, no public header/nav.
2. `src/app/internal/pipeline/page.tsx` — RSC that calls `getPipelineSnapshot()` and renders the overview.
3. `src/services/internal/pipeline-snapshot.ts` — All aggregate queries.
4. `src/app/internal/pipeline/_components/pipeline-hero.tsx` — `'use client'` animated SVG diagram.
5. `src/app/internal/pipeline/_components/corpus-overview.tsx` — Metric cards grid.
6. `src/app/internal/pipeline/_components/database-map.tsx` — Grouped table cards.
7. `src/app/internal/pipeline/_components/metric-card.tsx` — Reusable glass card.
8. `src/app/internal/pipeline/_components/animated-counter.tsx` — Number animation.
9. `src/app/internal/pipeline/_components/section-heading.tsx` — Section header.

**Env change:** Add `INTERNAL_DASHBOARD_ENABLED` to `src/env.ts` (optional boolean, defaults to false).

**Verification:** `pnpm dev` → navigate to `localhost:3000/internal/pipeline` → see animated pipeline + live metrics.

### Phase 2 — Phone Evidence Lens

**Files to create:**

1. `src/services/internal/phone-evidence.ts` — Phone-level queries.
2. `src/app/internal/pipeline/_components/phone-picker.tsx` — Searchable dropdown listing all phones with evidence badges.
3. `src/app/internal/pipeline/_components/phone-evidence-section.tsx` — Full evidence panel (loads when phone selected).
4. `src/app/internal/pipeline/_components/source-card.tsx` — Expandable source card with quality bars.
5. `src/app/internal/pipeline/_components/chunk-viewer.tsx` — Virtual-scrolled chunk list. Use CSS `max-height` + `overflow-y: auto` with intersection observer for lazy loading (avoid adding `@tanstack/react-virtual` dependency unless needed).
6. `src/app/internal/pipeline/_components/scorecard-radar.tsx` — SVG 7-axis radar.
7. `src/app/internal/pipeline/_components/evidence-timeline.tsx` — Ingest run timeline.

**Verification:** Select `google-pixel-9-pro-xl` → see 7 sources, chunks, ingest timeline.

### Phase 3 — Retrieval Replay

**Files to create:**

1. `src/services/internal/retrieval-explain.ts` — Loads pre-computed demo JSON.
2. `fixtures/internal-demos/retrieval-pixel-9-pro-xl.json` — Pre-computed data. Create this by running a retrieval query in a script and saving the `RetrievalDebug` + chunk lists at each stage.
3. `src/app/internal/pipeline/_components/retrieval-section.tsx` — Retrieval replay UI.
4. `src/app/internal/pipeline/_components/retrieval-funnel.tsx` — Animated funnel bars.

**Pre-computing demo data:** Create a script `scripts/generate-internal-demos.ts` that:

1. Runs `HybridRetriever.search()` for a demo phone + question
2. Captures intermediate results (modify retriever to return them, or reconstruct from debug)
3. Saves to `fixtures/internal-demos/`

**Verification:** See funnel visualization with real stage data for the demo phone.

### Phase 4 — Recommendation Replay

**Files to create:**

1. `src/services/internal/recommend-explain.ts` — Loads pre-computed demo JSON.
2. `fixtures/internal-demos/recommend-camera-phone.json` — Pre-computed data.
3. `src/app/internal/pipeline/_components/recommend-section.tsx` — Recommendation replay UI.
4. `src/app/internal/pipeline/_components/score-breakdown.tsx` — Per-phone stacked score viz.
5. `src/app/internal/pipeline/_components/requirements-viewer.tsx` — Structured requirements card.

**Verification:** See requirements extraction, filter funnel, score decomposition for demo scenario.

### Phase 5 — Guided Walkthrough + Polish

**Files to create:**

1. `src/app/internal/pipeline/_components/guided-walkthrough.tsx` — Step-through overlay. State machine with ~8 steps. Each step highlights a section of the page, shows explanatory text, and provides Next/Back buttons. Use Framer Motion for spotlight/highlight transitions.
2. Embedding space visualization (PCA projection) — if time permits, add `src/app/internal/pipeline/_components/embedding-plot.tsx` that does client-side PCA on chunk embeddings for the selected phone and renders a 2D scatter plot.

**Polish tasks:**

- Micro-animations: pulse on status indicators, counter animations, stagger on card grids
- Responsive: ensure it works well on 1440p+ for presentations
- Loading states: skeleton loaders matching card shapes
- Empty states: honest messaging when data is missing

## 7. Guided Walkthrough Specification

The walkthrough is a **step-through state machine** (not scroll-driven). Implementation:

```ts
const WALKTHROUGH_STEPS = [
  {
    id: 'catalog',
    title: 'Phone Catalog',
    description: 'RECSY tracks 20 phones...',
    target: '#pipeline-catalog-node',
  },
  {
    id: 'ingestion',
    title: 'Ingestion Pipeline',
    description: 'Adapters discover and fetch reviews...',
    target: '#pipeline-ingest-node',
  },
  {
    id: 'sources',
    title: 'Stored Sources',
    description: 'Each source is a YouTube video, Reddit thread, or article...',
    target: '#corpus-sources',
  },
  {
    id: 'chunks',
    title: 'Evidence Chunks',
    description: 'Sources are split into retrievable text segments...',
    target: '#corpus-chunks',
  },
  {
    id: 'scorecard',
    title: 'Consensus Scorecard',
    description: '7-axis scorecard aggregates evidence...',
    target: '#pipeline-scorecard-node',
  },
  {
    id: 'retrieval',
    title: 'Hybrid Retrieval',
    description: 'Vector + FTS search, fused with RRF, diversified with MMR...',
    target: '#retrieval-section',
  },
  {
    id: 'recommendation',
    title: 'Recommendation Engine',
    description: 'Structured requirements → filtered catalog → ranked picks...',
    target: '#recommend-section',
  },
];
```

UI: A floating panel (bottom-right) with step title, description, step counter (3/7), and Back/Next/Close buttons. The target section scrolls into view and gets a subtle highlight border. Use `motion.div` for the panel entrance/exit.

## 8. Demo Scenario

Use `google-pixel-9-pro-xl` as the primary demo phone (richest evidence: 7 sources, 126 chunks).

Demo retrieval question: `"How is the camera in low light?"`
Demo recommendation message: `"I want the best camera phone under $1000"`

Pre-compute fixtures for these specific scenarios.

## 9. Security & Privacy

- Never expose: raw IP fields, `llm_cache.prompt_raw` full text, connection strings, API keys
- Chunk text is fine to show (it's from public reviews)
- Source URLs are fine (public content)
- `recommendation_turns.user_message` can be shown (demo data only)
- The env gate (`INTERNAL_DASHBOARD_ENABLED`) is the access control. No auth layer needed for MVP.

## 10. Dependencies

**No new npm dependencies should be needed.** Use:

- Existing `motion` for animations
- Existing `lucide-react` for icons
- Pure SVG for the pipeline diagram, radar chart, and funnel
- CSS animations for data flow effects
- Drizzle ORM for all queries (existing `src/services/db/client.ts`)

If chunk lists become too large, consider adding `@tanstack/react-virtual` but try CSS-based lazy loading first.

## 11. Acceptance Criteria

The dashboard is successful when someone can:

1. ✅ Open `/internal/pipeline` and immediately see an animated pipeline with live DB counts
2. ✅ Understand what each major table stores without reading code
3. ✅ Select a phone and inspect all its sources, chunks, and scorecard data
4. ✅ See a retrieval replay showing how a question becomes grounded context (funnel viz)
5. ✅ See a recommendation replay showing how a user message becomes ranked picks
6. ✅ Use the guided walkthrough to step through the system narrative
7. ✅ Tell the difference between "no data yet" and "data exists"
8. ✅ Feel that the dashboard looks modern, alive, and polished (not a debug screen)
