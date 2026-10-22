# Runbook 08: Abuse Wave

**Scope:** Sybil Attacks, Automated Botnets & Scraping Mitigation
**Normative Reference:** Plan 25 Section 11.7.8, 10.3, 13.4.

---

### 1. Symptoms

- Alert `anon_ip_spike` (> 50 `ANON_IP_CAP` denials in 10 minutes) or `accounts_per_device` fires.
- Cloudflare Turnstile token failure rate surges.
- Unusual high volume of unique devices originating from same cloud hosting ASN / IP ranges.

### 2. Check

1. Inspect abusive IP prefixes in `/internal/usage`.
2. Run abuse detection script:
   ```bash
   pnpm abuse:detect
   ```
3. Inspect `usage_counters` for devices with excessive unique users:
   ```sql
   SELECT subject_id, users_seen, queries_used
   FROM usage_counters
   WHERE subject_kind = 'device'
     AND usage_date = (now() AT TIME ZONE 'UTC')::date
     AND users_seen > 3;
   ```

### 3. Action

1. **Block abusive device or IP key:**
   - Go to `/internal/usage` → **Add Abuse Block**.
   - Input IP key or device fingerprint with 72h TTL.
2. **Tighten Turnstile verification:**
   - If bots are bypassing Turnstile, adjust risk-flagged threshold in `turnstile.ts` or set challenge mode to "Always" in Cloudflare dashboard.
3. **If automated account creation is detected:**
   - Temporarily set `signups_enabled` to `false` in `/internal/usage` with reason.

### 4. Verify

1. Verify abusive queries drop immediately with `403 ACCOUNT_RESTRICTED` or `429 RATE_LIMITED`.
2. Confirm legitimate traffic from normal browsers proceeds without hindrance.

### 5. Follow-up

- Add cloud hosting IP ranges (AWS, DigitalOcean, Hetzner) to blocklist if headless scrapers continue.
