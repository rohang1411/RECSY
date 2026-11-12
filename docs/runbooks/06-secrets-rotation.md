# Runbook 06: Secrets Rotation

**Scope:** Key Rotation & Zero-Downtime Secret Replacement
**Normative Reference:** Plan 25 Section 11.7.6, 10.7, 17.2.

---

### 1. Symptoms

- Scheduled periodic rotation (quarterly) or emergency credential leak response.
- Suspected compromise of API keys, webhook signing secrets, or HMAC keys.

### 2. Check

Determine which secret category requires rotation:

1. `DEVICE_ID_SECRET` / `IP_SALT_SECRET` (Anonymous hashing salts)
2. `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (Billing)
3. `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` (Auth & DB)
4. `INTERNAL_OPERATOR_TOKEN` (Operator dashboard)
5. `TURNSTILE_SECRET_KEY` (Cloudflare anti-abuse)

### 3. Action (Order of Operations)

1. **Device & IP Salts (`DEVICE_ID_SECRET`, `IP_SALT_SECRET`):**
   - Rotating will reset device daily free tracking for anonymous users. Perform rotation at UTC 00:00:00 to minimize impact.
   - Update Vercel environment variables → Redeploy.
2. **Stripe Webhook Secret (`STRIPE_WEBHOOK_SECRET`):**
   - In Stripe Dashboard → Add new webhook endpoint destination OR roll secret with grace period.
   - Update `STRIPE_WEBHOOK_SECRET` in Vercel → Redeploy.
3. **Internal Operator Token (`INTERNAL_OPERATOR_TOKEN`):**
   - Generate high-entropy 32-byte secret: `openssl rand -hex 32`.
   - Update Vercel environment variables → Redeploy. Existing operator sessions expire immediately.
4. **LLM API Keys (`GEMINI_API_KEY`, etc.):**
   - Create new key in Google Cloud Console.
   - Add new key to Vercel env, test with `pnpm eval:check`.
   - Delete old key in Google Cloud Console.

### 4. Verify

1. Verify `/api/health` returns healthy.
2. Submit a test query on `/recommend` and verify lease reservation succeeds.
3. Trigger a test webhook from Stripe Dashboard and ensure HTTP 200.

### 5. Follow-up

- Log rotation date and operator in internal compliance records.
