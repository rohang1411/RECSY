-- Migration 0012: multi-user metering core (tables, enums, ownership columns).
-- Additive only. Safe to run on vanilla Postgres 16 (CI) and Supabase (PG 17).
-- No dependency on the Supabase `auth` schema: user ids are plain uuids.

DO $$ BEGIN
  CREATE TYPE "lease_status" AS ENUM ('reserved','committed','refunded','expired','no_charge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "charge_source" AS ENUM ('daily_free','anon_free','subscription','credit','byok');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "ledger_kind" AS ENUM ('purchase','subscription_grant','consume','refund','promo','admin_adjustment','payment_reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "billing_event_status" AS ENUM ('received','processing','processed','failed','ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "order_status" AS ENUM ('pending','paid','failed','refunded','partially_refunded','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_counters" (
  "subject_kind" text NOT NULL CHECK ("subject_kind" IN ('user','device','ip')),
  "subject_id"   text NOT NULL,
  "usage_date"   date NOT NULL,
  "free_used"    integer NOT NULL DEFAULT 0 CHECK ("free_used" >= 0),
  "anon_used"    integer NOT NULL DEFAULT 0 CHECK ("anon_used" >= 0),
  "total_used"   integer NOT NULL DEFAULT 0 CHECK ("total_used" >= 0),
  "byok_used"    integer NOT NULL DEFAULT 0 CHECK ("byok_used" >= 0),
  "clarify_used" integer NOT NULL DEFAULT 0 CHECK ("clarify_used" >= 0),
  "users_seen"   integer NOT NULL DEFAULT 0 CHECK ("users_seen" >= 0),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("subject_kind","subject_id","usage_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_counters_date_idx" ON "usage_counters" ("usage_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_wallets" (
  "user_id"    uuid PRIMARY KEY,
  "balance"    integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         uuid NOT NULL,
  "delta"           integer NOT NULL CHECK ("delta" <> 0),
  "balance_after"   integer NOT NULL,
  "kind"            "ledger_kind" NOT NULL,
  "ref_type"        text,
  "ref_id"          text,
  "idempotency_key" text NOT NULL,
  "metadata"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_idem_uniq" ON "credit_ledger" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_user_created_idx" ON "credit_ledger" ("user_id","created_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                  uuid NOT NULL,
  "provider"                 text NOT NULL,
  "provider_subscription_id" text NOT NULL,
  "plan_code"                text NOT NULL,
  "status"                   text NOT NULL,
  "included_queries"         integer NOT NULL CHECK ("included_queries" >= 0),
  "current_period_start"     timestamptz NOT NULL,
  "current_period_end"       timestamptz NOT NULL,
  "entitled_until"           timestamptz,
  "cancel_at_period_end"     boolean NOT NULL DEFAULT false,
  "provider_event_at"        timestamptz NOT NULL DEFAULT now(),
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_provider_sub_uniq" ON "subscriptions" ("provider","provider_subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_user_entitled_idx" ON "subscriptions" ("user_id","entitled_until");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscription_usage" (
  "subscription_id" uuid NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  "period_start"    timestamptz NOT NULL,
  "used"            integer NOT NULL DEFAULT 0 CHECK ("used" >= 0),
  PRIMARY KEY ("subscription_id","period_start")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "query_leases" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id"    uuid NOT NULL,
  "user_id"       uuid,
  "device_id"     text NOT NULL,
  "ip_key"        text,
  "route"         text NOT NULL,
  "charge_source" "charge_source" NOT NULL,
  "status"        "lease_status" NOT NULL DEFAULT 'reserved',
  "usage_date"    date NOT NULL,
  "period_start"  timestamptz,
  "reserved_at"   timestamptz NOT NULL DEFAULT now(),
  "expires_at"    timestamptz NOT NULL,
  "settled_at"    timestamptz,
  "settle_reason" text,
  "trace_id"      text,
  "model"         text,
  "tokens_in"     integer,
  "tokens_out"    integer,
  "latency_ms"    integer,
  "cache_hit"     boolean,
  "cost_micros"   integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "query_leases_device_request_uniq" ON "query_leases" ("device_id","request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "query_leases_open_idx" ON "query_leases" ("expires_at") WHERE "status" = 'reserved';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "query_leases_user_idx" ON "query_leases" ("user_id","reserved_at" DESC) WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "query_leases_reserved_at_idx" ON "query_leases" ("reserved_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_profiles" (
  "id"                    uuid PRIMARY KEY,
  "email"                 text NOT NULL,
  "email_normalized"      text NOT NULL,
  "display_name"          text,
  "avatar_url"            text,
  "country"               text,
  "locale"                text,
  "terms_version"         text,
  "terms_accepted_at"     timestamptz,
  "marketing_opt_in"      boolean NOT NULL DEFAULT false,
  "status"                text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','suspended','pending_deletion')),
  "billing_hold"          boolean NOT NULL DEFAULT false,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  "last_seen_at"          timestamptz NOT NULL DEFAULT now(),
  "deletion_requested_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_profiles_email_norm_uniq" ON "user_profiles" ("email_normalized");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_customers" (
  "user_id"              uuid NOT NULL,
  "provider"             text NOT NULL,
  "provider_customer_id" text NOT NULL,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id","provider")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_customers_provider_cust_uniq" ON "billing_customers" ("provider","provider_customer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_orders" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"              uuid NOT NULL,
  "provider"             text NOT NULL,
  "provider_checkout_id" text NOT NULL,
  "provider_payment_id"  text,
  "product_code"         text NOT NULL,
  "credits"              integer NOT NULL DEFAULT 0 CHECK ("credits" >= 0),
  "amount_minor"         integer NOT NULL CHECK ("amount_minor" >= 0),
  "currency"             text NOT NULL,
  "status"               "order_status" NOT NULL DEFAULT 'pending',
  "refunded_minor"       integer NOT NULL DEFAULT 0 CHECK ("refunded_minor" >= 0),
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "paid_at"              timestamptz,
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_orders_provider_checkout_uniq" ON "billing_orders" ("provider","provider_checkout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_orders_user_created_idx" ON "billing_orders" ("user_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_orders_payment_idx" ON "billing_orders" ("provider","provider_payment_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_events" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider"            text NOT NULL,
  "event_id"            text NOT NULL,
  "event_type"          text NOT NULL,
  "status"              "billing_event_status" NOT NULL DEFAULT 'received',
  "attempts"            integer NOT NULL DEFAULT 0,
  "locked_until"        timestamptz,
  "livemode"            boolean NOT NULL DEFAULT false,
  "refs"                jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error"               text,
  "provider_created_at" timestamptz,
  "received_at"         timestamptz NOT NULL DEFAULT now(),
  "processed_at"        timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_provider_event_uniq" ON "billing_events" ("provider","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_events_pending_idx" ON "billing_events" ("received_at") WHERE "status" IN ('received','processing','failed');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "abuse_blocks" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"       text NOT NULL CHECK ("kind" IN ('email_domain','email_normalized','ip_key','device','user')),
  "value"      text NOT NULL,
  "reason"     text,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abuse_blocks_kind_value_uniq" ON "abuse_blocks" ("kind","value");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_flags" (
  "key"        text PRIMARY KEY,
  "value"      jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_requests" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL,
  "kind"          text NOT NULL CHECK ("kind" IN ('export','delete')),
  "status"        text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','completed','canceled','failed')),
  "requested_at"  timestamptz NOT NULL DEFAULT now(),
  "execute_after" timestamptz,
  "completed_at"  timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_requests_due_idx" ON "account_requests" ("execute_after") WHERE "status" = 'pending';
--> statement-breakpoint

-- Ownership / traceability columns on existing tables (all nullable, no backfill needed).
ALTER TABLE "recommendation_clients" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_clients_user_idx" ON "recommendation_clients" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "recommendation_turns" ADD COLUMN IF NOT EXISTS "lease_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_queries" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_queries" ADD COLUMN IF NOT EXISTS "lease_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_queries_user_idx" ON "chat_queries" ("user_id") WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_turns_lease_idx" ON "recommendation_turns" ("lease_id") WHERE "lease_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_queries_lease_idx" ON "chat_queries" ("lease_id") WHERE "lease_id" IS NOT NULL;
--> statement-breakpoint

-- Long-term aggregate of pruned leases (written by scripts/db-prune.ts; tiny).
CREATE TABLE IF NOT EXISTS "usage_daily_rollup" (
  "usage_date"    date NOT NULL,
  "route"         text NOT NULL,
  "charge_source" "charge_source" NOT NULL,
  "status"        "lease_status" NOT NULL,
  "leases"        integer NOT NULL,
  "tokens_in"     integer NOT NULL DEFAULT 0,
  "tokens_out"    integer NOT NULL DEFAULT 0,
  "cost_micros"   integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("usage_date","route","charge_source","status")
);
--> statement-breakpoint
