# ADR 0016 — Internal Pipeline Observatory Dashboard

## Status

Accepted (2026-05-14)

## Context

RECSY v2 operates complex background processes: hybrid retrieval over vectorized chunks, structured LLM extraction for aspect scorecards, MCP-style data ingestion from multiple platforms, and multi-turn conversational recommendation logic.

While the consumer-facing application successfully abstracts this complexity away to provide a clean, simple user experience, this poses a problem for **reviewers, evaluators, and collaborators**. When someone wants to understand _how_ the system works or verify the quality of the data pipeline, reading the source code or executing CLI scripts (`pnpm retrieval:smoke`) presents too high a barrier to entry.

We need a dedicated, visual presentation layer that can "lift the hood" on the RECSY v2 architecture and demonstrate the data lifecycle end-to-end.

## Decision

### 1. Dedicated Internal Route

We introduced `/internal/pipeline`, a protected route specifically designed for system architecture demonstration. To prevent end-users from accidentally stumbling into this technical interface, it is strictly gated behind the `INTERNAL_DASHBOARD_ENABLED` environment variable. If disabled, the route returns a 404.

### 2. Live Database Metrics

To prove the system is backed by a living corpus rather than static CSVs, the dashboard queries real-time database metrics via a new `getPhoneCoverageStats` service. This exposes counts of active phones, ingested sources, retrievable chunks, and generated aspect rows directly in the UI, proving the scale of the ingestion engine.

### 3. Pre-computed Pipeline Replays

Demonstrating the Conversational Recommender and Hybrid Retrieval pipelines live would consume unnecessary LLM quota and introduce unpredictable latency during presentations.
Instead, we implemented a **Replay** system. We captured real NDJSON stream outputs from the `/api/ask` and `/api/recommend` endpoints and stored them as static fixtures in the `fixtures/` directory. The dashboard uses these fixtures to perfectly simulate the streaming, citation-validation, and extraction processes at 60fps without ever hitting the Gemini API.

### 4. Narrative-Driven Walkthrough UI

The dashboard is structured as a guided, scrollable presentation featuring three core components:

- **`HeroDiagram`**: A high-level, animated SVG or CSS flow diagram that maps the three main pillars: Ingestion, Scorecards, and the Recommender API.
- **`EvidenceLens`**: A drill-down view that connects a polished aspect score (e.g., "Camera: 8.5") back to its underlying raw data (the YouTube transcript chunks that justified the score).
- **`RecommenderReplay`**: A simulated terminal or chat window that replays the structured requirement extraction (`UserRequirements` JSON) turning into a ranked list of candidate phones.

## Consequences

### Positive

- **Instant Understanding**: Reviewers and stakeholders can immediately grasp the architectural complexity of the project without touching the codebase.
- **Zero Cost Demonstration**: Because the complex agent workflows are replayed from fixtures, the dashboard can be demonstrated infinitely without consuming free-tier LLM quotas.
- **Transparency**: Exposing live database metrics proves the system is actively ingesting and processing data.

### Trade-offs

- **Fixture Maintenance**: If the response schema for the Recommender or Chat API changes significantly, the static NDJSON fixtures in `fixtures/` will need to be manually updated to reflect the new structure.
- **Bundle Size**: The dashboard components and fixtures add slight weight to the application, though this is mitigated by Next.js route splitting (these assets are never loaded on consumer routes).

## Implementation Surface

- `src/app/internal/pipeline/page.tsx` — The main dashboard entry point.
- `src/components/internal/` — Dedicated UI components (`HeroDiagram`, `EvidenceLens`, `RecommenderReplay`).
- `src/services/db/stats.ts` — Database aggregations (`getPhoneCoverageStats`).
- `fixtures/` — Static NDJSON replays of API interactions.
- `src/env.ts` — Addition of `INTERNAL_DASHBOARD_ENABLED` flag.
