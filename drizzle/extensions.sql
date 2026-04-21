-- =============================================================================
-- Postgres extensions required by RECSY v2.
--
-- This file runs BEFORE any Drizzle migration because the generated schema
-- references types and operator classes (e.g. `vector(768)`,
-- `vector_cosine_ops`) that only exist after `pgvector` is installed.
--
-- Supabase provisions these extensions via the dedicated `extensions` schema;
-- we use `WITH SCHEMA extensions` to follow their convention and avoid
-- polluting the `public` namespace.
-- =============================================================================

-- Embedding vectors + HNSW / IVFFlat indexing.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Trigram similarity + indexable ILIKE for hybrid (vector + FTS) search.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- UUIDv4 via `gen_random_uuid()` — already in Postgres 13+ core
-- (pgcrypto is available as a backstop).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Scheduled jobs (cache eviction, ingest cleanup). Installed into the
-- built-in pg_catalog schema per pg_cron convention.
-- May fail on project plans where pg_cron is not available -- the db-setup
-- script treats failure here as a soft warning.
CREATE EXTENSION IF NOT EXISTS pg_cron;
