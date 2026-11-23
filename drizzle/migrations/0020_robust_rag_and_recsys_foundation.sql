-- 0020: Robust RAG and Recsys Foundation (Plan 31 WP-09). Additive and idempotent.

-- 1. Enhance chat_queries for production RAG observability
ALTER TABLE chat_queries
  ADD COLUMN IF NOT EXISTS max_retrieval_similarity double precision,
  ADD COLUMN IF NOT EXISTS min_retrieval_similarity double precision,
  ADD COLUMN IF NOT EXISTS retrieval_mode text DEFAULT 'hybrid',
  ADD COLUMN IF NOT EXISTS fts_hit_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_abstention boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS abstention_reason text,
  ADD COLUMN IF NOT EXISTS entailment_score double precision,
  ADD COLUMN IF NOT EXISTS unsupported_claim_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS citation_count integer DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_queries_abstention_idx ON chat_queries(is_abstention) WHERE is_abstention = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_queries_created_at_idx ON chat_queries(created_at DESC);
--> statement-breakpoint

-- 2. Add contextual chunk storage and media verification columns
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS raw_excerpt text,
  ADD COLUMN IF NOT EXISTS contextual_preamble text;
--> statement-breakpoint
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS http_status integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sources_verification_status_idx ON sources(verification_status);
--> statement-breakpoint

-- 3. Create persistent system health ledger for low-overhead Command Center reads
CREATE TABLE IF NOT EXISTS system_health_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_key text NOT NULL UNIQUE,
  status text NOT NULL,
  metric_value jsonb NOT NULL,
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  execution_ms integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS system_health_ledger_key_idx ON system_health_ledger(audit_key);
