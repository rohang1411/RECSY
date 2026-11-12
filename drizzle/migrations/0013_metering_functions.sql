-- ---------------------------------------------------------------------------
-- Internal: undo the charge of a reserved lease. Caller holds the lease row lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recsy_undo_lease_charge(l query_leases)
RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF l.charge_source = 'daily_free' THEN
    UPDATE usage_counters SET free_used = GREATEST(free_used - 1, 0), updated_at = now()
     WHERE subject_kind = 'user' AND subject_id = l.user_id::text AND usage_date = l.usage_date;
    UPDATE usage_counters SET total_used = GREATEST(total_used - 1, 0), updated_at = now()
     WHERE subject_kind = 'device' AND subject_id = l.device_id AND usage_date = l.usage_date;
  ELSIF l.charge_source = 'anon_free' THEN
    UPDATE usage_counters SET anon_used = GREATEST(anon_used - 1, 0),
                              total_used = GREATEST(total_used - 1, 0), updated_at = now()
     WHERE subject_kind = 'device' AND subject_id = l.device_id AND usage_date = l.usage_date;
    IF l.ip_key IS NOT NULL THEN
      UPDATE usage_counters SET anon_used = GREATEST(anon_used - 1, 0), updated_at = now()
       WHERE subject_kind = 'ip' AND subject_id = l.ip_key AND usage_date = l.usage_date;
    END IF;
  ELSIF l.charge_source = 'subscription' THEN
    UPDATE subscription_usage SET used = GREATEST(used - 1, 0)
     WHERE subscription_id = (SELECT id FROM subscriptions WHERE user_id = l.user_id
                               AND current_period_start <= l.period_start ORDER BY current_period_start DESC LIMIT 1)
       AND period_start = l.period_start;
  ELSIF l.charge_source = 'credit' THEN
    PERFORM recsy_apply_credit_delta(l.user_id, 1, 'refund', 'lease', l.id::text, 'refund:' || l.id::text, '{}'::jsonb);
  ELSIF l.charge_source = 'byok' THEN
    UPDATE usage_counters SET byok_used = GREATEST(byok_used - 1, 0), updated_at = now()
     WHERE subject_kind = CASE WHEN l.user_id IS NULL THEN 'device' ELSE 'user' END
       AND subject_id = COALESCE(l.user_id::text, l.device_id) AND usage_date = l.usage_date;
  END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Credits: single entry point for every balance change (idempotent).
-- Returns (applied, balance). applied=false means the idempotency key was seen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recsy_apply_credit_delta(
  p_user_id uuid, p_delta integer, p_kind ledger_kind, p_ref_type text, p_ref_id text,
  p_idem_key text, p_metadata jsonb
) RETURNS TABLE (applied boolean, balance integer)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_bal integer; v_inserted uuid;
BEGIN
  INSERT INTO credit_wallets (user_id, balance) VALUES (p_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT w.balance INTO v_bal FROM credit_wallets w WHERE w.user_id = p_user_id FOR UPDATE;

  INSERT INTO credit_ledger (user_id, delta, balance_after, kind, ref_type, ref_id, idempotency_key, metadata)
  VALUES (p_user_id, p_delta, v_bal + p_delta, p_kind, p_ref_type, p_ref_id, p_idem_key, COALESCE(p_metadata,'{}'::jsonb))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN QUERY SELECT false, v_bal;
    RETURN;
  END IF;
  UPDATE credit_wallets SET balance = v_bal + p_delta, updated_at = now() WHERE user_id = p_user_id;
  RETURN QUERY SELECT true, v_bal + p_delta;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reserve one query. One round trip, atomic, serialised per subject.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recsy_reserve_query(
  p_user_id          uuid,
  p_device_id        text,
  p_ip_key           text,
  p_request_id       uuid,
  p_route            text,
  p_trace_id         text,
  p_byok             boolean,
  p_free_allowance   integer,
  p_anon_allowance   integer,
  p_anon_ip_cap      integer,
  p_device_user_cap  integer,
  p_byok_daily_cap   integer,
  p_max_inflight     integer,
  p_lease_ttl_secs   integer,
  p_shed_free        boolean DEFAULT false   -- admission control: platform-funded free sources are paused
) RETURNS TABLE (
  allowed boolean, lease_id uuid, charge_source charge_source, reason text,
  free_remaining integer, credit_balance integer, sub_remaining integer, reset_at timestamptz
) LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_reset      timestamptz := ((v_today + 1)::timestamp AT TIME ZONE 'UTC');
  v_subject    text := COALESCE(p_user_id::text, p_device_id);
  v_lease      uuid;
  v_inflight   integer;
  v_used       integer;
  v_sub        record;
  v_sub_used   integer;
  v_applied    boolean;
  v_balance    integer := 0;
  v_dev_users  integer;
  v_dup        record;
  v_capped     boolean := false;
  v_sub_full   boolean := false;
BEGIN
  -- Serialise all reservations for this subject (transaction-scoped; pooler-safe).
  PERFORM pg_advisory_xact_lock(hashtextextended('recsy:reserve:' || v_subject, 0));

  -- Duplicate request id (client retry / double submit).
  SELECT q.id, q.status INTO v_dup FROM query_leases q WHERE q.device_id = p_device_id AND q.request_id = p_request_id;
  IF FOUND THEN
    RETURN QUERY SELECT false, v_dup.id, NULL::charge_source, 'DUPLICATE_REQUEST'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;

  -- Lazily expire this subject's stale leases (refund) so a crashed function never strands quota.
  FOR v_lease IN
    SELECT q.id FROM query_leases q
     WHERE q.status = 'reserved' AND q.expires_at < now()
       AND ((p_user_id IS NOT NULL AND q.user_id = p_user_id) OR q.device_id = p_device_id)
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM recsy_settle_lease(v_lease, 'expire', 'lease_expired');
  END LOOP;

  -- Concurrency cap per subject (not a money limit; protects LLM budget and fairness).
  SELECT count(*) INTO v_inflight FROM query_leases q
   WHERE q.status = 'reserved' AND q.expires_at >= now()
     AND ((p_user_id IS NOT NULL AND q.user_id = p_user_id) OR (p_user_id IS NULL AND q.device_id = p_device_id));
  IF v_inflight >= p_max_inflight THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'TOO_MANY_INFLIGHT'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;

  v_lease := gen_random_uuid();

  -- ---------------------------------------------------------------- BYOK
  IF p_byok THEN
    IF p_byok_daily_cap <= 0 THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'BYOK_DAILY_CAP'::text, 0, 0, 0, v_reset;
      RETURN;
    END IF;
    INSERT INTO usage_counters (subject_kind, subject_id, usage_date, byok_used)
    VALUES (CASE WHEN p_user_id IS NULL THEN 'device' ELSE 'user' END, v_subject, v_today, 1)
    ON CONFLICT (subject_kind, subject_id, usage_date)
    DO UPDATE SET byok_used = usage_counters.byok_used + 1, updated_at = now()
      WHERE usage_counters.byok_used < p_byok_daily_cap
    RETURNING byok_used INTO v_used;
    IF v_used IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'BYOK_DAILY_CAP'::text, 0, 0, 0, v_reset;
      RETURN;
    END IF;
    INSERT INTO query_leases (id, request_id, user_id, device_id, ip_key, route, charge_source, usage_date, expires_at, trace_id)
    VALUES (v_lease, p_request_id, p_user_id, p_device_id, p_ip_key, p_route, 'byok', v_today, now() + make_interval(secs => p_lease_ttl_secs), p_trace_id);
    RETURN QUERY SELECT true, v_lease, 'byok'::charge_source, 'BYOK'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;

  -- ---------------------------------------------------------- authenticated
  IF p_user_id IS NOT NULL THEN
    -- 1) daily free allowance (atomic conditional increment).
    --    NB: the WHERE guard only protects the UPDATE branch; a fresh INSERT always writes 1,
    --    so allowance <= 0 must be handled explicitly.
    IF p_free_allowance > 0 AND NOT p_shed_free THEN
      INSERT INTO usage_counters (subject_kind, subject_id, usage_date, free_used)
      VALUES ('user', v_subject, v_today, 1)
      ON CONFLICT (subject_kind, subject_id, usage_date)
      DO UPDATE SET free_used = usage_counters.free_used + 1, updated_at = now()
        WHERE usage_counters.free_used < p_free_allowance
      RETURNING free_used INTO v_used;
    END IF;

    IF v_used IS NOT NULL THEN
      -- Device-level anti-farming: how many distinct accounts burned free quota on this device today.
      IF v_used = 1 THEN
        INSERT INTO usage_counters (subject_kind, subject_id, usage_date, users_seen, total_used)
        VALUES ('device', p_device_id, v_today, 1, 1)
        ON CONFLICT (subject_kind, subject_id, usage_date)
        DO UPDATE SET users_seen = usage_counters.users_seen + 1, total_used = usage_counters.total_used + 1, updated_at = now()
        RETURNING users_seen INTO v_dev_users;
        IF v_dev_users > p_device_user_cap THEN
          -- Roll back this free consumption; fall through to paid sources only.
          UPDATE usage_counters SET free_used = free_used - 1
           WHERE subject_kind = 'user' AND subject_id = v_subject AND usage_date = v_today;
          UPDATE usage_counters SET users_seen = users_seen - 1, total_used = total_used - 1
           WHERE subject_kind = 'device' AND subject_id = p_device_id AND usage_date = v_today;
          v_used := NULL;
          v_capped := true;
        END IF;
      ELSE
        INSERT INTO usage_counters (subject_kind, subject_id, usage_date, total_used)
        VALUES ('device', p_device_id, v_today, 1)
        ON CONFLICT (subject_kind, subject_id, usage_date)
        DO UPDATE SET total_used = usage_counters.total_used + 1, updated_at = now();
      END IF;
    END IF;

    IF v_used IS NOT NULL THEN
      INSERT INTO query_leases (id, request_id, user_id, device_id, ip_key, route, charge_source, usage_date, expires_at, trace_id)
      VALUES (v_lease, p_request_id, p_user_id, p_device_id, p_ip_key, p_route, 'daily_free', v_today, now() + make_interval(secs => p_lease_ttl_secs), p_trace_id);
      RETURN QUERY SELECT true, v_lease, 'daily_free'::charge_source, 'DAILY_FREE'::text,
                          GREATEST(p_free_allowance - v_used, 0), 0, 0, v_reset;
      RETURN;
    END IF;

    -- 2) subscription allowance (atomic conditional increment per billing period)
    SELECT s.id, s.included_queries, s.current_period_start INTO v_sub
      FROM subscriptions s
     WHERE s.user_id = p_user_id AND s.entitled_until > now()
     ORDER BY s.entitled_until DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO subscription_usage (subscription_id, period_start, used)
      VALUES (v_sub.id, v_sub.current_period_start, 1)
      ON CONFLICT (subscription_id, period_start)
      DO UPDATE SET used = subscription_usage.used + 1 WHERE subscription_usage.used < v_sub.included_queries
      RETURNING used INTO v_sub_used;
      IF v_sub_used IS NOT NULL THEN
        INSERT INTO query_leases (id, request_id, user_id, device_id, ip_key, route, charge_source, usage_date, period_start, expires_at, trace_id)
        VALUES (v_lease, p_request_id, p_user_id, p_device_id, p_ip_key, p_route, 'subscription', v_today, v_sub.current_period_start, now() + make_interval(secs => p_lease_ttl_secs), p_trace_id);
        RETURN QUERY SELECT true, v_lease, 'subscription'::charge_source, 'SUBSCRIPTION'::text,
                            0, 0, GREATEST(v_sub.included_queries - v_sub_used, 0), v_reset;
        RETURN;
      END IF;
      v_sub_full := true;
    END IF;

    -- 3) purchased credits
    SELECT w.balance INTO v_balance FROM credit_wallets w WHERE w.user_id = p_user_id FOR UPDATE;
    IF FOUND AND v_balance > 0 THEN
      SELECT a.applied, a.balance INTO v_applied, v_balance
        FROM recsy_apply_credit_delta(p_user_id, -1, 'consume', 'lease', v_lease::text, 'consume:' || v_lease::text, '{}'::jsonb) a;
      INSERT INTO query_leases (id, request_id, user_id, device_id, ip_key, route, charge_source, usage_date, expires_at, trace_id)
      VALUES (v_lease, p_request_id, p_user_id, p_device_id, p_ip_key, p_route, 'credit', v_today, now() + make_interval(secs => p_lease_ttl_secs), p_trace_id);
      RETURN QUERY SELECT true, v_lease, 'credit'::charge_source, 'CREDIT'::text, 0, v_balance, 0, v_reset;
      RETURN;
    END IF;

    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source,
      (CASE WHEN v_sub_full THEN 'SUBSCRIPTION_EXHAUSTED' WHEN v_capped THEN 'DEVICE_ACCOUNT_CAP' WHEN p_shed_free THEN 'CAPACITY_BUSY' ELSE 'QUOTA_EXHAUSTED' END)::text,
      0, COALESCE(v_balance,0), 0, v_reset;
    RETURN;
  END IF;

  -- -------------------------------------------------------------- anonymous
  -- Per-IP-prefix soft cap first (wide: survives CGNAT), then the per-device hard cap.
  IF p_shed_free THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'CAPACITY_BUSY'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;
  IF p_anon_allowance <= 0 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'SIGNIN_REQUIRED'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;
  IF p_ip_key IS NOT NULL AND p_anon_ip_cap <= 0 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'ANON_IP_CAP'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;
  IF p_ip_key IS NOT NULL THEN
    INSERT INTO usage_counters (subject_kind, subject_id, usage_date, anon_used)
    VALUES ('ip', p_ip_key, v_today, 1)
    ON CONFLICT (subject_kind, subject_id, usage_date)
    DO UPDATE SET anon_used = usage_counters.anon_used + 1, updated_at = now()
      WHERE usage_counters.anon_used < p_anon_ip_cap
    RETURNING anon_used INTO v_used;
    IF v_used IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'ANON_IP_CAP'::text, 0, 0, 0, v_reset;
      RETURN;
    END IF;
  END IF;

  INSERT INTO usage_counters (subject_kind, subject_id, usage_date, anon_used, total_used)
  VALUES ('device', p_device_id, v_today, 1, 1)
  ON CONFLICT (subject_kind, subject_id, usage_date)
  DO UPDATE SET anon_used = usage_counters.anon_used + 1, total_used = usage_counters.total_used + 1, updated_at = now()
    WHERE usage_counters.total_used < p_anon_allowance
  RETURNING total_used INTO v_used;

  IF v_used IS NULL THEN
    IF p_ip_key IS NOT NULL THEN  -- give back the IP slot we just took
      UPDATE usage_counters SET anon_used = GREATEST(anon_used - 1, 0)
       WHERE subject_kind = 'ip' AND subject_id = p_ip_key AND usage_date = v_today;
    END IF;
    RETURN QUERY SELECT false, NULL::uuid, NULL::charge_source, 'ANON_QUOTA_EXHAUSTED'::text, 0, 0, 0, v_reset;
    RETURN;
  END IF;

  INSERT INTO query_leases (id, request_id, user_id, device_id, ip_key, route, charge_source, usage_date, expires_at, trace_id)
  VALUES (v_lease, p_request_id, NULL, p_device_id, p_ip_key, p_route, 'anon_free', v_today, now() + make_interval(secs => p_lease_ttl_secs), p_trace_id);
  RETURN QUERY SELECT true, v_lease, 'anon_free'::charge_source, 'ANON_FREE'::text,
                      GREATEST(p_anon_allowance - v_used, 0), 0, 0, v_reset;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Settle a lease. outcome: 'commit' | 'refund' | 'no_charge' | 'expire'
-- Idempotent: settling a non-reserved lease returns its current status unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recsy_settle_lease(
  p_lease_id uuid, p_outcome text, p_reason text DEFAULT NULL,
  p_model text DEFAULT NULL, p_tokens_in integer DEFAULT NULL, p_tokens_out integer DEFAULT NULL,
  p_latency_ms integer DEFAULT NULL, p_cache_hit boolean DEFAULT NULL, p_cost_micros integer DEFAULT NULL,
  p_clarify_free_cap integer DEFAULT 10
) RETURNS lease_status LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE l query_leases; v_new lease_status; v_clarify integer; v_kind text; v_sid text;
BEGIN
  SELECT * INTO l FROM query_leases WHERE id = p_lease_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF l.status <> 'reserved' THEN RETURN l.status; END IF;

  IF p_outcome = 'commit' THEN
    v_new := 'committed';
  ELSIF p_outcome = 'no_charge' THEN
    v_kind := CASE WHEN l.user_id IS NULL THEN 'device' ELSE 'user' END;
    v_sid  := COALESCE(l.user_id::text, l.device_id);
    INSERT INTO usage_counters (subject_kind, subject_id, usage_date, clarify_used)
    VALUES (v_kind, v_sid, l.usage_date, 1)
    ON CONFLICT (subject_kind, subject_id, usage_date)
    DO UPDATE SET clarify_used = usage_counters.clarify_used + 1, updated_at = now()
    RETURNING clarify_used INTO v_clarify;
    IF v_clarify > p_clarify_free_cap THEN
      v_new := 'committed';              -- clarify spam beyond the free cap is charged
    ELSE
      PERFORM recsy_undo_lease_charge(l);
      v_new := 'no_charge';
    END IF;
  ELSIF p_outcome = 'refund' THEN
    PERFORM recsy_undo_lease_charge(l);
    v_new := 'refunded';
  ELSIF p_outcome = 'expire' THEN
    PERFORM recsy_undo_lease_charge(l);
    v_new := 'expired';
  ELSE
    RAISE EXCEPTION 'unknown outcome %', p_outcome;
  END IF;

  UPDATE query_leases SET status = v_new, settled_at = now(), settle_reason = p_reason,
         model = COALESCE(p_model, model), tokens_in = COALESCE(p_tokens_in, tokens_in),
         tokens_out = COALESCE(p_tokens_out, tokens_out), latency_ms = COALESCE(p_latency_ms, latency_ms),
         cache_hit = COALESCE(p_cache_hit, cache_hit), cost_micros = COALESCE(p_cost_micros, cost_micros)
   WHERE id = p_lease_id;
  RETURN v_new;
END $$;
--> statement-breakpoint

-- Batch sweeper for cron (pg_cron / GitHub Action / opportunistic).
CREATE OR REPLACE FUNCTION recsy_sweep_expired_leases(p_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM query_leases WHERE status = 'reserved' AND expires_at < now()
           ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM recsy_settle_lease(r.id, 'expire', 'lease_expired');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint

-- Anonymous -> account graduation: carry today's anonymous usage onto the user (never reset, never double).
CREATE OR REPLACE FUNCTION recsy_link_device_to_user(p_user_id uuid, p_device_id text)
RETURNS integer LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v_today date := (now() AT TIME ZONE 'UTC')::date; v_anon integer; v_free integer;
BEGIN
  SELECT anon_used INTO v_anon FROM usage_counters
   WHERE subject_kind = 'device' AND subject_id = p_device_id AND usage_date = v_today;
  v_anon := COALESCE(v_anon, 0);
  INSERT INTO usage_counters (subject_kind, subject_id, usage_date, free_used)
  VALUES ('user', p_user_id::text, v_today, v_anon)
  ON CONFLICT (subject_kind, subject_id, usage_date)
  DO UPDATE SET free_used = GREATEST(usage_counters.free_used, EXCLUDED.free_used), updated_at = now()
  RETURNING free_used INTO v_free;
  RETURN v_free;
END $$;
--> statement-breakpoint

-- Lock the functions down. REVOKE ... FROM PUBLIC is not enough on Supabase: its default
-- privileges grant EXECUTE on new public functions directly to anon/authenticated/service_role,
-- which would expose these functions through PostgREST /rpc with the public anon key.
DO $$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'recsy_apply_credit_delta(uuid,integer,ledger_kind,text,text,text,jsonb)',
    'recsy_reserve_query(uuid,text,text,uuid,text,text,boolean,integer,integer,integer,integer,integer,integer,integer,boolean)',
    'recsy_settle_lease(uuid,text,text,text,integer,integer,integer,boolean,integer,integer)',
    'recsy_sweep_expired_leases(integer)',
    'recsy_link_device_to_user(uuid,text)',
    'recsy_undo_lease_charge(query_leases)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint

-- Seed platform_flags
INSERT INTO "platform_flags" ("key","value") VALUES
  ('kill_switch',            '{"enabled": false, "message": null}'::jsonb),
  ('signups_open',           '{"enabled": true}'::jsonb),
  ('paid_checkout_enabled',  '{"enabled": false}'::jsonb),
  ('global_daily_platform_cap', '{"value": 0}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
