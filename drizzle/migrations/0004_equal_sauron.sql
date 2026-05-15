ALTER TABLE "ingest_runs" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "retry_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "candidate_title" text;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "last_ingest_status" text;--> statement-breakpoint
CREATE INDEX "ingest_runs_phone_status_stage_idx" ON "ingest_runs" USING btree ("phone_id","status","stage");--> statement-breakpoint
CREATE INDEX "ingest_runs_error_code_started_idx" ON "ingest_runs" USING btree ("error_code","started_at");--> statement-breakpoint
CREATE INDEX "phones_last_ingest_status_idx" ON "phones" USING btree ("last_ingest_status");