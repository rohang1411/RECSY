# RECSY v2 Release Notes

This release brings `recsy-v2-rs` into `master` and marks the transition of RECSY into a full web-based product experience. It includes the migration from the legacy app, the launch of the RECSY v2 platform foundation, ingestion and retrieval pipelines, phone Q&A, scorecards, recommender flows, comparison and browse improvements, and the documentation and testing needed to keep shipping safely.

## Highlights

- RECSY moved from the previous app structure to a Next.js + TypeScript web platform, while preserving the earlier Flutter implementation under `legacy/` for reference ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259), [3f97201](https://github.com/rohang1411/RECSY/commit/3f97201de05e4b6e26b99da52f3d7e8dcbaa7efe)).
- A full ingestion and retrieval foundation was added, making it possible to collect review content, index it, retrieve relevant evidence, and answer phone-specific questions with citations ([c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1), [26ff2a2](https://github.com/rohang1411/RECSY/commit/26ff2a29b678d887845fee0d5878d50352aa9a60), [85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e)).
- The product now includes scorecards, recommendation flows, browse filters, and comparison tools so users can explore phones in several structured ways instead of relying on a single UI path ([c2d8064](https://github.com/rohang1411/RECSY/commit/c2d8064c0a65cc3ab4c90f1d7595704d2212483f), [294ec80](https://github.com/rohang1411/RECSY/commit/294ec806a2cd8294450dc4307cc8c159cf05e6e3), [d33285a](https://github.com/rohang1411/RECSY/commit/d33285afb850dccde4b00b9525359afb8703f926), [f85f48b](https://github.com/rohang1411/RECSY/commit/f85f48bec49f833ea0f6d853c6eb559a1122bd63)).
- RECSY v2 is now much more production-ready with CI, testing, smoke scripts, analytics, SEO/PWA assets, and a much stronger documentation/ADR trail for future contributors ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259), [85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e), [a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63), [1c08e30](https://github.com/rohang1411/RECSY/commit/1c08e30e923162c327164909df5908f72e0857d7)).

## Platform and Architecture

- Migrated the active codebase to Next.js + TypeScript and introduced the new application shell, theming, environment configuration, package/dependency management, linting, formatting, commit hooks, logging, and CI setup needed for RECSY v2 ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259)).
- Moved the earlier mobile implementation into `legacy/` so the project keeps its history without mixing old platform code into the active web product ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259)).
- Preserved and improved the earlier Flutter/Firebase app before archiving it, including auth, filtering, comparison, recommendation, and architectural cleanup work ([3f97201](https://github.com/rohang1411/RECSY/commit/3f97201de05e4b6e26b99da52f3d7e8dcbaa7efe)).

## Data and Ingestion

- Added the first TypeScript ingestion pipeline with orchestration for discovery, chunking, hashing, embedding, and database writes, creating the foundation for building a phone-review corpus ([c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1)).
- Added ingestion adapters for articles, Reddit, and YouTube, along with ingestion types and low-level tests for chunking and hashing ([c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1)).
- Improved ingestion reliability with updated environment handling, better docs, a smoke-test script, and YouTube transcript support for richer source collection ([26ff2a2](https://github.com/rohang1411/RECSY/commit/26ff2a29b678d887845fee0d5878d50352aa9a60)).
- Added ingestion workflow automation in GitHub Actions so corpus-building is part of the operational toolchain instead of an entirely manual process ([c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1)).

## Retrieval and Phone Q&A

- Added the hybrid retrieval system that combines multiple retrieval strategies, including vector retrieval, full-text search, reranking, reciprocal-rank fusion, MMR, and coverage logic ([85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e)).
- Introduced phone-specific ask flows with `/p/[slug]`, a phone chat experience, the ask API route, citation rendering, and answer-generation services grounded in retrieved review evidence ([85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e)).
- Added rate-limiting support and request helpers around these flows to make public-facing query endpoints safer to operate ([85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e)).

## Scorecards and Recommendations

- Added aspect scorecards so RECSY can extract and present structured review signals directly on phone pages ([c2d8064](https://github.com/rohang1411/RECSY/commit/c2d8064c0a65cc3ab4c90f1d7595704d2212483f)).
- Added the scorecard agent, extraction schema, query helpers, recency logic, tests, docs, and scripts needed to support that feature operationally ([c2d8064](https://github.com/rohang1411/RECSY/commit/c2d8064c0a65cc3ab4c90f1d7595704d2212483f)).
- Introduced the first recommendation flow with `/recommend`, recommendation APIs, requirements extraction, matching and ranking logic, recommendation sessions, and spec-embedding utilities ([294ec80](https://github.com/rohang1411/RECSY/commit/294ec806a2cd8294450dc4307cc8c159cf05e6e3)).
- Refined browse/filter behavior and documented the browse/recommender phases so discovery and recommendation stayed aligned as the product expanded ([294ec80](https://github.com/rohang1411/RECSY/commit/294ec806a2cd8294450dc4307cc8c159cf05e6e3), [d33285a](https://github.com/rohang1411/RECSY/commit/d33285afb850dccde4b00b9525359afb8703f926)).
- Improved refinement and explainability in recommendation flows by adding refine-intent support, ask retrieval tracing, and follow-up UX improvements across key surfaces ([1c08e30](https://github.com/rohang1411/RECSY/commit/1c08e30e923162c327164909df5908f72e0857d7)).

## Product Experience

- Expanded the product with stronger phone pages, phone images, spec summaries, compare flows, browse improvements, and a clearer recommendation experience ([f85f48b](https://github.com/rohang1411/RECSY/commit/f85f48bec49f833ea0f6d853c6eb559a1122bd63)).
- Added compare pickers and refined side-by-side device exploration so users can make direct device comparisons more easily ([f85f48b](https://github.com/rohang1411/RECSY/commit/f85f48bec49f833ea0f6d853c6eb559a1122bd63), [a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63)).
- Improved home, compare, recommend, and phone chat UX as part of the later refinement pass for RECSY v2 ([1c08e30](https://github.com/rohang1411/RECSY/commit/1c08e30e923162c327164909df5908f72e0857d7)).

## SEO, PWA, Analytics, and Production Readiness

- Added the assets and metadata needed for a more production-ready web experience, including manifest support, icons, Open Graph image generation, sitemap, and robots handling ([a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63)).
- Added analytics client support and related app-level improvements to support measurement and future growth ([a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63)).
- Strengthened the project’s operational readiness with CI improvements, smoke scripts, end-to-end tests, and broader validation tooling ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259), [85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e), [a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63)).

## Documentation

- Added extensive RECSY v2 documentation, including the main project context, the project guide, feature-area READMEs, and ADRs covering architecture, design tokens, ingestion, retrieval, testing, scorecards, recommender decisions, browse filters, phone UX, SEO/PWA, and phone Q&A scope ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259), [c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1), [85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e), [c2d8064](https://github.com/rohang1411/RECSY/commit/c2d8064c0a65cc3ab4c90f1d7595704d2212483f), [294ec80](https://github.com/rohang1411/RECSY/commit/294ec806a2cd8294450dc4307cc8c159cf05e6e3), [d33285a](https://github.com/rohang1411/RECSY/commit/d33285afb850dccde4b00b9525359afb8703f926), [f85f48b](https://github.com/rohang1411/RECSY/commit/f85f48bec49f833ea0f6d853c6eb559a1122bd63), [a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63), [1c08e30](https://github.com/rohang1411/RECSY/commit/1c08e30e923162c327164909df5908f72e0857d7)).
- These docs make the release easier to understand and maintain by capturing not just what changed, but why those decisions were made.

## Testing and Developer Experience

- Added unit tests across ingestion, retrieval, scorecards, recommendation logic, answer generation, tracing, and shared utilities to improve overall confidence in the platform ([5302a10](https://github.com/rohang1411/RECSY/commit/5302a10c9dbb3a365ab936db38dcaed25d486259), [c95c4e2](https://github.com/rohang1411/RECSY/commit/c95c4e288df85be1b1106c949a40f07cd9748aa1), [85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e), [c2d8064](https://github.com/rohang1411/RECSY/commit/c2d8064c0a65cc3ab4c90f1d7595704d2212483f), [294ec80](https://github.com/rohang1411/RECSY/commit/294ec806a2cd8294450dc4307cc8c159cf05e6e3), [f85f48b](https://github.com/rohang1411/RECSY/commit/f85f48bec49f833ea0f6d853c6eb559a1122bd63), [1c08e30](https://github.com/rohang1411/RECSY/commit/1c08e30e923162c327164909df5908f72e0857d7)).
- Added Playwright coverage, retrieval evaluation tooling, smoke scripts, and CI updates so the project is much easier to validate continuously ([85c8b8d](https://github.com/rohang1411/RECSY/commit/85c8b8db73663d5c35ac24214872bcadf6312b7e), [a998e9f](https://github.com/rohang1411/RECSY/commit/a998e9f1af947cfbd4fcb25e6af625d2fd334b63)).

## Closing Note

Taken together, this release turns RECSY into a much broader and more capable platform. Merging `recsy-v2-rs` into `master` does not just add isolated features; it establishes the full RECSY v2 foundation for web-based discovery, recommendation, retrieval-backed Q&A, and future product growth.
