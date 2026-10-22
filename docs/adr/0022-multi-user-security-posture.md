# ADR 0022: Multi-User Security Posture and Least-Privilege Access

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** Engineering & Product
- **Consulted:** Plan 25 Architecture Review

---

## Context

Operating a multi-user platform with LLM inference, user authentication, and financial billing introduces serious security requirements:

1. Direct database access from browser clients (e.g. Supabase PostgREST Data API) presents a broad attack surface.
2. In typical Supabase setups, backend connections use the superuser-like `postgres` role, bypassing RLS and allowing unrestricted DDL or data queries across internal schemas.
3. User BYOK (Bring Your Own Key) secrets must never leak to server logs, platform providers, or third parties.
4. Defense-in-depth against Cross-Site Scripting (XSS), Cross-Site Request Forgery (CSRF), and open redirects.

---

## Decision

We establish a comprehensive defense-in-depth security architecture:

1. **Server-Only Data Access & PostgREST Lockdown:**
   - The browser never communicates directly with the database.
   - Supabase PostgREST Data API is disabled in production.
   - All tables enforce Row Level Security (`ENABLE ROW LEVEL SECURITY`) with default-deny policies, and all `SELECT, INSERT, UPDATE, DELETE` privileges are explicitly revoked from `anon` and `authenticated` roles.
   - `EXECUTE` privileges on all `recsy_*` SQL functions are explicitly revoked from public roles.

2. **Least-Privilege Database Role (`recsy_app`):**
   - Migration `0015_recsy_app_role.sql` provisions a restricted runtime role `recsy_app` with `LOGIN NOINHERIT`.
   - `recsy_app` is granted DML (`SELECT, INSERT, UPDATE, DELETE`) on `public` tables and `EXECUTE` on functions.
   - DDL privileges are revoked (`REVOKE CREATE ON SCHEMA public FROM recsy_app`). The application cannot create, alter, or drop tables or functions.
   - Access to internal schemas (`auth`, `storage`, `cron`, `vault`) is completely revoked.

3. **BYOK Security & Platform Isolation:**
   - Client API keys (`x-recsy-user-key`) are stored strictly in browser `localStorage`, never persisted in the database.
   - Requests with BYOK keys are executed strictly against the user's provider without fallback to platform API keys.
   - Request and response loggers redact sensitive authorization headers and API keys.

4. **Web Security Headers & CSP:**
   - Strict Content Security Policy (staged from Report-Only with `/api/csp-report` to Enforced).
   - Clickjacking prevention via `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
   - Cross-Origin isolation (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`).
   - Anti-CSRF verification (`assertSameOrigin`) on all mutating endpoints.

---

## Consequences

### Positive

- **Blast Radius Reduction:** Even in the event of an SQL injection in application logic, an attacker cannot modify database schemas, read password hashes from `auth.users`, or alter metering functions.
- **Privacy Compliance:** User BYOK keys are cryptographically isolated and never stored.
- **Enterprise Grade Posture:** Passes standard OWASP baseline checks.

### Trade-offs / Mitigations

- **Operational Discipline:** Database schema migrations must run using administrative credentials (`postgres`) separate from application runtime credentials (`recsy_app`). Documented in `docs/deployment/least-privilege-db-role.md`.
