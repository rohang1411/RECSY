CREATE TABLE "scorecard_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_id" uuid,
	"aspect" "aspect" NOT NULL,
	"status" "ingest_status" NOT NULL,
	"skip_reason" text,
	"chunk_fingerprint" text,
	"score" numeric(3, 1),
	"confidence" numeric(3, 2),
	"n_sources" integer,
	"duration_ms" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "last_scorecard_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN "next_scorecard_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scorecard_runs" ADD CONSTRAINT "scorecard_runs_phone_id_phones_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."phones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scorecard_runs_phone_idx" ON "scorecard_runs" USING btree ("phone_id");--> statement-breakpoint
CREATE INDEX "scorecard_runs_status_idx" ON "scorecard_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scorecard_runs_started_at_idx" ON "scorecard_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "phones_next_scorecard_at_idx" ON "phones" USING btree ("next_scorecard_at");