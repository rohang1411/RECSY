-- =============================================================================
-- Full-text search indexes for hybrid retrieval (Phase 3).
--
-- Rationale (ADR 0004):
--   - Vector search alone misses exact-match queries (model numbers,
--     acronyms, IP68, A18 Pro, …). We add a tsvector GIN index on
--     chunks.text for `websearch_to_tsquery`-driven FTS.
--   - A pg_trgm GIN index on `chunks.text` gives us a similarity
--     fallback for misspellings and very short tokens where tsvector
--     performs poorly.
--
-- Why a generated column (instead of an expression index)?
--   - Generated columns are materialised on write by Postgres, so
--     there's zero app-side maintenance burden. Ingestion writes
--     plain text; Postgres keeps `text_tsv` in sync automatically.
--   - `CREATE INDEX ... USING gin (to_tsvector('english', text))` also
--     works, but breaks tooling that wants to `SELECT text_tsv`
--     directly for debugging and schema inspection.
--
-- Idempotency: every statement uses `IF NOT EXISTS` so `pnpm db:setup`
-- can re-run safely.
-- =============================================================================

-- Generated tsvector column: English config, always in sync with `text`.
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS text_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED;

-- GIN index on the tsvector for fast websearch_to_tsquery matches.
CREATE INDEX IF NOT EXISTS chunks_text_tsv_idx
  ON chunks USING gin (text_tsv);

-- pg_trgm GIN index for similarity() / ILIKE fallback when tsvector
-- returns zero matches (short tokens, misspellings).
CREATE INDEX IF NOT EXISTS chunks_text_trgm_idx
  ON chunks USING gin (text gin_trgm_ops);

-- =============================================================================
-- Rate limits: composite unique for atomic upsert (Phase 3 `/api/ask`)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_key_window_uniq
  ON rate_limits (key, window_start);
