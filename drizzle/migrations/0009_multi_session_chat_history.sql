ALTER TYPE "public"."session_status" ADD VALUE IF NOT EXISTS 'archived';--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE IF NOT EXISTS 'deleted';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_token" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_clients_client_token_unique" UNIQUE("client_token")
);--> statement-breakpoint
INSERT INTO "recommendation_clients" ("client_token", "ip_hash", "user_agent", "created_at", "last_seen_at")
SELECT "session_cookie", "ip_hash", "user_agent", "created_at", "updated_at"
FROM "recommendation_sessions"
WHERE "session_cookie" IS NOT NULL
ON CONFLICT ("client_token") DO NOTHING;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "client_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "title" text DEFAULT 'New Recommendation' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "primary_intent" text;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
UPDATE "recommendation_sessions" s
SET "client_id" = c."id"
FROM "recommendation_clients" c
WHERE s."session_cookie" = c."client_token" AND s."client_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "recommendation_sessions" WHERE "client_id" IS NULL) THEN
    INSERT INTO "recommendation_clients" ("client_token") VALUES ('fallback-client-token') ON CONFLICT DO NOTHING;
    UPDATE "recommendation_sessions"
    SET "client_id" = (SELECT "id" FROM "recommendation_clients" WHERE "client_token" = 'fallback-client-token' LIMIT 1)
    WHERE "client_id" IS NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "recommendation_sessions" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_sessions_client_id_recommendation_clients_id_fk'
  ) THEN
    ALTER TABLE "recommendation_sessions"
    ADD CONSTRAINT "recommendation_sessions_client_id_recommendation_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."recommendation_clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recommendation_sessions_client_status_updated" ON "recommendation_sessions" USING btree ("client_id", "status", "updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recommendation_turns_session_idx" ON "recommendation_turns" USING btree ("session_id", "turn_index");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"share_token" text NOT NULL,
	"frozen_state" jsonb NOT NULL,
	"views_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "recommendation_shares_share_token_unique" UNIQUE("share_token")
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recommendation_shares_session_id_recommendation_sessions_id_fk'
  ) THEN
    ALTER TABLE "recommendation_shares"
    ADD CONSTRAINT "recommendation_shares_session_id_recommendation_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."recommendation_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;