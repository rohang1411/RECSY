# RECSY — From Evidence to Choice

## Build-ready implementation and art-direction specification

Version: 1.0 · Prepared: 27 September 2026

Status: planning deliverable; implementation is not performed or approved by this document alone.

Audience: the implementing agent, visual designer, 3D artist, frontend engineer, RECSY maintainer, and reviewer. This document is deliberately prescriptive. Do not replace specified semantic scenes with generic boxes, floating dashboards, glowing hoops, or decorative particle pipelines.

## 0. Executive contract

Create a true, interactive 3D exhibit explaining how RECSY turns discovered phones and collected evidence into stored knowledge, recommendations, and cited answers. The visitor must recognise the same entities as they move through the story. Geometry, text, camera, and animation must express actual transformations, not merely accompany narration.

The direction is a **living product archive**: convincingly rendered phones, readable review documents, inspectable record collections, and evidence that unfolds into decisions. It is neither a sci-fi factory nor a room of display stands. Three-dimensional depth is used for continuity, relationships, grouping, and focus. Detailed prose remains readable HTML rather than perspective-distorted text baked into distant panels.

Success is not “all components exist.” Success is a visitor being able to explain where information came from, why a phone was excluded, why a remaining phone ranked higher, which passages supported an answer, and what uncertainty remains.

### 0.1 Non-negotiable requirements

1. Real 3D phones, depth, lighting, and continuous camera transitions; no 2D flowchart pretending to be 3D.
2. Distinct, carefully composed internal scenes, not one shared arrangement with renamed labels.
3. Every active object has an identity, meaningful content, and an inspectable role.
4. Automatic full tour and automatic local tours; pause, previous, next, replay, and exploration are first-class.
5. Pointer-centred zoom, free pan, touch, keyboard navigation, and stable default framing.
6. No exterior geometry/labels inside an internal scene. No information hidden behind controls.
7. Visible, accurate filtering, ranking, chunking, fusion, and evidence lineage.
8. Deterministic playback: seek, pause, replay, and reverse navigation reconstruct the same state.
9. Explicit distinction between recorded examples, illustrative data, and actual live execution.
10. Production websites and InfiniTune remain untouched during sandbox development.
11. Assets, code, fixtures, tests, art boards, performance evidence, and provenance travel together in the handoff.
12. Do not claim “buttery smooth,” “complete,” or “technically verified” without the corresponding evidence in section 20.

### 0.2 Scope and repository boundaries

Documentation destination (this file):

`C:/Users/rohan/Documents/RECSY/mobile_recommender/docs/ImplementationPlans/`

Authoritative application source to read:

`C:/Users/rohan/Documents/RECSY/mobile_recommender/`

Existing portfolio sandbox to preserve:

`C:/Users/rohan/Documents/Potfolio/rohang1411.github.io/src/test_architecture/recsy/`

Proposed NEW, isolated implementation directory:

`C:/Users/rohan/Documents/Potfolio/rohang1411.github.io/src/test_architecture/recsy-living-archive/`

Saving this plan in the application repository does not authorize installing the exhibit in the RECSY application. The intended initial output remains a portfolio architecture sandbox. Use an independently buildable Vite package inside the new sandbox so production entry points, dependencies, and lockfiles do not need changes. Keep the existing experiment available for comparison; do not overwrite it.

Before execution, inspect applicable AGENTS.md files, Git status, ignore rules, running ports, and current source revisions. If the target directory already exists, inventory it and preserve it before editing. Never delete another experiment to make room. Confirm the new sandbox is ignored using `git check-ignore`; if not, use repository-local `.git/info/exclude` for the exact sandbox path rather than modifying production tracking rules. An ignored sandbox needs an explicit external backup/export at handoff: Git commits do not preserve it automatically.

### 0.3 Source state and conflict precedence

The application checkout inspected for this plan reports HEAD `04b37f5c4eb7d76883f705a7efa21b9bf8d463fc`. It is dirty, including changes to `src/services/recommender/match.ts`, `src/services/catalog/promote.ts`, and UI/region handling. These are user-owned and were not modified for planning. HEAD alone therefore does not identify all inspected behaviour.

At implementation start, generate a manifest with source paths, SHA-256 hashes, HEAD, and dirty-status flag. Recheck particularly currency, filtering, catalog promotion, and workflow schedules. Do not silently “correct” application algorithms while illustrating them.

Precedence: current user constraints → verified executable application behaviour → this plan's semantic contract → older plans → previous sandbox fixtures. Existing fixtures are candidates for reuse, not truth. Comments may be stale; prefer executable branches and tests. Any conflict becomes a recorded issue with a decision, never an invented happy path.

## 1. Research findings that shape the build

### 1.1 Why the previous implementation is not the visual foundation

The current sandbox's `worlds/worldVisuals.js` builds repeated plinths and canvas-text sprites. `worlds/recommendationWorld.js` gives phones sinusoidal bobbing and places gate rings beside them. These movements are not sufficient to express a filtering event. The existing `engine/ReplayDirector.js` derives a few checkpoints from fixtures; a checkpoint description alone does not make geometry enact the operation.

Reuse only independently audited utilities: resource lifetime patterns, pure arithmetic tests, or fixtures with verified provenance. Do not reuse the station layout, room shells, text-panel grammar, or decorative animation loops. Do not port bugs merely to keep file names familiar.

### 1.2 Verified source map

All paths in this table are relative to the RECSY application root, not the portfolio root.

| Concern                        | Source of truth                                                                                                                          | Consequence for visualization                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Catalog discovery/enrichment   | `scripts/catalog-refresh.ts`, `scripts/catalog-sync-mobileapi.ts`, `scripts/catalog-enrich-oem.ts`, `scripts/catalog-enrich-gsmarena.ts` | Distinguish discovery from enrichment; a found candidate is not automatically a valid phone   |
| Candidate policy and promotion | `src/services/catalog/candidate-policy.ts`, `validation.ts`, `identity.ts`, `promote.ts`                                                 | Show identity resolution, eligibility and promotion outcomes; recheck dirty promotion source  |
| Imagery                        | `src/services/catalog/studio-media-resolver.ts`, `media-backfill.ts`, `.github/workflows/catalog-images.yml`                             | Image availability and rights are separate from the presence of a phone record                |
| Due work                       | `src/services/ingest/scheduler/tiers.ts`, `pick-phones.ts`, `pick-resume-phones.ts`, `crawl-queue.ts`                                    | Job triggers and per-phone due dates are different concepts                                   |
| Evidence processing            | `src/services/ingest/orchestrator.ts`, `agents/curator.ts`, `agents/disambiguator.ts`, `adapters/*`                                      | Sources differ; validation/curation are not decorative cleaning effects                       |
| Chunking and persistence       | `src/services/ingest/chunking.ts`, `hashing.ts`, `embedder.ts`, `writer.ts`                                                              | Sentence-aligned chunks, content identity, embeddings, atomic source update                   |
| Schema                         | `src/services/db/schema.ts`, `drizzle/`                                                                                                  | Render actual record relationships, not invented tables                                       |
| Aspect assessments             | `src/services/scorecard/agent.ts`, `definitions.ts`, `constants.ts`, `recency.ts`                                                        | Structured synthesis with supporting/dissenting evidence; confidence is not the score         |
| Recommendation                 | `src/services/recommender/extract-requirements.ts`, `requirements-schema.ts`, `match.ts`, `run-recommendation.ts`, `constants.ts`        | Structured extraction followed by deterministic filtering/ranking, diversity and fallbacks    |
| Retrieval                      | `src/services/retrieval/retriever.ts`, `types.ts`, `vector.ts`, `fts.ts`, `rrf.ts`, `mmr.ts`, `coverage.ts`                              | Parallel search, ranked-list fusion, diversity, coverage; optional reranking remains optional |
| Answer/citations               | `src/services/chat/answer.ts`, `citations.ts`                                                                                            | Show citation-ID validation and retry without claiming truth verification                     |
| Existing internal demos        | `src/services/internal/recommend-explain.ts`, `retrieval-explain.ts`, `fixtures/internal-demos/`                                         | These read static examples; do not relabel them live traces                                   |
| Evaluation                     | `src/services/eval/`, `scripts/eval-retrieval.ts`, `scripts/eval-benchmark.ts`                                                           | Existence of a metric implementation does not prove a measured outcome                        |

### 1.3 Constants and algorithm details verified during planning

These are snapshot observations, not immutable product promises. Export resolved values into the fixture manifest and display those values dynamically.

- Recommendation top picks: 3; brand cap: 2; initial budget relaxation factor: 1.2; liked-brand additive bonus: 0.35; maximum spec-semantic bump: 0.45.
- `weightedAspectScore` uses resolved normalized aspect weights and a neutral missing-aspect value. `scoreEntry` multiplies the weighted score by `(0.72 + 0.28 * mustHaveRatio)` before bonuses. Do not substitute an invented formula.
- Current ranker has successive fallback paths: strict filtering, budget widening when applicable, foldable preference relaxation when applicable, then active candidates still respecting deal breakers. Clearly mark returned picks from relaxed paths. They must not appear to satisfy the original request unconditionally.
- Local-currency pricing logic in the dirty `match.ts` must be reviewed and tested before choosing demo constraints. Missing price is not free and should never be invented. A specific observed concern: when local price is absent, the current local-budget branch compares `msrpUsd` numerically against the local maximum without an exchange conversion in that branch. Do not showcase that as currency-correct behaviour. Use a source-consistent single-currency main scenario, record the concern, and require a separately authorized application correction before demonstrating that mixed-currency path as correct.
- Ingestion chunk defaults: target 400 tokens, overlap 60, minimum 60; sentence boundaries make the target a soft cap. Do not draw exactly equal chunks or claim exactly 60 overlap tokens in every case.
- Embedding dimension in the current provider: 768. A 3D projection or decorative vector strip is not the literal 768-dimensional space.
- Retrieval defaults: 30 candidates per retriever, target 8 results, RRF k=60, MMR lambda=0.6, soft source floor 3, optional LLM rerank off, optional rerank pool cap 12.
- Scorecard retrieval uses target 8 and a softer source floor of 2. Do not accidentally use Q&A's floor in the scorecard scene.
- FTS falls back to trigram only when full-text search yields zero rows; trigram threshold in source is 0.2. Demonstrate a separate fallback scenario.
- MMR currently consumes the fused candidate scores without the normalized relevance values used in some textbook illustrations. Missing embeddings use a similarity penalty path. Replay the exact implementation, including tie order; do not substitute a prettier algorithm.
- Scorecard synthesis preserves the extracted overall score. Recency changes confidence, not the aspect score. Empty-evidence fallback includes confidence 0.15; source and tests must supply the exact fallback record.
- The writer replaces a source's chunk batch transactionally and logs ingestion outcomes. Show unchanged-content skip and transaction rollback as distinct outcomes.

### 1.4 Current schedule card contents

The schedule module must be generated from verified workflows and scheduler configuration. The following are current configured triggers, not guaranteed execution or completion times. GitHub scheduled jobs may be delayed. Show UTC explicitly.

| Workflow                  | Configured trigger                             | Meaning to explain                                                                                                 |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `catalog-refresh.yml`     | Monday 01:17 UTC; first day of month 01:47 UTC | Scheduled catalog refresh paths have different arguments; inspect branch-specific configuration                    |
| `ingest-tiered.yml`       | Daily 02:17 UTC                                | The job selects due phones; it does not reingest every phone daily                                                 |
| `ingest-resume.yml`       | Daily 03:20 UTC                                | Resume/retry eligible failed work, with configured sharding                                                        |
| `creator-watch.yml`       | Every six hours at minute 23                   | Check creator content; discovery is not automatic acceptance                                                       |
| `scorecard-auto.yml`      | 04:17, 10:17, 16:17, 22:17 UTC                 | Scheduled scorecard work; never reuse the old “once daily” fixture                                                 |
| `catalog-images.yml`      | Daily 06:17 UTC                                | Image backfill/repair is distinct from evidence ingestion                                                          |
| `ingest-on-new-phone.yml` | Manual `workflow_dispatch` with phone input    | This is not a database-triggered automatic webhook; new phones can also be selected by the scheduled due-work path |

Per-phone refresh tiers are hot: launch age up to 60 days / 3.5-day interval; warm: up to 365 days / 7 days; cold: older or unknown date / 14 days. Scheduling, queue eligibility, actual start, retry, and completion must have distinct labels.

## 2. Art direction and design rules

### 2.1 Visual thesis

“A beautifully organised collection of products and evidence that comes alive when a decision is made.” The hero is the phone and the evidence about it, not a model of a server or an abstract AI brain. Each scene should be compelling as a still image and legible as an animated explanation.

Reference interpretation: Half of Eight's Fuji uses a subject-specific object to anchor a journey; its Journal lets the content become a spatial collection. Adopt object continuity, authored composition, and selective depth. Do not copy artwork, source code, sounds, textures, layouts, or trademarked visual identity. Other user references inform restraint, smooth transitions and substantial 3D objects; they do not justify a collage of unrelated effects.

### 2.2 Design tokens (initial art baseline)

| Token               | Value / rule                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Background          | `#101214` charcoal with very low-contrast studio gradient; no star field                    |
| Information surface | `#F2EEE5` soft ivory, only where content needs a physical document surface                  |
| Primary light text  | `#F4F1EB`                                                                                   |
| Muted text          | `#ADB3B8`; verify final contrast on actual surface                                          |
| Active / journey    | `#F05B40` vermilion; never sole state indicator                                             |
| Accepted            | `#65B995` plus check/word label                                                             |
| Held / uncertain    | `#D8AC64` plus reason                                                                       |
| Rejected            | `#D77979` plus crossed/removed state and reason                                             |
| Meaning search      | muted blue `#78A9D1` plus text label                                                        |
| Keyword search      | warm gold `#D6B978` plus text label                                                         |
| Radius              | 8 px for controls, 14 px for sheets; do not round every object into a pill                  |
| Spacing             | 4/8/12/16/24/32/48/64 px scale                                                              |
| Typography          | Existing licensed sans family or local system sans first; one mono face only for IDs/values |
| Body                | 16 px desktop; 16 px mobile; line-height 1.45–1.6; max 60–70 characters per line            |
| Stage title         | 32–44 px desktop, 26–32 px mobile; no giant typography over the action                      |
| Labels              | Minimum 13 px secondary, 15–16 px primary; never shrink below readable size to fit          |

Colours are an authored starting point, not a contrast certification. Validate text/controls at 4.5:1 normal text and 3:1 large text/non-text UI as applicable. Use colour plus shape, words, and position.

### 2.3 Composition rules

- One principal action per shot. Background objects establish context, not competing animation.
- Hero phone occupies 25–38% of desktop viewport height in overview; 45–60% in inspection.
- A maximum of 6 primary object labels desktop / 3 mobile at once. Additional records remain selectable through a list, not lost.
- Camera pitch for reading views 0–15 degrees; overview can use 15–25 degrees. Roll remains zero.
- Text surfaces face the viewer while being read. Do not orbit them continuously.
- No endless empty ground plane. A subtle curved collection and controlled light establish space without a giant beige floor.
- Keep a clear silhouette gap of at least 16 screen pixels between featured objects at the reference viewport.
- Internal views inherit materials and object identity, not the same spatial arrangement.
- Glass is limited to a small edge/detail, never the entire database. Depth sorting and readability take priority over transmission effects.

### 2.4 Required art boards before scene coding

Produce local reference renders or working-browser compositions at 1440×900 and 390×844:

1. Opening: phone with curved evidence collection, two story choices, restrained navigation.
2. Ingestion: one readable review expanding into overlapping chunks.
3. Recommendation: candidate collection, rejected group with reasons, surviving group and score comparison.
4. Retrieval internal: two ranked passage groups merging into a readable result list.

Include grayscale versions to test hierarchy and a label-safe-area overlay. Store boards and design decisions in `design/`. If the boards are just rectangles with headers, the art gate has failed. Do not implement all scenes before validating at least the first three boards with the user.

## 3. Information architecture and user experience

### 3.1 Entry and story hierarchy

Opening copy: “From evidence to a phone that fits.” Supporting sentence: “See how RECSY builds its knowledge, compares phones, and answers with sources.” Primary button: “Watch the story.” Secondary: “Explore the system.” Persistent small badge: “Recorded example” or “Illustrative example,” driven by fixture truth class.

Two groups, not one false sequential chain:

```text
BUILD KNOWLEDGE
Catalog → Evidence ingestion → Archive ↔ Aspect assessments
                                  │
USE KNOWLEDGE                      ├→ Needs → Filter → Rank → Three picks
                                  └→ Question → Search → Fuse → Select → Cited answer
```

Archive is the shared knowledge relationship, not an additional database copied for each consumer. Aspect generation may itself retrieve evidence; show that relationship locally. Recommendation must not be routed through Q&A by default.

### 3.2 Desktop layout

At 1440×900, outer padding 24 px; header 64 px; bottom control region 104 px. The canvas occupies the remaining area. A desktop detail inspector is 360 px wide (max 30% viewport) and reserves space in camera framing instead of covering focused objects. Its content scrolls independently. Collapsed inspector leaves a 40 px affordance.

Header: RECSY / chapter breadcrumb on left; examples and help on right. No FPS/WebGL branding. Lower left: current transformation caption, at most two concise lines. Bottom centre: previous, play/pause, next, progress, speed. Lower right in a separate layout cell: explore/return-to-page/reset as appropriate. Never place a floating “return to page” button above another control row.

Use CSS grid for these regions; derive safe canvas rectangle from measured regions using ResizeObserver. Do not use a cluster of absolute-positioned controls that overlap at intermediate widths.

### 3.3 Mobile and tablet

- At <768 px, compose fewer objects per shot; do not simply scale desktop down.
- Header remains 52–60 px. Controls use two rows in a bottom dock with safe-area inset.
- Inspector is a bottom sheet with 30% peek and 70% expanded states; pause playback when expanded.
- Scene fitting uses remaining unobscured height. If space is insufficient, switch the current detail to a full readable sheet with a small object preview.
- Rank groups stack vertically as a guided sequence while objects remain genuinely 3D; no forced landscape orientation.
- Minimum touch targets 44×44 px with 8 px separation. No hover-only meaning.
- At 200% text zoom, controls may become a scrolling semantic document layout. Preserve actions and content instead of clipping.

### 3.4 Three levels of explanation

1. Action caption: “These phones exceed your budget.”
2. Inspectable receipt: phone, price/currency, constraint, outcome and reason.
3. Technical drawer: record IDs, source file mapping, formula, resolved configuration, timestamps, provenance and limitations.

Every stage must have all three levels. Never require opening the technical drawer to understand the main action. Glossary entries: catalog, source, chunk, embedding, full-text search, trigram, RRF, MMR, confidence, citation. Use a short plain-language definition followed by technical terminology.

## 4. Domain and replay data contract

### 4.1 Truth classes

`recorded`: sanitized data and intermediate outputs captured from an identified application revision; `illustrative`: authored inputs executed through verified logic or clearly labelled example model outputs; `live`: reserved for a separately authorized future integration. Initial build includes no live credentials, server actions, or paid model calls.

Do not call synthetic reviewer quotes real. Do not claim a recorded rank list is recomputed semantic retrieval when users freely edit the question. Initial query examples are selectable presets; arbitrary input can change the demonstrated structured constraints only within a verified local simulation. Label that mode explicitly.

### 4.2 Fixture package

```ts
type TruthClass = 'recorded' | 'illustrative';
type EntityId = string;
interface ScenarioManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  truthClass: TruthClass;
  capturedAt: string;
  sourceRevision: string;
  sourceDirty: boolean;
  sourceHashes: Record<string, string>;
  config: Record<string, string | number | boolean>;
  rightsManifest: string;
  limitations: string[];
}
interface EntityBase {
  id: EntityId;
  kind: string;
  label: string;
}
interface ReplayEvent {
  id: string;
  timeMs: number;
  type: string; // validated discriminated union in implementation
  entityIds: EntityId[];
  payload: unknown; // replaced by per-event typed payloads
}
interface Shot {
  id: string;
  startMs: number;
  durationMs: number;
  sceneId: string;
  focusIds: EntityId[];
  cameraPreset: string;
  captionId: string;
  eventIds: string[];
}
```

Implement strict runtime schemas for every entity/event. `unknown` above is a specification placeholder, not permission to ship unvalidated payloads. Entity types include Phone, CatalogCandidate, Source, Chunk, AspectAssessment, Requirements, FilterReceipt, ScoreReceipt, RetrievalCandidate, FusionReceipt, MmrIteration, CoverageReceipt, Answer and Citation. Give each an explicit schema in `domain/schema.ts`.

Source fields: URL, title, publisher/channel, source type, publication date, capture date, content hash, license/reuse status. Chunk fields: source ID, phone association, text, token count, index, timestamp/anchor, overlap references and optional embedding. Phone fields: model/brand/variant identity, source-backed price/currency/date/region, specs, image/model provenance, assessment references. Never store personal user sessions or credentials in fixtures.

### 4.3 Required scenario set

| ID                  | Required outcomes                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `catalog-happy`     | Discovery, enrichment, validation, identity match, promotion                                                  |
| `catalog-held`      | Incomplete or ineligible candidate held with reason; no fabricated promotion                                  |
| `ingest-happy`      | Fetch, curation, chunking, embedding, atomic storage                                                          |
| `ingest-unchanged`  | Same content identity skips unnecessary work according to actual orchestration                                |
| `ingest-retry`      | Failure category, due retry, later completion; no false success count                                         |
| `archive-lineage`   | Phone → source → chunk → assessment/citation                                                                  |
| `aspect-camera`     | Support, dissent, structured synthesis, score and confidence                                                  |
| `aspect-thin`       | Insufficient evidence and fallback state                                                                      |
| `recommend-main`    | At least six eligible candidates initially so filtering/ranking can be understood; full input corpus retained |
| `recommend-relaxed` | Exact relaxation flags and constraint exceptions                                                              |
| `recommend-missing` | Missing price/scorecard and ties handled according to source                                                  |
| `retrieve-main`     | Vector-only, lexical-only, shared passages, RRF, MMR, coverage, answer                                        |
| `retrieve-fallback` | Empty FTS leads to trigram                                                                                    |
| `retrieve-thin`     | Limited sources or zero results; honest coverage limitation/no-evidence answer                                |
| `citation-invalid`  | Invalid membership, one retry, terminal failure if still invalid                                              |

If a recorded corpus lacks a useful teaching edge case, add an explicitly illustrative scenario. Never edit recorded inputs to force a satisfying winner while retaining the recorded label.

### 4.4 Deterministic arithmetic and provenance

Reuse pure application algorithms through a snapshot adapter or a small licensed/local copied module with source hash and parity tests; do not import server/DB modules into the browser. Add comparison tests against the source implementation in a controlled offline harness. Existing internal demo JSON lacks enough intermediate data for all scenes: enrich the replay contract rather than fabricating hidden steps.

For RRF, absent list membership contributes zero; rank is one-based. Example arithmetic: a passage ranked 1 in meaning search and 2 in keyword search contributes `1/61 + 1/62 ≈ 0.032522`. This is an explanatory arithmetic example, not a measured relevance probability. Display raw precision in the inspector, round only presentation.

For MMR, retain each iteration's candidate relevance, maximum selected similarity, penalty, resulting value, winner and tie order. For score receipts, record resolved weights, missing-value treatment, multiplier, bonuses, total and diversity decision. Recompute all visible rankings from receipts/verified functions. Never hardcode a separate “podium” array that can drift from the calculations.

## 5. 3D asset production plan

### 5.1 Asset strategy and tool choices

Use a small custom asset family, not a marketplace asset dump. Blender is the preferred authoring tool for final phones and studio environment; export glTF/GLB for the web. Where Blender is unavailable, create a deterministic procedural phone builder in Three.js for the first vertical slice. A procedural fallback is not automatically final-quality: it must pass the same silhouette/material review. Do not install DCC tools or buy assets without appropriate user authorization.

AI-generated raster imagery may be used for a mood board or non-factual backdrop with rights recorded, but not to manufacture phone specifications, reviewer evidence, accurate branded phone geometry, or final UI text. No external image-generation dependency is needed for the initial build. Do not portray an image on a plane as a complete 3D phone. Do not download assets from inspiration websites.

### 5.2 Asset inventory and budgets

| Asset                             | Construction                                                                                             | Initial budget                                                               | Acceptance                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Hero phone, three selected models | Authored/parameterized body, bevels, screen, camera cluster, buttons; correct proportions where verified | ≤25k triangles each, ≤3 materials, ≤1 MB compressed geometry per hero target | Recognisable silhouette, smooth normals, no black flat slab            |
| Candidate phone LOD               | Shared low-detail shell with per-instance colour/texture atlas and stable ID                             | ≤2k triangles per visible candidate                                          | Model label readable; generic representation disclosed where not exact |
| Review folio                      | Slightly curved plane with thickness/edge geometry, readable excerpt separate                            | ≤1k triangles, atlas-backed thumbnail                                        | Looks like a source document, not a dashboard window                   |
| Chunk segment                     | Reusable shallow strip with selected sentence/overlap anchors                                            | ≤300 triangles; instance repeated shells                                     | Text identity preserved from source                                    |
| Archive collection                | Instanced record spines and authored curved placement                                                    | ≤30k total triangles for environment                                         | Distinct types and navigable relationships, no random cabinets         |
| Aspect assembly                   | Seven labelled surfaces around phone, variable evidence layout                                           | Reuse document and indicator geometry                                        | Score/confidence visually different                                    |
| Score contribution bars           | Instanced extrusions anchored to selected phones                                                         | ≤100 triangles each                                                          | Length encodes actual contribution; axis/units available               |
| Relation lines                    | Thin tapered curves, drawn only for selection/event                                                      | ≤12 active curves desktop, ≤5 mobile                                         | Direction and endpoints unambiguous                                    |
| Studio backdrop                   | Curved seamless surface or shader gradient, restrained environment reflection                            | One simple mesh; ≤1k environment texture initially                           | No visual horizon cuts through text                                    |

Budgets are starting targets, not measurements. Include all variants, decoder overhead and GPU memory in performance reporting. Avoid transparent overlapping meshes for documents; use opaque ivory surfaces and transitions with controlled opacity only when needed.

### 5.3 Phone authoring recipe

1. Establish measured or explicitly approximate height/width/thickness ratios. Use a canonical scene height of 2 units; actual scale ratios can vary between phones only when source-backed.
2. Model a rounded body with bevelled edges and correct normals, front glass surface, restrained camera cluster and physical side buttons. No microscopic screws or unseen internal electronics.
3. Name nodes `body`, `screen`, `camera_cluster`, `buttons`, `label_anchor`, `focus_anchor`. Origin at body centre; +Y up, +Z screen front. Apply transforms before export.
4. Create three LODs: hero, medium and candidate. Preserve anchor transforms across all levels so labels/camera do not jump.
5. Use graphite anodized body with roughness around 0.3–0.5, a non-mirror screen, and subtle camera glass. Tune against reference boards rather than copying material values blindly.
6. Use texture atlases for tiny marks, not dozens of meshes. Only use brand marks/photographs with recorded permission or applicable rights; a stylised generic body must say “device representation.”
7. Export GLB, validate normals/materials, remove unused animation tracks/cameras, and compress geometry/textures where decoder cost is justified. Keep editable source and export script/settings.
8. Render front, rear and three-quarter thumbnails under the actual web lighting. Compare silhouette and final screenshot, not just Blender viewport beauty.
9. Test missing/corrupt GLB and texture loads; fallback uses the procedural shell and preserves interaction/labels.

### 5.4 Asset manifest

Each entry includes ID, relative URL, byte size, SHA-256, source author, rights/license, attribution, dimensions, triangle count, material count, texture dimensions, LOD mapping, pivot convention and semantic anchors. Fonts and sound files use the same manifest. No hotlinking external images at runtime. Keep each downloaded/source asset's permission basis; public visibility alone does not establish reuse rights.

## 6. Scene-by-scene specification

All scenes expose `mount`, `sample(time,state)`, `getBounds`, `getAnchors`, `getInspectableEntities`, `setQuality`, and `dispose`. They receive semantic state; they do not compute business rules or maintain a second playback clock.

### 6.1 Opening / living archive overview

Composition: one phone slightly right of centre, with a shallow curved collection of labelled sources behind it; concise copy on left. On mobile centre the phone above the copy. Three spatial clusters suggest catalog, evidence and decisions, but do not display six panels. A subtle path highlights the selected story.

Idle movement: a very slow camera arc no larger than ±3 degrees over 20 seconds, only when not exploring, not inspecting, not paused and not reduced-motion. No constant data packets while no operation is running. All labels stay stable. Opening plays no audio automatically.

Clicking a cluster frames it, offers its local tour and identifies its role. Clicking the phone opens its information composition. “Watch the story” begins the global timeline; it must not require a second click to start each stage.

Pass condition: within 10 seconds a newcomer can identify the phone, the evidence, and the two things RECSY does with that knowledge.

### 6.2 Catalog / identity formation

Internal composition: hero candidate on right, a controlled fan of field claims on left, a final canonical record behind the phone. This is information assembly, not hardware assembly.

Sequence:

1. A discovery source supplies a candidate title/identity; source name is visible.
2. Field claims attach to labelled anchors: model, brand, launch/release, variant, specifications and price where sourced.
3. Missing fields stay empty with “not available,” never fill with invented values.
4. Validation highlights the actual field/rule and its outcome.
5. Duplicate identity records converge into a single canonical identity; show retained provenance and variant distinction.
6. Promotion moves the accepted record into the catalog collection. Held candidate stays in a visible side group with reason and retry/review status.

Interactions: select a field for origin and timestamp; select identity to inspect aliases/keys; switch accepted/held example; tour this component. Each animation is triggered by a matching domain event such as `candidate.discovered`, `field.resolved`, `candidate.validated`, `identity.matched`, `candidate.promoted`.

Do not animate conflicting claims being resolved unless the source trace actually contains a conflict-resolution decision. Default tour lasts 40–55 seconds; detail is available after pausing.

### 6.3 Evidence / one review becomes searchable knowledge

Internal composition: a large source document at left, an expanding sequence of chunks across the central depth plane, and a storage destination at right. Only one passage is featured at a time; the complete document remains in the inspector.

Sequence (local tour 65–85 seconds):

1. Schedule view selects a due phone; show trigger time, due date and tier distinctly.
2. A named source is discovered/fetched. Article, video transcript and community source carry different icons/content; do not imply a fetched video is transcribed if the adapter obtains an existing transcript.
3. Curation/disambiguation exposes the reason it belongs to this phone and the quality/relevance decision. Unsupported or rejected material exits with a visible receipt.
4. Cleaned body replaces raw content. Highlight the exact removed portion for an illustrative example; do not invent removed boilerplate for a recorded source without raw text.
5. Sentences separate with small spatial offsets, then pack into chunks. The same trailing sentences remain highlighted in adjacent chunks to explain overlap. Show actual token counts.
6. A selected chunk receives a vector representation labelled “768-number embedding; visual summary.” Do not animate each dimension as a claim of meaningful individual semantics.
7. Source ID, chunk ID, phone association and anchor travel with the chunk into the archive.
8. Commit shows the batch becoming visible together; failure leaves the previous batch intact. Updated count derives from event payload, not an animated arbitrary counter.

Transition technique: a source folio's plane expands; chunk meshes originate from known text-region anchors. Use transform/clip animation rather than screenshot crossfades that break identity. The same `ChunkView` persists into storage/retrieval.

Local alternatives: unchanged-content skip, failed source/retry, missing transcript, insufficient evidence. Show timings as accelerated replay time, never benchmark latency.

### 6.4 Archive / inspect relationships

Composition: a curved, shallow collection organised into phone, source, chunk and assessment layers. Use record counts and type names at the group level. It is an information structure, not a literal picture of Postgres storage or server racks.

Selecting a phone expands its source group; selecting a source fans out its chunks; selecting a chunk reveals text and joins. Draw only selected relationships. The technical drawer shows exact fields from schema and index roles; indexes are alternate access paths to records, not extra copies of all evidence.

Local tour (35–45 seconds): phone record → related source → stored chunk with vector → aspect evidence reference → later answer citation. Include the same IDs used in ingestion. Query result scope must respect the application's actual phone association semantics; do not infer all secondary source links are searched by every retrieval query.

Update example: old chunk set dims as new set stages, then commit swaps the visible set atomically. A failed transaction restores old state. Distinguish deletion in this replay from deleting anything in a real database.

Pass condition: a visitor can trace a cited passage back to its source and phone without reading SQL.

### 6.5 Aspect assessments / evidence to judgement

Composition: phone centrally placed; seven aspects in a shallow, open semicircle, not a crowded orbit. Opening camera frames all seven. Selecting one unfolds a left support group and right dissent/limitations group with the assessment between them.

Sequence (50–65 seconds): select aspect → retrieve relevant passages using scorecard configuration → reveal structured synthesis → show raw overall score → validate evidence identifiers → calculate confidence adjustment → persist assessment. Empty evidence is a separate clearly labelled state.

Primary copy: “This is an AI synthesis of the available evidence, not an average of reviewer ratings.” Score uses a solid bar on a labelled 0–10 scale. Confidence uses a separate small indicator with plain-language explanation and numeric value; it is not asserted to be a calibrated probability. Recency change animates only the confidence indicator.

All seven aspects are selectable, keyboard accessible and have meaningful data or an explicit empty state. Do not copy camera evidence into every aspect. Invalid evidence IDs are retried/stripped as implemented in scorecard code; do not confuse that behaviour with chat's terminal rejection policy.

Pass condition: visitor distinguishes support from dissent, score from confidence, and missing data from poor performance.

### 6.6 Recommendation / an understandable selection

Composition: a shallow curved lineup of candidate phones, an active decision lane, and a retained rejected group. No gate rings or decorative conveyor machinery. Use actual phone silhouettes or labelled disclosed generic bodies. The three final picks are a comparison composition, not an award podium implying universal superiority.

Sequence (60–80 seconds):

1. Show the exact user request.
2. Extract a structured request with budget/currency, priorities, must-haves and deal breakers. Distinguish model extraction from subsequent deterministic calculation. Low-confidence clarification gets its own scenario.
3. Apply hard constraints. Each phone changes group because a filter receipt exists. Keep reason label visible for the featured removal; inspector can reveal every receipt.
4. If strict set is empty, demonstrate exact relaxation with an explicit warning and changed constraint. Never quietly enlarge budget.
5. Resolve normalized weights. Contributions grow beside the selected candidate, with a stable numeric total and formula drawer.
6. Apply actual multiplier/bonuses. Missing scorecard is labelled, not rendered as confidently measured performance.
7. Sort candidates. Animate from old to new positions using stable IDs; selected phone remains tracked.
8. Apply brand-diversity selection. If a higher-scoring third same-brand candidate is skipped, explain why the displayed result differs from pure sorting.
9. Present up to three picks with trade-offs and constraint status. Fewer eligible picks remains fewer, never padded with fabricated phones.

Controls: budget slider with currency, priority weights, scenario chooser and reset. For direct slider interaction, calculate on throttled input or pointer release (≤10 updates/s while dragging) and show a responsive preview; animate only from the latest accepted result. Normalize weights visibly. Never allow arbitrary text to pretend it was parsed by an LLM when offline.

Retained rejected phones can be selected to inspect why they failed and what change would admit them. Do not promise a counterfactual unless it is recomputed through the same predicates. Scores and currency conversions must show fixture dates and limitations.

### 6.7 Retrieval / question to evidence

Composition: selected phone context at the top; meaning-search and keyword-search passage collections at left/right; central merge area; final context and answer in the next shot. Limit visible passages to a readable subset with full ranked lists in the inspector. Never fake total counts based only on the displayed subset.

Sequence (75–95 seconds):

1. Show phone scope and question. Query embedding occurs before the parallel retrievers according to current orchestration.
2. Meaning search highlights a paraphrased but relevant passage. Keywords highlight matching text in another passage. Preserve actual excerpts and IDs.
3. Shared passage identities visually align across lists. A selected passage's RRF rank contributions assemble into its fused score. No averaging incomparable raw search scores.
4. MMR selects passages step by step. The featured redundancy decision shows both passages and the penalty; use exact fused relevance and similarity from the computation.
5. Source coverage can change the selected set; show replaced/added passage and distinct-source count. Thin corpus shows “coverage target not available,” not a fake source.
6. Optional LLM reranking appears only in a scenario whose resolved config enables it; show fallback if it fails.
7. Final context feeds the answer. Citations attach to passages; selecting a citation highlights the passage and exposes source link/date.
8. Citation membership validation is shown as “citation points to provided evidence.” Never label it “answer proven true.”

A separate trigram scenario begins with zero FTS hits and explains approximate character matching with a small actual string example. Do not call it another embedding search. A zero-results scenario reaches an honest no-evidence response.

For an optional 3D semantic cloud, use it only as a contextual projection with disclosed projection method or “illustrative placement.” The ranked excerpts remain the main explanatory object. Do not let an attractive cloud replace readable evidence.

## 7. Scene graph, renderer and implementation architecture

### 7.1 Technology decision

Use React + TypeScript for DOM UI and a single imperative Three.js renderer for the scene. This matches the portfolio's existing Three.js approach and avoids adding a second abstraction layer during the rewrite. React Three Fiber is not required; do not migrate production to it. The RECSY app currently uses Next/React and has no Three dependency in its inspected package.json; this is another reason to isolate the sandbox package.

Pin sandbox dependencies and commit/export its own lockfile. Resolve compatible versions at implementation time; do not float `latest`. Reuse the installed Three.js version as the initial baseline if compatible. Use Three's loaders and math rather than writing custom glTF parsing. Add Vitest and Playwright for the sandbox if absent. Do not use the application root's formatter to rewrite unrelated files.

Default renderer: WebGL with alpha disabled and a fixed studio background. Use one perspective camera, approximately 35° vertical FOV, near/far adapted to fitted content. Pick supported tone mapping/color-space settings for the pinned release and validate reference renders; do not mix pre/post colour-space APIs from different Three versions. No WebGPU requirement, physics engine, fluid solver, or live ray tracing.

### 7.2 Proposed directory structure

```text
recsy-living-archive/
  package.json / lockfile / index.html / vite.config.ts / tsconfig.json
  README.md
  src/
    app/Exhibit.tsx, exhibit.css, state.ts
    domain/schema.ts, fixtures.ts, reducer.ts, selectors.ts
    domain/algorithms/{ranking,rrf,mmr,coverage}.ts
    runtime/ExhibitRuntime.ts, ReplayClock.ts, Timeline.ts
    runtime/CameraRig.ts, InputRouter.ts, SemanticZoom.ts
    runtime/AssetStore.ts, SceneManager.ts, QualityController.ts
    runtime/LabelProjector.ts, Lifecycle.ts
    scenes/{overview,catalog,evidence,archive,aspects,recommend,retrieval}/
      scene.ts, layout.ts, shots.ts, labels.ts
    objects/Phone.ts, Folio.ts, Chunk.ts, RecordCollection.ts, Contribution.ts
    ui/Header.tsx, TourDock.tsx, Inspector.tsx, Caption.tsx
    ui/ScenarioPicker.tsx, Help.tsx, Transcript.tsx, Fallback.tsx
    data/scenarios/*.json, manifest.json, glossary.json, captions.json
  public/assets/{models,textures,fonts,posters}/
  assets-source/{blender,procedural}/
  scripts/{validate-fixtures,validate-assets,generate-posters,report-budgets}.mjs
  tests/{domain,replay,navigation,ui}/
  e2e/{tours,zoom,accessibility,responsive,lifecycle}.spec.ts
  design/{boards,shot-sheets,asset-manifest.json,decisions.md}
  verification/{source-manifest.json,test-report.md,performance/,screenshots/}
```

These are required responsibilities, not an instruction to create empty placeholder files. Each milestone must deliver working vertical behaviour.

### 7.3 Runtime ownership

`ExhibitRuntime` owns one renderer/RAF, managers and disposal. `ReplayClock` owns simulated time. `Timeline` samples domain events and animation tracks. `SceneManager` owns current/outgoing scene roots. `CameraRig` is the ONLY writer to camera transforms; input and tours submit intents to it. `AssetStore` owns shared geometry/material/texture references. `LabelProjector` owns projected positions and visibility. React owns controls and selected entity metadata, not per-frame coordinates.

Use a small external store (`useSyncExternalStore` or equivalent) for semantic changes. Do not call React setState for every moving phone every frame. Update Three transforms in the single RAF. Reuse vectors/quaternions and temporary arrays in hot paths. Raycast only against registered interaction proxies, not every decorative mesh.

### 7.4 Deterministic time sampling

```text
clock time → reduce events up to time → semantic state
           → sample shot/animation tracks → object transforms
           → camera intent → camera pose
           → derive labels/caption/UI
```

Create periodic semantic checkpoints at chapter boundaries and before major branches. `seek(t)` reconstructs state from the nearest checkpoint and samples animation tracks at `t`; it must not trigger a sequence of irreversible callbacks. Do not use independent `setTimeout` chains or sine loops to advance domain work. Motion tracks use keyed entity IDs and absolute simulated time.

Animation channels: position, rotation quaternion, scale, visibility/opacity, highlight progress and semantic event markers. Easing function is deterministic. For interruption, capture the current sampled pose and blend to the new camera/object target without teleporting; the target semantic state must remain reproducible.

## 8. Navigation and perfectible zoom transitions

“Perfect” is an acceptance goal, not an implementation claim. The following behaviour must be tested.

| Input                            | Explore mode                                                                    | Tour mode                                                             |
| -------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Primary drag                     | Screen-space pan                                                                | Explicit interaction switches to paused explore; no camera tug-of-war |
| Secondary drag / Alt+drag        | Limited orbit around selected focus                                             | Same takeover rule                                                    |
| Wheel / trackpad pinch           | Cursor-directed dolly                                                           | Takeover, then dolly                                                  |
| Trackpad two-finger scroll       | Normal wheel policy within engaged canvas; normalize delta modes                | No page-scroll hijack unless canvas engaged                           |
| One-finger drag                  | Pan                                                                             | Takeover                                                              |
| Two-finger pinch + centroid move | Dolly around centroid plus pan                                                  | Takeover                                                              |
| WASD                             | A/D strafe; W/S forward/back in view plane/ground convention documented in help | Ignored until explore engaged                                         |
| Arrow keys                       | Screen-space pan                                                                | Only when canvas focused; never while editing text                    |
| Q/E                              | Optional vertical motion documented in help                                     | Explore only                                                          |
| Click/tap object                 | Select and inspect; second explicit “Enter” or semantic zoom enters             | Pause and inspect                                                     |
| Escape                           | Close inspector, then exit internal scene, then release canvas engagement       | Pause/close first; no surprise full reset                             |

All key handlers ignore editable elements and modified browser shortcuts. Prevent default only for keys actually handled while the canvas region is engaged. Provide a visible “Return to page scroll” action in its own layout region. `touch-action: none` applies only to the explicitly engaged canvas, not the page. Pointer cancel/window blur clears held-key and gesture state.

### 8.1 Cursor-directed dolly algorithm

Raycast pointer against the selected object's interaction surface or a camera-facing focus plane. Save world anchor `P`. Compute desired dolly distance exponentially from normalized wheel delta, clamp to scene bounds, move camera, then translate camera/focus so `P` remains under the pointer in screen space. If no surface is hit, use the focus plane, not the global origin. Smooth target distance with frame-rate-independent damping `1-exp(-lambda*dt)`. Tune wheel and trackpad independently through normalized delta magnitude and cap per-event impulses.

Test anchor projection drift ≤8 px for a moderate zoom gesture away from transition boundaries. Zooming leftmost content must not drift toward scene centre. Free pan modifies camera and focus together; it is not simulated by rotating the world.

### 8.2 Semantic entry/exit

Use projected selectable bounds, not an arbitrary camera distance shared by every object. Initial entry threshold: focused object fills 58–68% of the usable viewport height, stable for 160 ms while continuing inward. Entry requires a valid component target and inward intent. Explicit Enter always works. Use a cooldown of 500 ms after transitions.

Internal scene opens with all critical internal objects fitted to 75–82% of its usable viewport. The user may zoom out to approximately 1.5 times that fitted distance without leaving. Exit only after further sustained outward input, showing a subtle “Continue outward to return” cue. Use hysteresis and a transition lock; one wheel gesture must not enter and immediately exit. Thresholds are tunable configuration and verified per scene/viewport, not hidden magic numbers.

### 8.3 Transition choreography

Typical duration 850–1100 ms desktop; 650–900 ms mobile; reduced motion ≤150 ms crossfade without camera travel.

1. 0–20%: identify selected object, fade unrelated labels and disable their hit targets.
2. 20–65%: camera approaches shared anchor; selected object grows. Outgoing world recedes.
3. 55–85%: incoming scene aligns its matching object/anchor to the outgoing projection; unfold internal arrangement.
4. 85–100%: settle into readable composition and introduce internal labels.

Use separate scene roots and visibility masks; do not leave a same-size outer shell in the centre. A faint edge silhouette may establish continuity only outside the internal content bounds. No literal “inside phone hardware” claim. Keep at most outgoing/incoming scenes during transition, then release outgoing detail assets subject to cache policy.

Back navigation restores a saved camera/focus/selection snapshot. Interrupted loading retains the old scene and offers retry; never transition to a blank world. Resize during transition recalculates safe framing from the current pose. Fit using both vertical and horizontal FOV plus inspector/dock safe area, not viewport height alone.

## 9. Tours, timing and motion language

### 9.1 Tour modes and state

State fields: `{mode: overview|globalTour|localTour|explore, playback: playing|paused|loading|complete, sceneId, shotId, timeMs, speed, selectedId, navigationStack}`. Each input has one explicit transition. Loading pauses simulated time and preserves playback intent. Background tab pauses and requires a clear resume state; it must not skip unseen chapters.

Global tour: approximately 150–180 seconds, concise highlights of both knowledge-building and usage. Local tours provide the full detail durations in section 6. Never cram every technical explanation into the global tour. Reading holds use approximately `max(4s, wordCount/2.7)` plus action time; exact timing is adjusted by comprehension review.

Proposed global chapter budget: opening 8s, catalog 18s, ingestion 30s, archive 12s, aspects 20s, recommendation 30s, retrieval 38s, overview return 4s. Total 160s. The runtime derives duration from shots, not a separate hardcoded progress total.

### 9.2 Control semantics

- Play starts/resumes the current tour. Pause freezes domain transformations, camera, captions and active counters.
- Previous goes to the prior shot's beginning; next goes to the next shot's beginning. Disabled states are explicit at boundaries.
- Selecting a chapter seeks through the same reconstruction path as playback.
- Local tour starts within current component and finishes at that component's fitted overview. Global tour ends at the global overview; it does not loop without user choice.
- Speed 0.75×/1×/1.25×/1.5× affects the unified clock. Inspector reading pauses automatically.
- Explore pauses and preserves the tour position. Resume offers the preserved shot and smoothly re-frames it.
- Reset view affects camera framing; reset example resets domain inputs; these are different actions.

### 9.3 Motion grammar

Discovery: short arrival from source direction. Validation: restrained highlight sweep on the evaluated field. Rejection: lateral separation with receipt, not an explosion. Grouping: coherent alignment. Ranking: stable-ID reorder with brief motion and a settled result. Selection: gentle scale/lighting emphasis, not endless bouncing. Persistence: records become part of a collection together on commit. Search: matching passages come forward from the archive. Fusion: duplicate identities align and consolidate; no blender-like swirl.

Use 150–220 ms UI feedback, 350–650 ms entity transitions, 850–1100 ms scene transitions as initial ranges. Prefer smooth acceleration/deceleration; avoid overshoot on readable text and score bars. Cruise shots may use shallow 8–15° arcs during travel, then hold still for explanation. Sound is optional, muted by default and never necessary for comprehension; no audio production required for core acceptance.

## 10. Labels, interaction and accessibility

Project label anchors from world to screen. Candidate label rectangle must fit the safe region; reject occluded/behind-camera labels. Resolve overlaps by priority: selected > active transformation > primary group > background. Use at most three candidate offsets plus leader line; if none fit, keep selected label in a fixed inspector and suppress lower-priority labels. Never reduce font size indefinitely. Compute rectangle layout at ≤15 Hz or when camera/layout changes significantly, then interpolate positions; test jitter before adopting the cap.

Selection proxies should be slightly larger than thin source/chunk meshes. Ignore click after pointer travel >6 px mouse / >10 px touch to prevent pan opening a component. Keyboard object list mirrors all meaningful selectable entities; canvas is not the only access path. Focus ring and selected state are visible in DOM and scene.

Provide a complete text transcript/step list driven by the same fixture data. This is an equivalent accessible presentation and low-power fallback, not a replacement for the primary 3D experience. Screen reader announcements occur at stage boundaries, not every frame. Proper buttons, labelled ranges, focus trapping only for modal help, Escape support and restored focus are required.

Respect `prefers-reduced-motion`: no idle orbit, parallax, depth rush, or animated rearrangement required; instant semantic states with short opacity transitions. Add an explicit Motion setting. Do not claim WCAG conformance based only on an automated checker. Reference: [W3C animation-from-interactions guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).

## 11. Performance, loading and failure design

### 11.1 Budgets to measure

These are engineering targets, not achieved results. Report actual device/browser, viewport, DPR, GPU if available, scene, sample duration and thermal conditions.

| Metric                   | Desktop target                                                     | Mid-range mobile target                                                   |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Active animation         | 60 Hz target; p95 frame interval ≤20 ms on chosen 60 Hz baseline   | 60 Hz where sustainable; explicit adaptive 30 Hz fallback with p95 ≤38 ms |
| Long main-thread tasks   | No recurring >50 ms task during playback                           | Same; split preparation/loading work                                      |
| Draw calls               | ≤120 steady / ≤180 transition initial budget                       | ≤65 steady / ≤100 transition                                              |
| Visible triangles        | ≤250k steady                                                       | ≤100k steady                                                              |
| Scene GPU texture budget | ≤128 MB estimated                                                  | ≤64 MB estimated                                                          |
| Initial exhibit payload  | ≤2.5 MB compressed JS+critical assets target                       | Same or smaller quality tier                                              |
| Deferred chapter payload | ≤2 MB each initial target                                          | ≤1 MB where possible                                                      |
| Click/selection response | Visual feedback within 100 ms target                               | Within 100 ms target                                                      |
| Memory lifecycle         | No monotonically rising owned resources after 10 enter/exit cycles | Same                                                                      |

Frame measurements include busy scenes and transitions, not a blank overview. Use at least 30 seconds per demanding scenario and report p50/p95/p99, not just an FPS badge. Real mid-range mobile hardware validation is required before claiming mobile smoothness; desktop emulation alone is insufficient.

### 11.2 Rendering decisions

- Reuse geometry/materials and instance candidate shells/record spines; keep hero objects separate for material detail.
- Clamp DPR initially to 1.5 desktop / 1.25 mobile; allow adaptive reductions based on sustained frame time, not one spike.
- One soft key light, fill/environment and restrained rim. Bake/static contact shadow where possible; at most one small shadow map on high tier. No per-phone lights.
- No bloom required. If added after art review, low strength and high tier only; it must not wash out text.
- No real-time depth of field behind readable labels. Use composition and contrast for focus.
- Limit texture atlases; cap default texture dimensions at 1024, hero exceptions justified and measured. KTX2/mesh compression only if end-to-end decode and transfer improve.
- Lazy-load the next chapter's detail assets during reading holds, cache shared objects, and unload non-adjacent heavy scene details. Keep loading cancelable and race-safe.
- Avoid large DOM lists; virtualize inspector collections if needed. Do not use hundreds of full HTML cards over the canvas.
- Reuse scratch allocations; do not regenerate geometry/textures during every frame or slider movement.
- Render on demand when paused and stable; keep one RAF only while motion/input is active. Context loss offers recovery and readable fallback.

### 11.3 Quality controller

Start from viewport/device capability heuristics, then observe a rolling multi-second frame window. Degrade in this order: DPR, shadow quality, far-object detail/count, optional environment effects. Preserve text and explanatory states. Upgrade only after a longer stable window, with hysteresis to avoid flicker. Expose “Quality: Auto / High / Low” in settings, not on the main canvas. Reduced motion and low quality are independent choices.

### 11.4 Loading and disposal

Show meaningful static poster and DOM introduction before WebGL assets load. Buttons explain preparation state. If a chapter fails, retain the previous scene, identify unavailable content, provide retry and transcript. On unmount cancel RAF, observers, event listeners, pointer capture, pending loads and subscriptions; release owned geometry/material/texture/render-target resources and renderer. Shared assets require ref counts or one central lifetime. Test React development remount behaviour and duplicate listeners.

Three.js resource APIs should be checked against the pinned version in the [official documentation](https://threejs.org/docs/). Do not assume removing a mesh from the scene automatically frees GPU resources.

## 12. Security, privacy and factual integrity

The public sandbox is offline-first. It must not call internal command-centre endpoints, read .env files, bundle server secrets, mutate catalog rows, trigger ingestion, or invoke model APIs. Source capture must be an explicit separate read-only export using approved data; the plan does not authorize a production crawl or database migration.

Render source text as text, not unsanitized HTML. External citations open only http/https links with safe new-tab attributes. Untrusted snippets cannot become instructions or script. Remove query/session identifiers that expose real users. Show capture dates and data limitations. No scraped full articles or unlicensed photos bundled without a rights review; use permitted excerpts and authored illustrative text where needed.

Arithmetic correctness, valid citations, and nice visuals are different claims. Do not label illustrative answer animation a measured model benchmark. Optional features remain marked optional. Failure scenes are part of the product explanation, not defects to hide.

## 13. Implementation sequence with completion gates

Do these in order. A less capable agent must not skip asset/comprehension gates by claiming the rest of the plan requires a full build first.

### M0 — Preserve and verify source

Deliver source manifest, Git status record, source map, confirmed sandbox isolation, rights inventory and conflict list. Recheck constants and dirty files. No production changes. Gate: every planned factual claim has a source or is marked illustrative/proposed.

### M1 — Art boards and asset spike

Deliver the three mandatory visual boards, one hero phone, one review folio and one chunk, rendered under the actual intended lighting at desktop/mobile sizes. Test clear labels and silhouette. Gate: user reviews visual direction before broad scene implementation. If feedback is unavailable, continue only infrastructure/tests and clearly mark art acceptance pending.

### M2 — Domain/replay foundation

Deliver typed fixture contract, at least one complete recommendation scenario, source algorithm parity tests, seekable event reducer and one unified clock. Gate: seek to any shot yields the same semantic state as continuous playback; pause freezes state.

### M3 — Final-quality recommendation vertical slice

Deliver real phones filtering, rejected receipts, exact contributions, deterministic reordering, diversity and final comparison; tours, controls, mobile, keyboard and a measured frame trace. No generic placeholders in this slice. Gate: at least one novice can explain a removal and rank difference; visual review accepts asset and motion quality.

### M4 — Navigation and internal transition system

Deliver overview-to-recommendation semantic zoom, pointer anchor preservation, pan/touch/keyboard, inspector-safe framing and return-state restoration. Gate: automated interaction matrix plus manual trackpad/touch; 10 enter/exit cycles without leaks/label contamination.

### M5 — Catalog, evidence and archive

Deliver full lineage and source processing, schedule distinction, unchanged skip, failure/retry and atomic update. Gate: source/chunk IDs remain continuous between ingestion and archive; novice can explain chunk overlap and what is stored.

### M6 — Assessments and retrieval

Deliver all seven aspect selections, support/dissent/confidence, exact two-list fusion/MMR/coverage, fallback scenarios, cited answer and failure policy. Gate: arithmetic parity, no fake quotes, optional features correctly labelled.

### M7 — Global story and polish

Deliver complete global and local tours, matching captions/transcript, adaptive quality, polished responsive layouts, reduced motion and failure fallback. Gate: no repeated clicks required to complete the global story; finish returns to overview.

### M8 — Independent-perspective review and handoff

Run section 20 tests, collect screenshots/video/frame traces, review unresolved limitations and export the ignored sandbox. Production integration, commit/push, and backend changes are separate user approvals—not implied next steps.

## 14. Test specification

### 14.1 Pure/unit tests

- Schema rejects missing source IDs, unknown entity references, invalid times, duplicate event IDs and wrong truth class.
- Weights normalize as source; missing aspect values and bonuses match source; diversity cannot select a duplicate phone.
- Strict/relaxed filters preserve exact source behaviour, including missing price, local currency, deal breakers, score ties and missing scorecards.
- RRF uses one-based ranks, absent-list zero, stable chunk identity and correct sums.
- MMR reproduces the actual fused-score scale, missing embeddings and tie order. Coverage preserves/relaxes constraints as implementation does.
- Chunk example reproduces source tokenization/overlap; selected sentence IDs are stable.
- Replay reducer is pure; seek-forward/back/continuous playback states match. Scene animation sampling at a fixed time is deterministic.
- Pause/resume and playback speed do not skip or duplicate semantic events.

### 14.2 Browser tests

| ID      | Action                                    | Required result                                                        |
| ------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| NAV-01  | Pan to far-left/right content             | Content can be centred without rotating entire world                   |
| NAV-02  | Zoom on off-centre phone                  | Pointer anchor remains near same pixel; selected phone approached      |
| NAV-03  | Enter each internal scene                 | Readable fitted view; zero exterior labels/hit targets                 |
| NAV-04  | Zoom out inside before exit threshold     | Entire internal layout can be viewed without premature exit            |
| NAV-05  | Continue outward                          | Exactly one exit; prior overview camera restored                       |
| NAV-06  | Drag then release over object             | No accidental click/entry                                              |
| NAV-07  | Resize during transition                  | Valid framing, no stuck lock or blank scene                            |
| TOUR-01 | Start global and give no further input    | Completes all chapters and returns to overview                         |
| TOUR-02 | Pause mid-filter / mid-transition         | Domain and motion freeze; resume continues coherently                  |
| TOUR-03 | Previous/next rapidly                     | Latest intent wins; no stale labels, duplicate objects or hung loading |
| TOUR-04 | Run each local tour                       | Completes inside its component, correctly framed                       |
| TOUR-05 | Explore then resume                       | No camera fighting; preserved tour resumes                             |
| DATA-01 | Change budget/priorities                  | Visible ranking and receipts match recomputation                       |
| DATA-02 | Inspect rejection                         | Exact phone, predicate, value and reason shown                         |
| DATA-03 | Select source/chunk/citation              | Stable lineage, exact text and source                                  |
| UI-01   | 320, 390, 768, 1024, 1440, 1920 px widths | No controls overlap; readable selected content                         |
| UI-02   | 200% zoom and long labels                 | No clipped controls; equivalent content accessible                     |
| A11Y-01 | Keyboard-only tour/explore/inspect        | All meaningful actions reachable and focus restored                    |
| A11Y-02 | Reduced motion                            | No camera rush/orbit; all explanations retained                        |
| FAIL-01 | Block model/texture/scenario download     | Fallback and retry, no empty indefinite spinner                        |
| FAIL-02 | Simulated WebGL context loss              | Recovery or transcript fallback with preserved state                   |
| LIFE-01 | Mount/unmount 10 times                    | No duplicate canvas/listeners/RAF; owned resources return to baseline  |

Browser tests should exercise production-built sandbox output, not only dev mode. Expose a development-only deterministic test interface for time seeking and state inspection; exclude it from public production builds. Screenshots are taken at fixed replay times with deterministic seeds and animation paused. Test input separately with actual playback.

### 14.3 Human review from five perspectives

| Perspective                          | Questions and failure signs                                                                                   | Required evidence                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| First-time visitor                   | Can I explain where data came from, a rejection, a ranking and a citation? Do I know recorded vs live?        | Short think-aloud review; record misunderstood steps and fixes  |
| RECSY maintainer / AI engineer       | Does the story match current branches, defaults, fallbacks and confidence semantics?                          | Signed-off source/fixture comparison or explicit pending review |
| Senior frontend engineer             | Is state deterministic, ownership clear, cleanup complete, input robust?                                      | Code checklist, tests and resource counters                     |
| Visual designer / artist             | Are forms distinctive, silhouettes strong, materials intentional, motion meaningful and composition balanced? | Four art boards plus final screenshots/video at target sizes    |
| Accessibility / performance reviewer | Can the same content be understood without motion or precise pointing? Does it run on target hardware?        | Keyboard/reduced-motion audit and device-labelled frame traces  |

These are review lenses; do not falsely claim five separate humans reviewed it. If one agent performs them, say so. Human comprehension and visual approval remain separate from automated test results.

## 15. Risk register and planned mitigations

| Risk                                      | Preventive decision                                          | Recovery                                           |
| ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Another generic diagram                   | Art boards + final-quality vertical slice before broad build | Rework asset/composition, not add more labels      |
| Beautiful but misleading motion           | Event-to-object mapping and arithmetic receipts              | Disable unsupported animation until data exists    |
| Too much detail at once                   | Three information levels, label cap, one action per shot     | Move full data to inspector/transcript             |
| Old fixtures contradict current repo      | Hash-based manifest and parity tests                         | Regenerate fixture, preserve historical version    |
| Dirty pricing/promotion behaviour changes | Capture hashes and mark snapshot-specific behaviour          | Re-verify before release, no silent backend edits  |
| Insufficient real evidence                | Labelled illustrative edge case                              | Never fabricate quote attribution                  |
| Phone assets unavailable/unlicensed       | Authored stylised geometry and provenance                    | Explicit generic representation, not stolen models |
| Mobile GPU overload                       | LOD, DPR cap, instancing, no heavy glass/post FX             | Low tier + readable fallback, report limitation    |
| Zoom mode oscillation                     | Projected thresholds, hysteresis, cooldown                   | Explicit Enter/Back always available               |
| Camera/tour input conflict                | One camera writer and takeover state                         | Cancel prior intent safely                         |
| Labels overlap on narrow screen           | Safe rectangles + priority collision handling                | Fixed inspector for selected content               |
| Tour tells but does not show              | Every shot binds semantic events to visible transforms       | Reject shot at content QA                          |
| Async loads mount stale scenes            | Abort/generation tokens, retained previous scene             | Retry without losing context                       |
| Showcase leaks secrets/live internals     | Static sanitized fixture bundles only                        | Block release via secret/data scan                 |
| Source text causes injection              | Plain text rendering and URL allowlist                       | Strip unsafe fields, never innerHTML               |

## 16. Deliverable and command contract

The implementer must create sandbox scripts with the following names: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:e2e`, `validate:fixtures`, `validate:assets`, `report:budgets`. Configure a local port only after checking availability. Do not stop another server to claim its port. Vite `base` must support the standalone build's intended serving path; test a non-root path before proposing future integration.

Run from the sandbox root, using the chosen locked package manager:

```text
<package-manager> run typecheck
<package-manager> run lint
<package-manager> run validate:fixtures
<package-manager> run validate:assets
<package-manager> run test
<package-manager> run build
<package-manager> run test:e2e
<package-manager> run report:budgets
```

Record concrete commands and versions in README once the package exists. The placeholders above avoid pretending an uncreated package already has passing scripts. The portfolio production build alone does not validate this independent sandbox. A dev screenshot alone does not validate its build.

Handoff contains:

- Working preview URL and exact start instructions.
- Editable source, standalone lockfile, assets and asset-source files.
- Fixtures, truth-class labels, source hash manifest and asset rights manifest.
- Screenshot contact sheet: overview + all six internal scenes + mobile + failure state.
- A full-tour recording and one interaction recording demonstrating filter change, zoom entry/exit and citation inspection.
- Test results, performance reports and unresolved limitations.
- A backup/export of the ignored sandbox with checksum; do not assume Git preserved it.
- Explicit statement that production integration and backend writes were not performed.

## 17. Future integration boundary (not initial scope)

Once explicitly approved, wrap the exhibit as a lazy-loaded portfolio component with its own loading poster, error boundary, engagement/scroll contract and disposal. Replace only the approved RECSY architecture section. Do not alter InfiniTune. Reassess adjacent RECSY content so it adds evaluation methodology, limitations, engineering decisions and project evolution rather than repeating the same pipeline description.

A future Next.js embedding would use a client-only dynamic boundary with no server imports in the render bundle. It is an alternative host integration, not a reason to move the initial sandbox into production RECSY. Live traces or command-centre integration need a separate security/data-access design and authorization.

## 18. Requirement traceability

| User requirement                                          | Implementation location | Verification                                                |
| --------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| Immersive true 3D, not generic blocks                     | Sections 2, 5, 6        | Art boards, hero asset, paused stills and motion review     |
| Catalog contents and creation                             | 6.2                     | Catalog accepted/held scenarios, field provenance           |
| Schedules, sources, curation, chunking, embedding storage | 1.4, 6.3                | Schedule fixtures, same chunk through storage, skip/retry   |
| Meaningful archive records                                | 6.4                     | Lineage selection and schema mapping                        |
| Detailed interactable consensus                           | 6.5                     | Seven aspects, support/dissent, confidence distinction      |
| Vector vs FTS/trigram, RRF and final result               | 6.7                     | Ranked excerpts, exact calculations, fallback and citations |
| Actual visible phone filtering and top three              | 6.6                     | Recomputed budget/weights, receipts, diversity              |
| Smooth internal zoom, no exterior leaks                   | 8                       | NAV-02 through NAV-07                                       |
| Pan/free movement and touch                               | 8                       | Input matrix on mouse, trackpad, keyboard, touch            |
| Automatic tours plus prev/next and local tour             | 9                       | TOUR-01 through TOUR-05                                     |
| Beautiful motion and professional composition             | 2, 5, 9.3               | Artist/designer review, not only tests                      |
| Buttery performance                                       | 11                      | Device-labelled frame-time and resource reports             |
| Keep original websites untouched                          | 0.2, 17                 | Before/after Git diff and separate sandbox package          |
| Other agents can execute without inventing details        | 1, 4, 6, 13–16          | Source manifest, schemas, milestones, tests, handoff        |

## 19. Preflight checklist for the next implementing agent

1. Read this document in full and applicable repository instructions.
2. Inventory both repositories and record existing changes; do not reset them.
3. Verify source paths/hashes and record drift from the snapshot.
4. Establish the isolated sandbox and confirm ignored/backup policy.
5. Create source/rights manifests before copying fixtures or assets.
6. Produce art boards and asset spike, not all six rooms.
7. Build one excellent recommendation vertical slice with real semantic behaviour.
8. Test camera/interaction and deterministic replay before multiplying scenes.
9. Expand into knowledge-building and retrieval with shared entity continuity.
10. Validate every acceptance criterion and document pending human/device checks honestly.

Do not ask the user to choose arbitrary implementation details already decided here. Ask only when rights, missing evidence, visual approval or scope materially changes the result. If something cannot meet the standard, document the concrete blocker and preserve completed work instead of replacing it with generic shapes and declaring success.

## 20. Final release gate

- [ ] User has reviewed the visual direction and final-quality slice.
- [ ] All six component scenes plus overview are complete, distinct and readable.
- [ ] Same phone/source/chunk identities persist through connected scenes.
- [ ] All arithmetic and outcomes match source-backed fixtures or explicit illustrative contracts.
- [ ] No fabricated reviewer claims, live-status claims, metrics or certainty.
- [ ] Automatic full tour completes without intervention and returns to overview.
- [ ] Local tours, previous/next, pause, seek, explore takeover and resume work.
- [ ] Free pan, pointer zoom, internal zoom hysteresis, touch and keyboard work.
- [ ] No exterior label/geometry leakage; no dock/inspector overlap at tested sizes.
- [ ] All meaningful objects are inspectable and keyboard-reachable.
- [ ] Reduced-motion, transcript, loading, network/asset failure and WebGL fallback work.
- [ ] Performance targets measured, with actual hardware and unresolved gaps named.
- [ ] Resource/listener/RAF lifecycle tests pass.
- [ ] Standalone build and preview tested, not just production portfolio build.
- [ ] Asset rights, editable sources, manifest, tests and recordings included.
- [ ] Ignored sandbox exported/backed up; production and user changes preserved.

Do not replace unchecked items with a blanket “done.” Report achieved gates, pending gates and evidence separately.

## 21. References and evidence boundaries

- Primary technical evidence: application source paths and workflows listed in section 1, inspected 27 September 2026. Revalidate dirty and changed files before implementation.
- Existing visual experiment: portfolio `src/test_architecture/recsy/`, reviewed as a failure-analysis source, not final art direction.
- [Half of Eight — Fuji](https://fuji.halfof8.com/): object-led narrative inspiration, not reusable assets.
- [Half of Eight — Journal](https://halfof8.com/journal): spatial content collection inspiration, not a template to clone.
- [Three.js official documentation](https://threejs.org/docs/): check renderer, loaders, instancing and resource APIs against pinned version.
- [W3C interaction-animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html): user control over non-essential motion.

This plan specifies implementation and acceptance; it does not assert that assets have been generated, source parity tests have been executed, live data has been exported, hardware performance has been measured, or the final design has been accepted.

## Appendix A. Concrete shot implementation example

Implement this recommendation local-tour shot sheet first. The times are an authored initial cut; adjust reading holds after comprehension review. The narrative does not require fake elapsed backend times. Use the selected scenario's real count, names and receipts in all captions.

| Time   | Shot / domain event        | Visible action                                                                 | Camera / text                                                          |
| ------ | -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 0–6s   | `request.presented`        | Request appears beside selected phone collection                               | Stable wide composition; read request                                  |
| 6–13s  | `requirements.resolved`    | Budget, priorities and constraints align beneath request                       | Small push toward structured fields, then settle                       |
| 13–22s | `filter.evaluated`         | Featured rejected phone separates with reason, then remaining rejections group | Track first removal with shallow lateral arc; hold reason              |
| 22–28s | `filter.completed`         | Survivors and rejected counts settle; both groups still inspectable            | Wide settled result; show count equation                               |
| 28–39s | `score.componentsComputed` | Weighted contributions for selected survivor grow sequentially                 | Match-cut from phone label to adjacent contributions                   |
| 39–46s | `score.adjustmentsApplied` | Multiplier/bonuses change total with numeric receipt                           | Stable comparison; do not multiply a displayed additive bonus          |
| 46–54s | `ranking.sorted`           | Phones reorder by stable ID, maintaining recognizable silhouette               | Shallow tracking move along survivors                                  |
| 54–61s | `diversity.applied`        | Explain a skipped same-brand result only if this scenario has one              | Frame affected pair; otherwise explain cap without inventing exclusion |
| 61–70s | `recommendation.ready`     | Up to three picks settle with trade-offs and constraint status                 | Composed front/three-quarter comparison; no endless spinning           |
| 70–74s | `tour.completed`           | Local overview and explore/replay controls remain                              | Return to local fitted view, not global overview                       |

Each row becomes a `Shot` plus typed events and transform tracks. Do not write a separate timer in the scene to mimic the table. A chapter's previous/next boundaries are these shots. For a relaxed scenario, insert an explicit relaxation shot before scoring and let the derived duration change.

### A.1 Scene coordinate and layout baseline

Use canonical phone height 2 scene units. Recommendation candidate slots lie on a shallow arc, not a full circle: desktop yaw span approximately −28° to +28°, with at most 8 detailed candidates in the foreground. Additional candidates remain in lower-detail groups and in the complete DOM list. Screen-based collision/layout rules override fixed world offsets.

Rejected group is laterally separated by at least one projected phone width from survivors. Main selected phone stands nearer the camera than low-detail peers, but never covers labels. Contributions occupy a separate aligned plane next to that phone; no 3D bar passes through its body. Final picks use a left-to-right comparison with consistent baseline and explicit ranks. Mobile shows the active candidate plus group counts, then three picks in a swipable/keyboard-selectable sequence with an accessible list, not microscopic models.

For evidence, selected folio front faces +Z and occupies a width of approximately 3.8 units at the reading camera. Chunk shells originate at precomputed line-region anchors, then move to non-overlapping slots. Text is actual HTML in the reading overlay; the mesh can carry an abbreviated texture, but it is not the authoritative reading surface. Register identical chunk IDs in both representations so selecting either selects the same entity.

### A.2 Event-to-object invariant examples

```text
filter.evaluated(phoneId, passed=false, reason)
  → PhoneView(phoneId) moves to rejected slot
  → FilterReceipt(phoneId) becomes inspectable
  → survivors/rejected counts derive from reducer state
  → caption references exactly that receipt

chunk.created(chunkId, sourceId, sentenceIds, overlapIds)
  → ChunkView(chunkId) grows out of source anchors
  → overlap highlight follows those same sentence IDs
  → archive record is not visible until commit event

retrieval.fused(chunkId, vectorRank?, ftsRank?, rrfScore)
  → two visual references converge to one entity view
  → contribution drawer shows exact ranks and arithmetic
  → no record is duplicated in final context because it appeared twice
```

Every scene must document equivalent mappings before its animation code is accepted. A caption with no matching visible state change fails content QA.

## Appendix B. Multi-perspective planning review and resolved decisions

This is a review of the specification by one planning agent through different lenses, not a claim of independent expert approval.

| Lens                     | Likely objection                                             | Resolution encoded in this plan                                                                       | Remaining validation                             |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Art director             | A procedural scene will repeat the old generic look          | Custom asset spike, scene-specific composition, prohibited plinth grammar and visual approval gate    | Actual art boards and final render review        |
| 3D artist                | Exact phone modelling is expensive and image rights unclear  | Three hero models, low-detail shared candidate shells, asset manifest, disclosed generic fallback     | Rights review and silhouette/material acceptance |
| Novice visitor           | Acronyms and simultaneous actions overwhelm                  | Two stories, one action per shot, plain-language captions, actual excerpts and receipts               | Think-aloud comprehension test                   |
| AI engineer              | Visual synthesis hides uncertainty and retrieval differences | Separate score/confidence, exact RRF/MMR, optional rerank and source coverage, bounded citation claim | Fixture/source parity and maintainer review      |
| Senior software engineer | Independent animations will drift from state                 | One clock, pure reducer, sampled tracks, one camera writer, strict event schemas                      | Seek/interrupt/lifecycle tests                   |
| Web designer             | Controls overlap the scene or mobile becomes tiny            | Grid layout, measured safe rectangle, reauthored mobile composition, readable HTML inspector          | Responsive screenshots and zoom tests            |
| Performance engineer     | Many high-quality models and glass will overwhelm mobile     | Small asset family, instancing/LOD, lazy loading, no heavy transmission, quantitative budgets         | Real hardware traces and quality tuning          |
| Security reviewer        | A digital twin might expose admin APIs or private data       | Sanitized static replay, no live API integration, rights/secrets manifests                            | Bundle/source-data scan                          |
| Maintainer               | Existing experiments and user changes could be overwritten   | New isolated sandbox, recorded dirty state, separate package and backup                               | Before/after status and handoff checksum         |

### B.1 Decision log to carry into implementation

- Choose object continuity over a literal factory metaphor because the objects represent the actual domain.
- Choose an imperative Three.js runtime plus React DOM because one explicit animation owner makes deterministic replay and existing portfolio integration easier to reason about.
- Choose static replay for the initial showcase because it enables reproducible teaching, offline access and safe public distribution; live monitoring is a different product requirement.
- Choose selected readable evidence over hundreds of simultaneous labels because complete access does not require simultaneous display.
- Choose a final-quality slice before breadth because visual acceptability is the primary unresolved risk, not whether six named components can be instantiated.
- Choose measured quality tiers over universal 60-FPS promises because device capability and rendering cost vary.

## Appendix C. Documentation handoff audit

The plan covers scope, source truth, design tokens, art review, entity schemas, fixtures, asset creation, each scene, runtime architecture, camera/input, tours, accessibility, performance, failure/security, implementation order, tests, risks, integration boundaries and requirement traceability. It deliberately leaves three items for execution-time evidence rather than guessing: final asset rights/availability, visual acceptance of actual renders, and measured performance on named devices.

The implementing agent must add an execution journal containing milestone, changed files, commands run, screenshot/trace paths, passed tests, failed tests, user decisions and next action. Each milestone closes with a concrete artifact, not a progress percentage. If a source change invalidates a fixture, reopen the affected technical gate and list the affected scenes before proceeding.
