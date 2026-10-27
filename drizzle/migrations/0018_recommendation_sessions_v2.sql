-- 0018: Recommendation sessions v2 (Plan 27 WP-02). Additive and idempotent.
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "device_id" text;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "title_source" text NOT NULL DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "first_message" text;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "turn_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "next_turn_index" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "last_turn_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "last_picks_summary" jsonb;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "recommendation_turns" ADD COLUMN IF NOT EXISTS "result_meta" jsonb;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_sessions_title_source_chk') THEN
    ALTER TABLE "recommendation_sessions"
      ADD CONSTRAINT "recommendation_sessions_title_source_chk"
      CHECK ("title_source" IN ('default','heuristic','llm','user'));
  END IF;
END $$;
--> statement-breakpoint

-- Backfill ownership from the per-session client row.
UPDATE "recommendation_sessions" s
   SET "user_id" = c."user_id"
  FROM "recommendation_clients" c
 WHERE s."client_id" = c."id" AND s."user_id" IS NULL AND c."user_id" IS NOT NULL;
--> statement-breakpoint

-- Backfill counters and activity from turns. next_turn_index uses MAX+1, not COUNT, because indexes can have gaps.
UPDATE "recommendation_sessions" s
   SET "turn_count"      = t.cnt,
       "next_turn_index" = t.max_idx + 1,
       "last_turn_at"    = t.last_at,
       "first_message"   = left(t.first_msg, 160)
  FROM (
    SELECT session_id,
           count(*)::int                                   AS cnt,
           max(turn_index)                                 AS max_idx,
           max(created_at)                                 AS last_at,
           (array_agg(user_message ORDER BY turn_index))[1] AS first_msg
      FROM "recommendation_turns"
     GROUP BY session_id
  ) t
 WHERE s."id" = t.session_id;
--> statement-breakpoint
UPDATE "recommendation_sessions" SET "last_turn_at" = "created_at" WHERE "turn_count" = 0;
--> statement-breakpoint
UPDATE "recommendation_sessions" SET "deleted_at" = "updated_at" WHERE "status" = 'deleted' AND "deleted_at" IS NULL;
--> statement-breakpoint

-- Indexes
CREATE INDEX IF NOT EXISTS "rs_user_recent_idx"
  ON "recommendation_sessions" ("user_id", "last_turn_at" DESC, "id" DESC)
  WHERE "user_id" IS NOT NULL AND "status" IN ('active','archived');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rs_device_recent_idx"
  ON "recommendation_sessions" ("device_id", "last_turn_at" DESC, "id" DESC)
  WHERE "user_id" IS NULL AND "device_id" IS NOT NULL AND "status" IN ('active','archived');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rs_deleted_purge_idx"
  ON "recommendation_sessions" ("deleted_at")
  WHERE "status" = 'deleted';
