-- =============================================================================
-- Row Level Security policies and Grant Hardening.
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

DO $$
BEGIN
  RAISE NOTICE 'Applying hardened RLS policies and role revocations for RECSY v2';
END
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (including newly audited operational tables).
-- ---------------------------------------------------------------------------
ALTER TABLE phones                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE aspect_definitions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aspects                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_clients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_shares    ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_turns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_queries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cache                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits              ENABLE ROW LEVEL SECURITY;

-- Telemetry & Regional pricing tables
ALTER TABLE scorecard_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_regional_details   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_results        ENABLE ROW LEVEL SECURITY;

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

-- Plan 25 multi-user, metering, and billing tables (all service-role-only).
ALTER TABLE usage_counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_wallets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_leases            ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily_rollup      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE abuse_blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_flags          ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_requests        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Role privilege revocations:
-- Strictly revoke ALL write privileges (INSERT, UPDATE, DELETE) on all tables
-- from anon and authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  public_roles text[] := ARRAY['anon', 'authenticated'];
  r text;
  f text;
BEGIN
  FOREACH r IN ARRAY public_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- Revoke all table-level write operations across public schema
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM %I', r);

      -- Revoke all access on private operational and telemetry tables
      EXECUTE format('REVOKE ALL ON TABLE scorecard_runs, llm_usage_events, benchmark_runs, benchmark_results, llm_cache, ingest_runs, rate_limits, recommendation_sessions, recommendation_clients, recommendation_shares, recommendation_turns, recommendation_feedback, chat_queries, crawl_queue, rate_limit_state, catalog_runs, catalog_source_profiles, catalog_snapshots, catalog_candidates, phone_identities, phone_configurations, catalog_source_claims, phone_media_assets, catalog_quality_issues, usage_counters, credit_wallets, credit_ledger, subscriptions, subscription_usage, query_leases, usage_daily_rollup, user_profiles, billing_customers, billing_orders, billing_events, abuse_blocks, platform_flags, account_requests FROM %I', r);

      -- Prevent bulk vector extraction over PostgREST on corpus tables
      EXECUTE format('REVOKE SELECT (embedding) ON chunks FROM %I', r);
      EXECUTE format('REVOKE SELECT (spec_embedding) ON phones FROM %I', r);

      -- Revoke execution on metering functions (when functions exist)
      FOREACH f IN ARRAY ARRAY[
        'recsy_apply_credit_delta(uuid,integer,ledger_kind,text,text,text,jsonb)',
        'recsy_reserve_query(uuid,text,text,uuid,text,text,boolean,integer,integer,integer,integer,integer,integer,integer,boolean)',
        'recsy_settle_lease(uuid,text,text,text,integer,integer,integer,boolean,integer,integer)',
        'recsy_sweep_expired_leases(integer)',
        'recsy_link_device_to_user(uuid,text)',
        'recsy_undo_lease_charge(query_leases)'
      ] LOOP
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = split_part(f, '(', 1)) THEN
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

-- Ensure future tables and functions do not accidentally grant public access
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Public read policies — anon + authenticated can browse public catalog.
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

  EXECUTE 'DROP POLICY IF EXISTS anon_select_phone_regional_details ON phone_regional_details';
  EXECUTE format(
    'CREATE POLICY anon_select_phone_regional_details ON phone_regional_details FOR SELECT TO %s USING (is_available = true)',
    public_read_roles
  );

  EXECUTE 'DROP POLICY IF EXISTS anon_select_exchange_rates ON exchange_rates';
  EXECUTE format(
    'CREATE POLICY anon_select_exchange_rates ON exchange_rates FOR SELECT TO %s USING (true)',
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
