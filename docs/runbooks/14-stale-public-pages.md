# Runbook 14: Stale Public Pages & On-Demand Cache Revalidation

> **Scope:** Public Data Cache (`unstable_cache`), ISR Pages (`/p/[slug]`, `/browse`), `/api/internal/revalidate`  
> **Audience:** Operators, release engineers, catalog curators  
> **Trigger:** Device catalog or scorecard updates not reflecting on public pages

---

## 1. Symptoms

- **User / Operator Report:** A smartphone's specs, pricing, or aspect scorecards were promoted/updated in the database, but the public page (`/p/[slug]`) or `/browse` still serves stale data.
- **Automated Ingestion Warning:** Ingestion logs display `revalidate_failed` or `REVALIDATE_URL unset; skipping revalidation`.

---

## 2. Check

### 2.1 Check Database Freshness

Verify that the database row actually contains the updated data:

```sql
SELECT id, name, slug, updated_at
FROM phones
WHERE slug = 'google-pixel-9-pro';
```

### 2.2 Verify Current Response

Fetch the public page headers to inspect the cache age:

```bash
curl -I https://recsy.app/p/google-pixel-9-pro
```

Look for:

- `x-vercel-cache: HIT` / `STALE`
- `Age: <seconds>`

If `Age` exceeds 600s (10 minutes) and content is still old, Next.js background revalidation is stuck or tags are stale.

---

## 3. Action

### 3.1 Step 1: Execute HMAC-Signed On-Demand Revalidation

The endpoint `POST /api/internal/revalidate` requires an HMAC-SHA256 signature generated with `REVALIDATE_SECRET` within a 300-second timestamp window.

Run this one-line Node.js command from a machine with access to `REVALIDATE_SECRET`:

```bash
node -e "
const crypto = require('crypto');
const secret = process.env.REVALIDATE_SECRET;
if (!secret) throw new Error('REVALIDATE_SECRET not set');
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ tags: ['phones', 'scorecards'] });
const hmac = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');

fetch('https://recsy.app/api/internal/revalidate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-revalidate-timestamp': String(timestamp),
    'x-revalidate-signature': hmac
  },
  body
}).then(r => r.json()).then(console.log).catch(console.error);
"
```

Expected Response:

```json
{
  "revalidated": true,
  "tags": ["phones", "scorecards"],
  "revalidatedAt": "2026-10-24T21:00:00.000Z"
}
```

### 3.2 Step 2: Individual Phone Revalidation

If only a single phone is affected, target its tag specifically:

```bash
node -e "
const crypto = require('crypto');
const secret = process.env.REVALIDATE_SECRET;
const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ tags: ['phone:google-pixel-9-pro'] });
const hmac = crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');

fetch('https://recsy.app/api/internal/revalidate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-revalidate-timestamp': String(timestamp),
    'x-revalidate-signature': hmac
  },
  body
}).then(r => r.json()).then(console.log).catch(console.error);
"
```

---

## 4. Verify

1. **Re-fetch the public page:**
   ```bash
   curl -s https://recsy.app/p/google-pixel-9-pro | grep -i "updated spec term"
   ```
2. **Inspect headers:**
   Confirm `x-vercel-cache: REVALIDATED` or a fresh `Age: 0`.

---

## 5. Follow-up

1. If the automatic revalidation failed during CI/ingestion promotion:
   - Check GitHub Actions secrets: Ensure `REVALIDATE_SECRET` and `REVALIDATE_URL` are configured in repository secrets.
   - Check Vercel environment variables: Ensure `REVALIDATE_SECRET` is present in Production and Preview environments.
2. Remember: All cached data modules (`catalog-cache`, `public-data`) have hard TTLs (300s to 600s), meaning even if webhook delivery completely fails, caches self-heal within 10 minutes.
