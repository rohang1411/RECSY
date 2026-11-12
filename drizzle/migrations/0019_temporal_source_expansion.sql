-- 0019: Temporal source expansion & continuous discovery (Plan 29). Additive and idempotent.
DO $$ BEGIN
  CREATE TYPE "temporal_category" AS ENUM ('launch', 'long_term_6m', 'long_term_1y', 'comparison', 'reliability', 'general');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "temporal_category" "temporal_category" NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE "crawl_queue" ADD COLUMN IF NOT EXISTS "temporal_category" "temporal_category" NOT NULL DEFAULT 'general';
--> statement-breakpoint
ALTER TABLE "phones" ADD COLUMN IF NOT EXISTS "milestones_scouted" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "domain_profiles" ADD COLUMN IF NOT EXISTS "rss_feed_url" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_temporal_category_idx" ON "sources" ("temporal_category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_phone_temporal_idx" ON "sources" ("phone_id", "temporal_category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crawl_queue_temporal_category_idx" ON "crawl_queue" ("temporal_category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_url_content_hash_idx" ON "sources" ("url", "content_hash");
