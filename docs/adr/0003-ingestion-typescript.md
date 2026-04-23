# ADR 0003 — Ingestion is TypeScript-only (no Python sidecar)

- **Status:** Accepted
- **Date:** 2026-04-21
- **Phase:** 2 (Ingestion)
- **Supersedes:** the Python adapter direction sketched in §13 of
  `RECSY_V2_PROJECT_CONTEXT.md` (now updated).
- **Extended by:** [ADR 0014](0014-automated-ingestion-curation.md) —
  automated tiered scheduling, Curator + Disambiguator agents, polite HTTP,
  GSMArena + YouTube-channel adapters, DB-driven source profiles.

## Context

The Phase 2 plan called for a Python 3.12 sidecar (`uv` + `ruff` + `mypy` +
`pydantic`) hosting "MCP-style" `SourceAdapter` implementations for
YouTube, Reddit, and articles. The original justification was "best-in-class
libraries":

| Need               | Python first choice               | TypeScript equivalent               |
| ------------------ | --------------------------------- | ----------------------------------- |
| YouTube transcript | `youtube-transcript-api`          | `youtubei.js`, `youtube-transcript` |
| Reddit             | `praw`                            | Reddit's public JSON API (`/.json`) |
| Article extraction | `trafilatura`, `readability-lxml` | `@mozilla/readability` + `linkedom` |
| Retries / backoff  | `tenacity`                        | `p-retry`, `p-limit`                |
| Tokenizer          | `tiktoken`                        | `gpt-tokenizer`, `js-tiktoken`      |
| Embeddings         | google-generativeai               | `@ai-sdk/google` (already wired)    |

When we revisited the call at the start of Phase 2, several factors had
shifted from "abstract concern" to "concrete cost":

1. **Local toolchain.** `uv` was not installed on the dev machine. Setting
   up a second toolchain (Python launcher + `uv` + venv + lockfile) on
   Windows is real friction.
2. **Schema drift risk.** Python ingestion would need its own translation
   of the `phones`, `sources`, and `chunks` tables (probably as `pydantic`
   models). Drizzle is the source of truth in TypeScript; any divergence
   becomes a silent bug surface.
3. **Duplicate infra.** A second CI lane, a second formatter, a second
   linter, a second test runner, a second package lockfile.
4. **Two LLM clients.** We already have a robust `LlmProvider` interface
   with caching, retries, and Gemini wiring. Mirroring it in Python doubles
   the maintenance surface for what is effectively the same code.
5. **Phase 4 is TypeScript anyway.** The aspect scorecard agent runs as
   server code next to the route handlers — it cannot be Python without an
   RPC boundary. Keeping ingestion in TS means the entire AI surface is
   one runtime.

The library quality gap, on inspection, is small for our use cases:

- YouTube: we only need transcripts + a few metadata fields (title,
  channel, published_at, video_id). `youtubei.js` covers this and is
  actively maintained. If transcript scraping breaks (it does, periodically),
  both Python and TS libraries break together — same upstream YouTube
  changes.
- Reddit: Reddit's public JSON endpoint (`<thread_url>.json`) and search
  endpoint give us threads + top-level comments without auth, with just a
  custom `User-Agent`. `praw`'s value-add is OAuth (rate limits, write),
  which we don't need.
- Articles: `@mozilla/readability` is the same algorithm Firefox Reader
  Mode uses; `linkedom` is a lighter alternative to `jsdom`. This is the
  same quality bar as `trafilatura` for the average tech-blog page.

## Decision

Implement Phase 2 ingestion entirely in TypeScript, co-located with the
existing service code under `src/services/ingest/`, runnable both as a CLI
(`pnpm ingest`) and as a GitHub Actions cron job.

The "MCP-style" naming and structure are preserved — each adapter still
implements the same `SourceAdapter` interface (`discover` → `fingerprint`
→ `fetch` → `chunk`). The boundary is a TypeScript interface instead of a
cross-process protocol, but the architectural property (each source type is
swappable, testable in isolation, and adds no central coupling) is the
same.

## Consequences

### Wins

- Single language, single toolchain, single CI lane.
- Drizzle schema is the literal source of truth — no model translation.
- `LlmProvider` reused for embeddings (caching, retries, observability come
  for free).
- `pino` reused for structured logging with the same trace conventions as
  the web app.
- `Zod` reused for adapter input/output validation, mirroring the
  `PhoneSpec` pattern from Phase 1.
- Dev setup remains "clone, `pnpm install`, `pnpm db:setup`, `pnpm
ingest`".

### Losses

- We don't get to demonstrate polyglot operational skills. For a portfolio,
  this is a marginal loss — we trade it for code cohesion.
- `praw`'s niceties (OAuth-rate-limited reads, comment-tree pagination
  helpers) we have to reimplement minimally. We will, when we need them.

### Mitigations

- The `SourceAdapter` boundary is strict. If a future adapter genuinely
  needs Python (e.g. a model-based extractor), it can run as a separate
  microservice and call into the same `writer` over HTTP. The interface
  doesn't change.
- We commit to keeping ingestion **side-effect-only outside the writer**:
  every adapter must be testable with a fixture file, and the writer is
  the sole DB consumer. This preserves the option to extract any adapter
  to another language later.

## Implementation outline

```
src/services/ingest/
  types.ts          # Zod-validated DTOs + SourceAdapter interface
  chunking.ts       # sentence-aligned token windows
  embedder.ts       # batched Gemini embeddings via LlmProvider
  writer.ts         # idempotent upserts (content_hash gates re-ingest)
  orchestrator.ts   # per-phone discover → fetch → chunk → embed → write
  adapters/
    youtube.ts
    reddit.ts
    article.ts
scripts/
  ingest.ts         # CLI entry: pnpm ingest --phone <slug> --adapter youtube
.github/workflows/
  ingest.yml        # manual_dispatch + nightly cron
```

## References

- `RECSY_V2_PROJECT_CONTEXT.md` §13 (will be rewritten to reflect this ADR)
- ADR 0001 (stack)
- `youtubei.js` README
- Reddit JSON API: https://www.reddit.com/dev/api/
- `@mozilla/readability` README
