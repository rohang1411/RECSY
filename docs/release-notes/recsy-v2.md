# RECSY v2 Release Notes

## Version 2.0.0 — Multi-User Platform, Quotas, Billing & Artful Editorial Experience

**Release Date:** April 2026  
**Milestone:** Production Multi-User Transformation (Plan 25)

---

### Overview

RECSY v2 evolves the honest smartphone recommendation engine from a single-user prototype into a hardened, high-concurrency, multi-user production platform. The platform introduces cryptographic device identity, server-side authentication, atomic fair-use quota metering, Stripe-powered hosted billing, robust privacy and security controls, and a bespoke Swiss/technical editorial UI.

---

### Key Architectural Deliverables

#### 1. Identity & Multi-User Architecture

- **Cryptographic Device Tokens:** Minted via `__Host-recsy_did` with HMAC-SHA256 signatures, isolating anonymous users with 2 free daily queries without requiring sign-in.
- **Server-Side Authentication:** Supabase SSR with magic-link OTP, PKCE Google OAuth, and corporate email scanner prefetch protection.
- **Anonymous-to-Account Graduation:** Smoothly claims anonymous session turns, chat history, and device quotas upon first user login.
- **Account Lifecycle & GDPR Compliance:** Self-service machine-readable JSON data export (`POST /api/account/export`) and 30-day cooling-off account deletion (`POST /api/account/delete`).

#### 2. Atomic Metering & Fair-Use Engine

- **PostgreSQL Row-Level Concurrency:** Atomic `recsy_reserve_query`, `recsy_commit_query`, `recsy_refund_query`, and `recsy_sweep_expired_leases` functions executing in `< 3ms`.
- **Stream-Aware Quota Settlement:** Quota reservation happens before stream establishment on `/api/ask` and `/api/recommend`. Network disconnects or client aborts automatically refund or mark uncharged.
- **Strict BYOK Isolation:** Bring Your Own Key queries route strictly to user-configured third-party providers with zero platform pool fallback, preventing platform key leakage.

#### 3. Billing & Monetization

- **Provider-Agnostic Billing Service:** Official Stripe hosted checkout and customer portal integrations with an in-memory test provider for deterministic CI/CD testing.
- **Catalog:**
  - _Pack S:_ 25 queries ($3.00, never expires)
  - _Pack M:_ 100 queries ($9.00, never expires)
  - _Pro Monthly:_ 150 queries/month ($9.99/mo, deep reasoning mode, cross-device history)
- **Webhook Inbox & Reconciliation:** Idempotent event inbox preventing duplicate credits, paired with an automated 30-minute background sweeper reconciling dropped webhooks.

#### 4. Web Application Security & Hardening

- **Content Security Policy (CSP):** Phase 1 Report-Only CSP configured with violation telemetry routed to `/api/csp-report`.
- **CSRF & Origin Verification:** Strict `assertSameOrigin` assertion across all mutating `/api` and `/auth` routes, allowing only verified same-origin requests while defending ambient credentials.
- **Open-Redirect Neutralization:** Exhaustive open-redirect corpus testing on `safeReturnTo`, neutralizing protocol-relative (`//evil.com`), mixed backslash (`/\evil.com`), and encoded bypasses.
- **Log Redaction:** Automated Pino redaction covering API keys, auth cookies, BYOK tokens, Stripe signatures, Turnstile responses, and PII. Plaintext emails are anonymized to salted 8-character hex digests (`emailRef`).
- **IDOR Defence:** Complete database queries enforce identity checks (`user_id = :id OR client_token = :token`), forbidding access by unvalidated resource IDs.

#### 5. Legal & Regulatory Compliance

- **Legal Surfaces:** Dedicated editorial pages for `/terms`, `/privacy`, `/refunds`, and `/contact`.
- **Automated Placeholder Gate:** Strict build verification script (`scripts/check-legal-placeholders.ts`) ensuring `LEGAL_PLACEHOLDER` tokens block production builds when billing is enabled.
- **Search Engine Directives:** Clean `robots.ts` disallowing authenticated and internal segments (`/account`, `/login`, `/auth/`, `/api/`), with `/pricing` and legal pages added to `sitemap.ts` and marked with canonical tags.

#### 6. Artful Technical Editorial UI

- **Strict 0px Border-Radius Token:** Complete consistency with `--radius: 0px` across buttons, inputs, dialog sheets, cards, and meters.
- **Zero CLS HUD:** Inline composer quota meter, tabular countdown clock, and segmented subscriber rails with polite screen-reader accessibility announcements.
- **Technical Dialog Primitives:** Native accessible `<dialog>` sheet drawers, underline-style input fields, hairline callouts, and scan-beam skeletons.

---

### Verification & Quality Gates

- **Unit & Integration Suite:** 100% passing across 140+ test files and 850+ individual tests.
- **Database Concurrency Suite:** 50 parallel worker tests confirming zero over-admission on free quotas.
- **Bundle Budget Guard:** 0 `@supabase/*` or `stripe` imports in client browser bundles.
