# Least-Privilege Database Role (`recsy_app`)

> **Normative reference:** Plan 25 Section 10.2 item 3, Section 16 WP-20.  
> **Security audit items resolved:** F-04, F-11, F-12.

---

## 1. Security Rationale & Threat Model

By default, Supabase connection strings use the administrative role (`postgres`), which possesses near-superuser capabilities in Postgres:

1. **RLS Bypass:** `postgres` bypasses Row Level Security policies entirely.
2. **Accidental / Malicious DDL:** An SQL injection vulnerability or application compromise could execute destructive DDL (`DROP TABLE`, `TRUNCATE`, `ALTER TABLE`).
3. **Internal Schema Exposure:** The administrative role can query sensitive system schemas, including `auth.users` (which contains hashed passwords, email addresses, and recovery tokens) and `storage.objects`.

To harden the multi-user platform for production, RECSY v2 provisions a restricted database role: `recsy_app`.
The Next.js web runtime (handling `/api/recommend`, `/api/ask`, `/api/billing/*`, etc.) connects strictly as `recsy_app`.

### Privilege Matrix

| Privilege / Action  | Admin Role (`postgres`) | Runtime Role (`recsy_app`)       |
| ------------------- | ----------------------- | -------------------------------- |
| `CONNECT`           | Granted                 | Granted                          |
| `USAGE` on public   | Granted                 | Granted                          |
| `CREATE` on public  | Granted (can DDL)       | **REVOKED (cannot DDL)**         |
| DML on public       | Full                    | `SELECT, INSERT, UPDATE, DELETE` |
| Functions in public | Owns / Can Alter        | `EXECUTE` only                   |
| `auth.*` schema     | Full                    | **REVOKED (No access)**          |
| `storage.*` schema  | Full                    | **REVOKED (No access)**          |
| `cron.*` schema     | Full                    | **REVOKED (No access)**          |
| `vault.*` schema    | Full                    | **REVOKED (No access)**          |

---

## 2. Migration Details

Role provisioning is automated via Drizzle migration `drizzle/migrations/0015_recsy_app_role.sql`:

- Idempotently creates role `recsy_app` with `LOGIN NOINHERIT`.
- Grants `USAGE` on schema `public`.
- Explicitly executes `REVOKE CREATE ON SCHEMA public FROM recsy_app;`.
- Grants `SELECT, INSERT, UPDATE, DELETE` across all existing tables in `public`.
- Grants `USAGE, SELECT` on all sequences in `public`.
- Grants `EXECUTE` on all application functions in `public` (e.g. `recsy_reserve_query`, `recsy_settle_lease`, `recsy_apply_credit_delta`).
- Configures `ALTER DEFAULT PRIVILEGES` so any future tables/sequences/functions created by migrations inherit these same access rights.
- Revokes all access on sensitive schemas (`auth`, `storage`, `cron`, `vault`, `graphql`, `realtime`).

---

## 3. Production Deployment Runbook

### Step 1: Apply Migration 0015

Run migration via the administrative connection:

```bash
pnpm db:setup
# Or via GitHub Actions workflow: db-migrate.yml
```

### Step 2: Assign Production Password

In the Supabase Dashboard -> SQL Editor (or via `psql` using admin credentials):

```sql
ALTER ROLE recsy_app WITH PASSWORD 'your-strong-random-64-character-password';
```

### Step 3: Switch Runtime Connection String in Vercel

1. Open the Vercel Project Settings -> **Environment Variables**.
2. Update `DATABASE_URL` for Production and Preview environments:
   ```env
   DATABASE_URL=postgresql://recsy_app:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
   ```
3. Retain the admin connection string in `DIRECT_URL` or CI secrets (e.g. `MIGRATION_DATABASE_URL`) for migration and catalog ingestion jobs.
4. Redeploy the application.

---

## 4. Verification & Smoke Testing

### Automated Smoke Verification

Run the database smoke test suite:

```bash
pnpm db:smoke
```

Look for:

```
[OK  ] recsy_app DDL restriction            CREATE on schema public successfully revoked
[OK  ] recsy_app table access                SELECT on application tables granted
```

### Manual Privilege Inspection

You can verify the lockdown directly in `psql`:

```sql
SET ROLE recsy_app;

-- 1. App read/write succeeds:
SELECT count(*) FROM phones;

-- 2. DDL fails with permission denied (code 42501):
CREATE TABLE evil_table (id int);
-- Output: ERROR: permission denied for schema public

-- 3. Schema tampering fails:
DROP TABLE phones;
-- Output: ERROR: must be owner of table phones

-- 4. Auth schema inspection fails:
SELECT * FROM auth.users;
-- Output: ERROR: permission denied for schema auth

RESET ROLE;
```

---

## 5. Rollback Procedure

If unexpected permission denials occur in production:

1. Revert `DATABASE_URL` in Vercel to point back to the `postgres` connection string:
   ```env
   DATABASE_URL=postgresql://postgres:<admin-password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
   ```
2. Trigger an immediate redeploy in Vercel.
3. Review `/internal/usage` and application logs to identify the table or function missing privileges for `recsy_app`.
