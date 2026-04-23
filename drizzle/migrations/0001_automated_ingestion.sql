CREATE TYPE "public"."crawl_queue_status" AS ENUM('queued', 'in_progress', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ingest_tier" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."published_precision" AS ENUM('day', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."sentiment_summary" AS ENUM('positive', 'mixed', 'negative', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."source_phone_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TABLE "crawl_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"tier" "ingest_tier" DEFAULT 'warm' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"status" "crawl_queue_status" DEFAULT 'queued' NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"handle" text NOT NULL,
	"trust_weight" numeric(3, 2) DEFAULT '0.8' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"status" "profile_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profiles_platform_external_uniq" UNIQUE("platform","external_id")
);
--> statement-breakpoint
CREATE TABLE "domain_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL,
	"trust_weight" numeric(3, 2) DEFAULT '0.5' NOT NULL,
	"rate_limit_ms" integer DEFAULT 3000 NOT NULL,
	"robots_respected" boolean DEFAULT true NOT NULL,
	"robots_json" jsonb,
	"robots_fetched_at" timestamp with time zone,
	"status" "profile_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_profiles_host_unique" UNIQUE("host")
);
--> statement-breakpoint
CREATE TABLE "phone_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_aliases_phone_alias_uniq" UNIQUE("phone_id","alias")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_state" (
	"host" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"req_count" integer DEFAULT 0 NOT NULL,
	"next_allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_phone_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"phone_id" uuid NOT NULL,
	"role" "source_phone_role" NOT NULL,
	"relevance" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_phone_links_source_phone_uniq" UNIQUE("source_id","phone_id")
);
--> statement-breakpoint
CREATE TABLE "subreddit_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'general' NOT NULL,
	"min_score" integer DEFAULT 20 NOT NULL,
	"trust_weight" numeric(3, 2) DEFAULT '0.7' NOT NULL,
	"last_polled_at" timestamp with time zone,
	"status" "profile_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subreddit_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "rate_limits_key_window_idx";--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "tier" "ingest_tier";--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "discovery_strategy" text;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "last_ingest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "next_ingest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "relevance" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "quality" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "sentiment_summary" "sentiment_summary";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "aspects_covered" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "view_count" integer;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "engagement_score" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "published_precision" "published_precision";--> statement-breakpoint
ALTER TABLE "crawl_queue" ADD CONSTRAINT "crawl_queue_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_aliases" ADD CONSTRAINT "phone_aliases_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_phone_links" ADD CONSTRAINT "source_phone_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_phone_links" ADD CONSTRAINT "source_phone_links_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_queue_status_sched_idx" ON "crawl_queue" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "crawl_queue_phone_idx" ON "crawl_queue" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "creator_profiles_status_idx" ON "creator_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_profiles_status_idx" ON "domain_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "phone_aliases_alias_idx" ON "phone_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "source_phone_links_phone_idx" ON "source_phone_links" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "subreddit_profiles_status_idx" ON "subreddit_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingest_runs_rejected_reason_idx" ON "ingest_runs" USING btree ("rejected_reason");--> statement-breakpoint
CREATE INDEX "ingest_runs_started_at_idx" ON "ingest_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "phones_next_ingest_at_idx" ON "phones" USING btree ("next_ingest_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_key_window_uniq" ON "rate_limits" USING btree ("key","window_start");