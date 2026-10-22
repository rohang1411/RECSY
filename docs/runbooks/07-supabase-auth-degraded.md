# Runbook 07: Supabase Auth Degraded

**Scope:** Authentication Failure & OTP Delivery Outages
**Normative Reference:** Plan 25 Section 11.7.7, 8.7, 13.4.

---

### 1. Symptoms

- Alert `auth_unavailable` fires (> 5 `AUTH_UNAVAILABLE` in 5 minutes).
- Sign-in or OTP requests fail with HTTP 503 `AUTH_UNAVAILABLE`.
- Email delivery providers reporting high bounce/drop rates on OTP delivery.

### 2. Check

1. Check Supabase status page (`status.supabase.com`) for active outages.
2. Inspect application error logs:
   ```bash
   # Filter for auth error codes
   grep "auth_otp_failed" app.log
   ```
3. Test Supabase connection directly:
   ```bash
   pnpm db:ping
   ```

### 3. Action

1. If Supabase Auth is down or degraded, RECSY routes gracefully return:
   - HTTP 503 with error code `AUTH_UNAVAILABLE`
   - Quota HUD and Auth Sheet render calm retry states ("Authentication temporarily degraded; existing sessions remain active").
2. Anonymous queries continue to be served if `QUOTA_MODE=enforce` and DB is up.
3. If SMTP provider (Resend / SendGrid) is down, verify custom SMTP credentials in Supabase project settings.

### 4. Verify

1. Once upstream service recovers, submit a test OTP verification flow on `/login`.
2. Ensure `AUTH_UNAVAILABLE` alert resolves.

### 5. Follow-up

- Communicate downtime to affected users if outage exceeded 1 hour.
