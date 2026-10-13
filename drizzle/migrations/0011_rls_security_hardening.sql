-- Migration 0011: RLS Security Hardening and Access Lockdown
ALTER TABLE "public"."scorecard_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."llm_usage_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."phone_regional_details" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."exchange_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."benchmark_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."benchmark_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."recommendation_clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."recommendation_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  public_roles text[] := ARRAY['anon', 'authenticated'];
  r text;
BEGIN
  FOREACH r IN ARRAY public_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE scorecard_runs, llm_usage_events, benchmark_runs, benchmark_results, llm_cache, ingest_runs, rate_limits, recommendation_sessions, recommendation_clients, recommendation_shares, recommendation_turns, recommendation_feedback, chat_queries, crawl_queue, rate_limit_state, catalog_runs, catalog_source_profiles, catalog_snapshots, catalog_candidates, phone_identities, phone_configurations, catalog_source_claims, phone_media_assets, catalog_quality_issues FROM %I', r);
      EXECUTE format('REVOKE SELECT (embedding) ON chunks FROM %I', r);
      EXECUTE format('REVOKE SELECT (spec_embedding) ON phones FROM %I', r);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  public_read_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname)
    INTO public_read_roles
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated');

  IF public_read_roles IS NOT NULL THEN
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
  END IF;
END
$$;
