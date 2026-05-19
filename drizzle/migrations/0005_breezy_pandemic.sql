CREATE TYPE "public"."catalog_candidate_decision" AS ENUM('pending_review', 'promote', 'update_existing', 'matched_existing', 'configuration', 'skip', 'quarantine');--> statement-breakpoint
CREATE TYPE "public"."catalog_candidate_status" AS ENUM('discovered', 'fetched', 'extracted', 'validated', 'ready_to_promote', 'promoted', 'skipped', 'quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted');--> statement-breakpoint
CREATE TYPE "public"."catalog_issue_severity" AS ENUM('info', 'warn', 'blocker');--> statement-breakpoint
CREATE TYPE "public"."catalog_phone_media_status" AS ENUM('local_ok', 'remote_only', 'missing', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."catalog_run_kind" AS ENUM('scheduled', 'manual', 'dry_run', 'resume');--> statement-breakpoint
CREATE TYPE "public"."catalog_run_status" AS ENUM('running', 'success', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."catalog_snapshot_status" AS ENUM('active', 'pruned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."catalog_source_profile_type" AS ENUM('wikidata', 'media', 'oem_sitemap', 'licensed_api', 'aggregator', 'search');--> statement-breakpoint
CREATE TYPE "public"."phone_identity_type" AS ENUM('legacy_slug', 'canonical_key', 'official_url', 'wikidata_qid', 'provider_id', 'oem_product_id', 'model_number', 'sku', 'gtin');--> statement-breakpoint
CREATE TYPE "public"."phone_media_asset_status" AS ENUM('active', 'stale', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."phone_media_rights_status" AS ENUM('cache_allowed', 'remote_only', 'blocked', 'unknown');--> statement-breakpoint
CREATE TABLE "catalog_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_run_id" uuid,
	"last_run_id" uuid,
	"stable_key" text NOT NULL,
	"source_key" text NOT NULL,
	"source_type" text NOT NULL,
	"external_id" text,
	"source_url" text,
	"candidate_title" text NOT NULL,
	"raw_candidate_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_identity_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"claims_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_key" text,
	"content_hash" text,
	"last_snapshot_id" uuid,
	"matched_phone_id" uuid,
	"decision" "catalog_candidate_decision",
	"status" "catalog_candidate_status" DEFAULT 'discovered' NOT NULL,
	"confidence" numeric(3, 2),
	"issue_codes" text[] DEFAULT '{}' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"retry_after" timestamp with time zone,
	"last_decision_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_candidates_stable_key_uniq" UNIQUE("stable_key"),
	CONSTRAINT "catalog_candidates_source_external_uniq" UNIQUE("source_key","external_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_quality_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"candidate_id" uuid,
	"phone_id" uuid,
	"severity" "catalog_issue_severity" DEFAULT 'warn' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"field_path" text,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "catalog_run_kind" DEFAULT 'manual' NOT NULL,
	"status" "catalog_run_status" DEFAULT 'running' NOT NULL,
	"stage" text,
	"checkpoint_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"quarantined_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_code" text,
	"request_count" integer DEFAULT 0 NOT NULL,
	"llm_call_count" integer DEFAULT 0 NOT NULL,
	"max_wall_ms" integer,
	"max_requests" integer,
	"max_new_promotions" integer,
	"max_llm_calls" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "catalog_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"headers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_ref" text,
	"body_bytes" integer,
	"content_type" text,
	"status" "catalog_snapshot_status" DEFAULT 'active' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_snapshots_source_hash_uniq" UNIQUE("source_key","content_hash")
);
--> statement-breakpoint
CREATE TABLE "catalog_source_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"candidate_id" uuid,
	"source_key" text NOT NULL,
	"source_url" text,
	"field_path" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"unit" text,
	"confidence" numeric(3, 2),
	"trust_weight" numeric(3, 2),
	"content_hash" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"is_disputed" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_snapshot_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_source_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"type" "catalog_source_profile_type" NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"trust_weight" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_urls" text[] DEFAULT '{}' NOT NULL,
	"sitemap_urls" text[] DEFAULT '{}' NOT NULL,
	"allowed_url_patterns" text[] DEFAULT '{}' NOT NULL,
	"robots_respected" boolean DEFAULT true NOT NULL,
	"rate_limit_ms" integer DEFAULT 3000 NOT NULL,
	"monthly_request_budget" integer,
	"last_polled_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"cursor_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_source_profiles_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "phone_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"region" text,
	"model_number" text,
	"sku" text,
	"gtin" text,
	"ram_gb" integer,
	"storage_gb" integer,
	"color" text,
	"network_variant" text,
	"market_variant" text,
	"sim_variant" text,
	"price_amount" numeric(10, 2),
	"price_currency" text,
	"availability_status" text,
	"source_key" text,
	"source_url" text,
	"confidence" numeric(3, 2),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_configs_natural_uniq" UNIQUE("phone_id","region","model_number","market_variant","ram_gb","storage_gb","color")
);
--> statement-breakpoint
CREATE TABLE "phone_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"identity_type" "phone_identity_type" NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_identities_source_external_uniq" UNIQUE("source_key","external_id"),
	CONSTRAINT "phone_identities_type_value_uniq" UNIQUE("identity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "phone_media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"source_key" text,
	"origin_url" text,
	"storage_path" text,
	"public_url" text,
	"sha256" text NOT NULL,
	"perceptual_hash" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"license" text,
	"license_url" text,
	"attribution" text,
	"rights_status" "phone_media_rights_status" DEFAULT 'unknown' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "phone_media_asset_status" DEFAULT 'active' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_media_phone_sha_uniq" UNIQUE("phone_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "canonical_key" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "family" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "generation" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "official_url" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "announced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "discontinued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "catalog_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "last_catalog_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "next_catalog_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "metadata_confidence" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "spec_completeness" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "media_status" "catalog_phone_media_status";--> statement-breakpoint
ALTER TABLE "catalog_candidates" ADD CONSTRAINT "catalog_candidates_first_run_id_catalog_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."catalog_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_candidates" ADD CONSTRAINT "catalog_candidates_last_run_id_catalog_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."catalog_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_candidates" ADD CONSTRAINT "catalog_candidates_last_snapshot_id_catalog_snapshots_id_fk" FOREIGN KEY ("last_snapshot_id") REFERENCES "public"."catalog_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_candidates" ADD CONSTRAINT "catalog_candidates_matched_phone_id_phones_id_fk" FOREIGN KEY ("matched_phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_quality_issues" ADD CONSTRAINT "catalog_quality_issues_run_id_catalog_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."catalog_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_quality_issues" ADD CONSTRAINT "catalog_quality_issues_candidate_id_catalog_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."catalog_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_quality_issues" ADD CONSTRAINT "catalog_quality_issues_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_source_claims" ADD CONSTRAINT "catalog_source_claims_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_source_claims" ADD CONSTRAINT "catalog_source_claims_candidate_id_catalog_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."catalog_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_configurations" ADD CONSTRAINT "phone_configurations_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_identities" ADD CONSTRAINT "phone_identities_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_media_assets" ADD CONSTRAINT "phone_media_assets_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_candidates_status_idx" ON "catalog_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "catalog_candidates_canonical_key_idx" ON "catalog_candidates" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "catalog_candidates_retry_idx" ON "catalog_candidates" USING btree ("retry_after");--> statement-breakpoint
CREATE INDEX "catalog_candidates_matched_phone_idx" ON "catalog_candidates" USING btree ("matched_phone_id");--> statement-breakpoint
CREATE INDEX "catalog_quality_issues_run_idx" ON "catalog_quality_issues" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "catalog_quality_issues_candidate_idx" ON "catalog_quality_issues" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "catalog_quality_issues_code_idx" ON "catalog_quality_issues" USING btree ("code");--> statement-breakpoint
CREATE INDEX "catalog_runs_status_idx" ON "catalog_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "catalog_runs_started_at_idx" ON "catalog_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "catalog_snapshots_url_idx" ON "catalog_snapshots" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "catalog_snapshots_fetched_idx" ON "catalog_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "catalog_claims_phone_field_idx" ON "catalog_source_claims" USING btree ("phone_id","field_path");--> statement-breakpoint
CREATE INDEX "catalog_claims_candidate_idx" ON "catalog_source_claims" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "catalog_claims_current_idx" ON "catalog_source_claims" USING btree ("is_current");--> statement-breakpoint
CREATE INDEX "catalog_source_profiles_enabled_idx" ON "catalog_source_profiles" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "catalog_source_profiles_type_idx" ON "catalog_source_profiles" USING btree ("type");--> statement-breakpoint
CREATE INDEX "phone_configs_phone_idx" ON "phone_configurations" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "phone_identities_phone_idx" ON "phone_identities" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "phone_media_phone_primary_idx" ON "phone_media_assets" USING btree ("phone_id","is_primary");--> statement-breakpoint
CREATE INDEX "phone_media_status_idx" ON "phone_media_assets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "phones_canonical_key_uniq" ON "phones" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "phones_catalog_last_seen_idx" ON "phones" USING btree ("catalog_last_seen_at");--> statement-breakpoint
CREATE INDEX "phones_next_catalog_refresh_idx" ON "phones" USING btree ("next_catalog_refresh_at");