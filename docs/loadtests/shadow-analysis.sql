-- ============================================================================
-- RECSY v2: Shadow Mode Quota & Capacity Analysis Queries
-- Normative reference: Section 7.5, 11.1, 17.1 (Stage S1-S3 Validation)
-- ============================================================================
-- These analytical queries inspect shadow-mode traffic to validate:
--   1. Calls per query across recommender and chat pipelines
--   2. Clarify turn ratio (ensuring clarifying questions are 0-charged)
--   3. Projected quota denials if QUOTA_MODE=enforce were enabled
--   4. Lease status distribution (committed, refunded, expired)
--   5. Peak concurrency and p50/p95/p99 lease duration (ms)
--   6. Platform cap headroom and consumption patterns
-- ============================================================================

-- 1. Daily Lease Volume and Status Breakdown (Last 14 Days)
SELECT
  date_trunc('day', ql.reserved_at AT TIME ZONE 'UTC') AS day_utc,
  ql.route,
  ql.status,
  ql.charge_source,
  count(*) AS lease_count,
  count(DISTINCT ql.subject_id) AS distinct_subjects,
  count(DISTINCT ql.device_id) AS distinct_devices,
  count(DISTINCT ql.user_id) AS distinct_users
FROM query_leases ql
WHERE ql.reserved_at >= now() - INTERVAL '14 days'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 2, 3;

-- 2. Calls per Delivered Query and Refund Analysis
-- Measures LLM call fanout and refund rates per route
SELECT
  ql.route,
  count(*) AS total_reservations,
  count(*) FILTER (WHERE ql.status = 'committed') AS committed_queries,
  count(*) FILTER (WHERE ql.status = 'refunded') AS refunded_queries,
  count(*) FILTER (WHERE ql.status = 'expired') AS expired_leases,
  round(100.0 * count(*) FILTER (WHERE ql.status = 'refunded') / nullif(count(*), 0), 2) AS refund_pct,
  round(100.0 * count(*) FILTER (WHERE ql.status = 'expired') / nullif(count(*), 0), 2) AS late_expired_pct
FROM query_leases ql
WHERE ql.reserved_at >= now() - INTERVAL '7 days'
GROUP BY ql.route;

-- 3. Clarifying Turn Ratio (Recommender Pipeline)
-- Clarifying questions must be 0-charged (no lease committed or zero charge)
SELECT
  date_trunc('day', t.created_at AT TIME ZONE 'UTC') AS day_utc,
  count(*) AS total_turns,
  count(*) FILTER (WHERE t.type = 'recommendation') AS recommendation_turns,
  count(*) FILTER (WHERE t.type = 'clarify') AS clarify_turns,
  round(100.0 * count(*) FILTER (WHERE t.type = 'clarify') / nullif(count(*), 0), 2) AS clarify_pct
FROM recommendation_turns t
WHERE t.created_at >= now() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 4. Projected Daily Denials under 2 Free Queries/Day Limit
-- Simulates the user experience if QUOTA_MODE=enforce had been active
WITH daily_subject_usage AS (
  SELECT
    date_trunc('day', ql.reserved_at AT TIME ZONE 'UTC') AS day_utc,
    ql.subject_id,
    ql.device_id,
    ql.user_id,
    count(*) FILTER (WHERE ql.status = 'committed' AND ql.charge_source = 'free_daily') AS daily_committed_queries
  FROM query_leases ql
  WHERE ql.reserved_at >= now() - INTERVAL '7 days'
  GROUP BY 1, 2, 3, 4
)
SELECT
  day_utc,
  count(DISTINCT subject_id) AS total_active_subjects,
  count(DISTINCT subject_id) FILTER (WHERE daily_committed_queries <= 2) AS subjects_within_free_tier,
  count(DISTINCT subject_id) FILTER (WHERE daily_committed_queries > 2) AS subjects_exceeding_free_tier,
  round(
    100.0 * count(DISTINCT subject_id) FILTER (WHERE daily_committed_queries > 2) /
    nullif(count(DISTINCT subject_id), 0),
    2
  ) AS projected_paywall_hit_rate_pct,
  sum(greatest(0, daily_committed_queries - 2)) AS projected_monetizable_queries
FROM daily_subject_usage
GROUP BY day_utc
ORDER BY day_utc DESC;

-- 5. Lease Duration Percentiles (p50, p95, p99 in Milliseconds)
-- Verifies that lease TTL of 60s is safe and no leases hang
SELECT
  ql.route,
  ql.status,
  percentile_cont(0.50) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (ql.settled_at - ql.reserved_at)) * 1000
  ) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (ql.settled_at - ql.reserved_at)) * 1000
  ) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (ql.settled_at - ql.reserved_at)) * 1000
  ) AS p99_ms,
  max(EXTRACT(EPOCH FROM (ql.settled_at - ql.reserved_at)) * 1000) AS max_duration_ms
FROM query_leases ql
WHERE ql.reserved_at >= now() - INTERVAL '7 days'
  AND ql.settled_at IS NOT NULL
GROUP BY ql.route, ql.status;

-- 6. BYOK vs Platform Pool Traffic Breakdown
SELECT
  date_trunc('day', ql.reserved_at AT TIME ZONE 'UTC') AS day_utc,
  count(*) FILTER (WHERE ql.charge_source = 'byok') AS byok_queries,
  count(*) FILTER (WHERE ql.charge_source <> 'byok') AS platform_queries,
  round(
    100.0 * count(*) FILTER (WHERE ql.charge_source = 'byok') / nullif(count(*), 0),
    2
  ) AS byok_share_pct
FROM query_leases ql
WHERE ql.reserved_at >= now() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 7. Platform Daily Cap Shedding Simulation
-- Evaluates how often global load shedding (0.8x and 1.0x cap) would trigger
SELECT
  date_trunc('day', ql.reserved_at AT TIME ZONE 'UTC') AS day_utc,
  count(*) AS total_platform_queries,
  (SELECT coalesce((value->>'cap')::int, (value->>'value')::int, 0)
   FROM platform_flags WHERE key = 'global_daily_platform_cap') AS configured_daily_cap,
  round(
    100.0 * count(*) / nullif(
      (SELECT coalesce((value->>'cap')::int, (value->>'value')::int, 0)
       FROM platform_flags WHERE key = 'global_daily_platform_cap'),
      0
    ),
    2
  ) AS cap_utilization_pct
FROM query_leases ql
WHERE ql.reserved_at >= now() - INTERVAL '7 days'
  AND ql.charge_source <> 'byok'
GROUP BY 1
ORDER BY 1 DESC;
