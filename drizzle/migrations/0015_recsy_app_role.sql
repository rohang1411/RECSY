-- Migration 0015: Least-privilege runtime database role recsy_app (Plan 25 WP-20)
-- Creates the dedicated login role for application runtime connections with
-- permissions strictly limited to the application schema (public).
-- Prevents DDL, function alterations, and access to Supabase internal schemas (auth, storage, cron).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recsy_app') THEN
    BEGIN
      CREATE ROLE recsy_app WITH LOGIN NOINHERIT;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO recsy_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM recsy_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO recsy_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO recsy_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO recsy_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recsy_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO recsy_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO recsy_app;
--> statement-breakpoint
DO $$
DECLARE
  sensitive_schemas text[] := ARRAY['auth', 'storage', 'cron', 'vault', 'graphql', 'realtime'];
  s text;
BEGIN
  FOREACH s IN ARRAY sensitive_schemas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = s) THEN
      BEGIN
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM recsy_app', s);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM recsy_app', s);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM recsy_app', s);
        EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM recsy_app', s);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END
$$;
