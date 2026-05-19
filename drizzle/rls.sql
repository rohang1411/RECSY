-- =============================================================================
-- Row Level Security policies.
--
-- Posture: DEFAULT-DENY. Every table has RLS enabled; any role without a
-- matching policy sees nothing.
--
-- Roles (Supabase pre-provisions these):
--   - anon         → unauthenticated client (REST + GraphQL via PostgREST).
--   - authenticated → signed-in user (not used in MVP; policies mirror anon).
--   - service_role → server-only; BYPASSES RLS by design (used by our
--                    Next.js route handlers and the ingestion pipeline).
--
-- Naming: `<role>_<verb>_<table>` (e.g. `anon_select_phones`).
--
-- This file is re-runnable: every CREATE POLICY is guarded by a DROP first.
-- =============================================================================

-- Helper: make the file idempotent by dropping any existing policy with the
-- same name before recreating it. Postgres doesn't support `CREATE POLICY IF
-- NOT EXISTS`, so we emulate it.
DO $$
BEGIN
  -- no-op; block is just a syntax anchor so psql can run this file cleanly.
  RAISE NOTICE 'Applying RLS policies for RECSY v2';
END
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table. `service_role` continues to bypass per Supabase.
-- ---------------------------------------------------------------------------
ALTER TABLE phones                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE aspect_definitions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aspects                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_turns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_queries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cache                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits              ENABLE ROW LEVEL SECURITY;
-- Automated ingestion pipeline tables — all service-role-only.
ALTER TABLE phone_aliases            ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subreddit_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_phone_links       ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_queue              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_state         ENABLE ROW LEVEL SECURITY;
-- Automated catalog refresh tables — all service-role-only.
ALTER TABLE catalog_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_source_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_snapshots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_candidates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_identities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_configurations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_source_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_media_assets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_quality_issues   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Public read policies — anon + authenticated can browse the corpus.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  public_read_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname)
    INTO public_read_roles
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated');

  IF public_read_roles IS NULL THEN
    RAISE NOTICE 'Skipping public-read RLS policies: roles anon/authenticated do not exist';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS anon_select_phones ON phones';
  EXECUTE format(
    'CREATE POLICY anon_select_phones ON phones FOR SELECT TO %s USING (status = ''active'')',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_aspect_definitions ON aspect_definitions';
  EXECUTE format(
    'CREATE POLICY anon_select_aspect_definitions ON aspect_definitions FOR SELECT TO %s USING (true)',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_aspects ON aspects';
  EXECUTE format(
    'CREATE POLICY anon_select_aspects ON aspects FOR SELECT TO %s USING (true)',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_sources ON sources';
  EXECUTE format(
    'CREATE POLICY anon_select_sources ON sources FOR SELECT TO %s USING (status = ''active'')',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_chunks ON chunks';
  EXECUTE format(
    'CREATE POLICY anon_select_chunks ON chunks FOR SELECT TO %s USING (true)',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_source_phone_links ON source_phone_links';
  EXECUTE format(
    'CREATE POLICY anon_select_source_phone_links ON source_phone_links FOR SELECT TO %s USING (true)',
    public_read_roles
  );
END
$$;

-- ---------------------------------------------------------------------------
-- No anon policies for the following tables — only service_role sees them:
--   recommendation_sessions, recommendation_turns, recommendation_feedback,
--   chat_queries, llm_cache, ingest_runs, rate_limits,
--   phone_aliases, creator_profiles, subreddit_profiles, domain_profiles,
--   crawl_queue, rate_limit_state, catalog_runs, catalog_source_profiles,
--   catalog_snapshots, catalog_candidates, phone_identities,
--   phone_configurations, catalog_source_claims, phone_media_assets,
--   catalog_quality_issues.
--
-- Rationale:
--   - chat/recommendation logs may contain user-provided text that we don't
--     want indexed or exposed to the browser;
--   - llm_cache and ingest_runs are operational telemetry;
--   - rate_limits is a server-enforced counter table.
--
-- When auth is added (Phase 5+), we'll add `authenticated_own_*` policies
-- keyed on a session-cookie match.
-- ---------------------------------------------------------------------------
