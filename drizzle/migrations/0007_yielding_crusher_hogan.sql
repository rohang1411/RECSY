CREATE TABLE "llm_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"operation" text NOT NULL,
	"usage_area" text DEFAULT 'uncategorized' NOT NULL,
	"usage_feature" text,
	"source" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"api_key_index" integer,
	"latency_ms" integer,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_usage_events_created_at_idx" ON "llm_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_usage_events_area_idx" ON "llm_usage_events" USING btree ("usage_area");--> statement-breakpoint
CREATE INDEX "llm_usage_events_model_idx" ON "llm_usage_events" USING btree ("model");