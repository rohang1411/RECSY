CREATE TYPE "public"."aspect" AS ENUM('camera', 'battery', 'performance', 'display', 'build', 'software', 'value');--> statement-breakpoint
CREATE TYPE "public"."feedback_event" AS ENUM('click', 'dismiss', 'refine', 'thumbs_up', 'thumbs_down');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('started', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."phone_status" AS ENUM('active', 'discontinued', 'upcoming');--> statement-breakpoint
CREATE TYPE "public"."recommendation_intent" AS ENUM('recommend', 'chat', 'browse', 'clarify');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'removed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('youtube', 'reddit', 'article');--> statement-breakpoint
CREATE TABLE "aspect_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aspect" "aspect" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"description" text NOT NULL,
	"query_prompts" text[] DEFAULT '{}' NOT NULL,
	"default_weight" numeric(4, 3) DEFAULT '0.15' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aspect_definitions_aspect_version_uniq" UNIQUE("aspect","version")
);
--> statement-breakpoint
CREATE TABLE "aspects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"aspect_definition_id" uuid NOT NULL,
	"score" numeric(3, 1) NOT NULL,
	"raw_score" numeric(3, 1) NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"n_sources" integer DEFAULT 0 NOT NULL,
	"n_supporting" integer DEFAULT 0 NOT NULL,
	"n_dissenting" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"supporting_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dissenting_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aspects_phone_aspect_uniq" UNIQUE("phone_id","aspect_definition_id")
);
--> statement-breakpoint
CREATE TABLE "chat_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"session_cookie" text,
	"query" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieved_chunk_ids" uuid[] DEFAULT '{}' NOT NULL,
	"latency_ms" integer NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"phone_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"start_ts" integer,
	"end_ts" integer,
	"anchor" text,
	"tokens" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-004' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter" text NOT NULL,
	"phone_id" uuid,
	"source_url" text,
	"status" "ingest_status" NOT NULL,
	"chunks_created" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_hash" text NOT NULL,
	"prompt_raw" text NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_cache_prompt_hash_unique" UNIQUE("prompt_hash")
);
--> statement-breakpoint
CREATE TABLE "phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"tagline" text,
	"launch_date" timestamp with time zone,
	"msrp_usd" numeric(10, 2),
	"image_url" text,
	"status" "phone_status" DEFAULT 'active' NOT NULL,
	"spec_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec_embedding" vector(768),
	"region_availability" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phones_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"phone_id" uuid,
	"event" "feedback_event" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_cookie" text NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_sessions_session_cookie_unique" UNIQUE("session_cookie")
);
--> statement-breakpoint
CREATE TABLE "recommendation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_index" integer NOT NULL,
	"user_message" text NOT NULL,
	"intent" "recommendation_intent" NOT NULL,
	"extracted_requirements" jsonb,
	"candidate_phone_ids" uuid[] DEFAULT '{}' NOT NULL,
	"picks" jsonb,
	"clarifying_question" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_turns_session_turn_uniq" UNIQUE("session_id","turn_index")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid NOT NULL,
	"type" "source_type" NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"channel" text,
	"language" text DEFAULT 'en' NOT NULL,
	"published_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"raw_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_phone_url_uniq" UNIQUE("phone_id","url")
);
--> statement-breakpoint
ALTER TABLE "aspects" ADD CONSTRAINT "aspects_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aspects" ADD CONSTRAINT "aspects_aspect_definition_id_aspect_definitions_id_fk" FOREIGN KEY ("aspect_definition_id") REFERENCES "public"."aspect_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_queries" ADD CONSTRAINT "chat_queries_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_turn_id_recommendation_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."recommendation_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_turns" ADD CONSTRAINT "recommendation_turns_session_id_recommendation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."recommendation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aspects_phone_id_idx" ON "aspects" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "chat_queries_phone_id_idx" ON "chat_queries" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "chunks_phone_id_idx" ON "chunks" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "chunks_source_id_idx" ON "chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ingest_runs_adapter_idx" ON "ingest_runs" USING btree ("adapter");--> statement-breakpoint
CREATE INDEX "ingest_runs_status_idx" ON "ingest_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "llm_cache_model_idx" ON "llm_cache" USING btree ("model");--> statement-breakpoint
CREATE INDEX "phones_brand_idx" ON "phones" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "phones_status_idx" ON "phones" USING btree ("status");--> statement-breakpoint
CREATE INDEX "phones_spec_embedding_idx" ON "phones" USING hnsw ("spec_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "rate_limits_key_window_idx" ON "rate_limits" USING btree ("key","window_start");--> statement-breakpoint
CREATE INDEX "recommendation_feedback_turn_id_idx" ON "recommendation_feedback" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "sources_phone_id_idx" ON "sources" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "sources_status_idx" ON "sources" USING btree ("status");