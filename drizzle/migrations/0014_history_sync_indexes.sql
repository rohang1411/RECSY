CREATE INDEX IF NOT EXISTS "idx_recommendation_sessions_updated_at" ON "recommendation_sessions" USING btree ("updated_at" DESC);
