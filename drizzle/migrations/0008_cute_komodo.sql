CREATE TABLE "benchmark_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"test_case_id" text NOT NULL,
	"category" text NOT NULL,
	"input_query" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"scores" jsonb,
	"trace_payload" jsonb,
	"error_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_name" text NOT NULL,
	"tier" text DEFAULT 'L1_DATA_PLANE' NOT NULL,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"commit_hash" text,
	"status" text DEFAULT 'running' NOT NULL,
	"total_tests" integer DEFAULT 0 NOT NULL,
	"passed_tests" integer DEFAULT 0 NOT NULL,
	"failed_tests" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"concurrency_vus" integer DEFAULT 1 NOT NULL,
	"metrics_summary" jsonb,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_run_id_benchmark_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmark_results_run_id_idx" ON "benchmark_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "benchmark_results_status_idx" ON "benchmark_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "benchmark_runs_created_at_idx" ON "benchmark_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "benchmark_runs_tier_idx" ON "benchmark_runs" USING btree ("tier");