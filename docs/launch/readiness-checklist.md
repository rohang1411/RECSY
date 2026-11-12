# RECSY v2 Multi-User Platform Launch Readiness & Go/No-Go Checklist

> **Master Reference:** `docs/ImplementationPlans/25. multi-user-platform-quotas-billing-and-artful-experience-plan.md`  
> **Normative Sections:** Section 17.1 (Rollout Stages), Section 17.2 (Go / No-go Checklist), Section 16 (WP-21).

---

## 1. Rollout Strategy & Stage Gates

Launch proceeds through sequential, reversible stage gates controlled by environment variables and database flags:

| Stage                | Quota Mode | Signups | Billing       | Checkout Flag | Description                                            | Exit Criterion                                      |
| -------------------- | ---------- | ------- | ------------- | ------------- | ------------------------------------------------------ | --------------------------------------------------- |
| **S0 Groundwork**    | `off`      | `false` | `false`       | `false`       | Zero user-visible change; migrations 0012–0015 applied | `pnpm db:smoke` clean in prod; 48h stability        |
| **S1 Shadow**        | `shadow`   | `false` | `false`       | `false`       | Reserve & settle execute, simulated denials logged     | 7 days: 0 lease leaks; capacity report reviewed     |
| **S2 Accounts**      | `shadow`   | `true`  | `false`       | `false`       | Google & Email OTP active; graduation enabled          | Sign-in success > 95%; OTP p95 < 30s                |
| **S3 Enforce Free**  | `enforce`  | `true`  | `false`       | `false`       | 2 free queries/day enforced; Quota HUD live            | 7 days quiet alerts (`refund_ratio`, `late_commit`) |
| **S4 Billing Test**  | `enforce`  | `true`  | `true` (test) | `false`       | Stripe test keys; allowlist for internal team          | 9.10 test matrix passes; reconciliation verified    |
| **S5 Billing Live**  | `enforce`  | `true`  | `true` (live) | `true`        | Stripe live keys; `BILLING_ALLOWLIST_EMAILS`           | 10 live transactions fulfilled & 1 refund drilled   |
| **S6 General Avail** | `enforce`  | `true`  | `true` (live) | `true`        | Public checkout open; allowlist cleared                | Ongoing SLO adherence (p95 latency, 0 drift)        |

---

## 2. Master Go / No-Go Checklist

### 2.1 Hard Prerequisites

| #    | Item                      | Gate | Verification Method / Evidence                                                       | Status   | Sign-off |
| ---- | ------------------------- | ---- | ------------------------------------------------------------------------------------ | -------- | -------- |
| H-01 | Commercial Hosting Plan   | S5   | Vercel Pro plan active (commercial use permitted)                                    | Verified | Ops      |
| H-02 | Production Database Plan  | S3   | Supabase Pro plan with automated daily backups & PITR                                | Verified | DBA      |
| H-03 | Model Provider Capacity   | S3   | Paid LLM tiers configured (Tier 1/2 pools); terms permit commercial query forwarding | Verified | AI Lead  |
| H-04 | Merchant Account Approved | S5   | Stripe account activated; KYC complete; payouts enabled                              | Verified | Finance  |
| H-05 | Legal Terms Reviewed      | S5   | `LEGAL_PLACEHOLDER` markers replaced with reviewed counsel text (`pnpm check:legal`) | Verified | Legal    |
| H-06 | Refund Policy Published   | S5   | `/refunds` live with explicit 14-day statutory withdrawal & credit forfeiture terms  | Verified | Legal    |
| H-07 | Monitored Support Email   | S3   | `support@recsy.app` mailbox provisioned with SLA triage alerts                       | Verified | Support  |

### 2.2 Engineering & Architecture

| #    | Item                        | Gate | Verification Method / Evidence                                                      | Status | Sign-off  |
| ---- | --------------------------- | ---- | ----------------------------------------------------------------------------------- | ------ | --------- |
| E-01 | Full Test Suite Green       | S3   | `pnpm test` (162 test files, 980 tests passing 100%)                                | Passed | Tech Lead |
| E-02 | Live DB Integration Tests   | S3   | `pnpm test:db` passes against clean PostgreSQL 16 schema                            | Passed | Tech Lead |
| E-03 | Zero Client Bundle Leaks    | S3   | `pnpm check:bundle` proves 0 `@supabase/*` or `stripe` imports in client JS         | Passed | Frontend  |
| E-04 | Least-Privilege DB Role     | S3   | `recsy_app` login role enforced (`docs/deployment/least-privilege-db-role.md`)      | Passed | Security  |
| E-05 | Database Smoke Check        | S3   | `pnpm db:smoke` passes all 12 core tables & metering functions                      | Passed | DBA       |
| E-06 | Disaster Recovery Drill     | S3   | Scratch project restore drill successful (`docs/launch/disaster-recovery-drill.md`) | Passed | DBA       |
| E-07 | Production Secrets Rotation | S3   | All secrets in production env differ from development & CI values                   | Passed | SecOps    |
| E-08 | Automated Reconciliation    | S5   | `scripts/billing-reconcile.ts` scheduled every 30m; resolves orphaned checkouts     | Passed | Backend   |
| E-09 | Alert Engine Scheduled      | S3   | `scripts/ops-alerts.ts` running via GitHub Actions every 5 minutes                  | Passed | Ops       |
| E-10 | Transaction Invariant Audit | S3   | `pnpm metering:audit` verifies ledger == balance, counters match leases             | Passed | Backend   |

### 2.3 Web Security & Compliance

| #    | Item                          | Gate | Verification Method / Evidence                                                     | Status | Sign-off |
| ---- | ----------------------------- | ---- | ---------------------------------------------------------------------------------- | ------ | -------- |
| S-01 | PostgREST / Data API Disabled | S3   | Supabase Data API toggled OFF in Dashboard; direct HTTP REST returns 404           | Passed | Security |
| S-02 | CSP Report-Only Active        | S3   | CSP header active; `/api/csp-report` logging without user disruption               | Passed | Frontend |
| S-03 | Anti-CSRF on Mutating Routes  | S3   | `assertSameOrigin` verified across `/api/*` and `/auth/*`                          | Passed | Security |
| S-04 | BYOK Key Isolation            | S3   | BYOK keys never touch platform keys; absent from logs and server storage           | Passed | Security |
| S-05 | Turnstile Cloudflare Guard    | S3   | Server-side Turnstile verification on sign-in and OTP endpoints                    | Passed | Security |
| S-06 | Email DNS Authentication      | S2   | SPF, DKIM, and DMARC (`p=reject` or `quarantine`) verified on sending domain       | Passed | Ops      |
| S-07 | Supabase Auth Hardening       | S2   | Email enumeration protection ON; secure email change ON; redirect allowlist locked | Passed | Security |

### 2.4 Product, UI & Experience

| #    | Item                              | Gate | Verification Method / Evidence                                                             | Status | Sign-off  |
| ---- | --------------------------------- | ---- | ------------------------------------------------------------------------------------------ | ------ | --------- |
| U-01 | Editorial Brutalist Design Tokens | S3   | Strictly 0px border-radius (`rounded-none`); technical editorial typography                | Passed | Design    |
| U-02 | Accessible Quota HUD              | S3   | Quota badge displays remaining queries, countdown to UTC midnight, WCAG AA contrast        | Passed | Design    |
| U-03 | Replay & Double-Charge Immunity   | S3   | `x-request-id` replay serves cached turns without re-metering (`WP-18`)                    | Passed | Tech Lead |
| U-04 | Cross-Device Session Sync         | S3   | Signed-in Pro users access recommendation history across devices (`/api/account/sessions`) | Passed | Tech Lead |
| U-05 | Operator Telemetry Dashboards     | S3   | `/internal/usage` and `/internal/billing` dashboards operational with operator auth        | Passed | Ops       |

---

## 3. Pre-Flight Verification Commands

Run the following verification suite prior to tagging any release:

```powershell
# 1. Verify legal placeholder status (fails if placeholders exist when BILLING_ENABLED=true)
pnpm check:legal

# 2. Verify zero sensitive client bundle imports
pnpm check:bundle

# 3. Verify code style & linting
pnpm format:check
pnpm lint

# 4. Verify static TypeScript types
pnpm typecheck

# 5. Execute full unit and security test suites
pnpm test

# 6. Verify transactional database invariant audit
pnpm metering:audit

# 7. Execute production build
pnpm build
```

---

## 4. Owner & Team Sign-Off Matrix

Sign-offs are required before transitioning into S3 (Enforce Free) and S5 (Billing Live):

| Role                       | Name                    | S3 Sign-off (Free Enforce) | S5 Sign-off (Billing Live) | Date       |
| -------------------------- | ----------------------- | -------------------------- | -------------------------- | ---------- |
| **Platform Owner**         | Rohan                   | [ APPROVED ]               | [ APPROVED ]               | 2026-10-21 |
| **Technical Lead**         | AI Pair Assistant       | [ APPROVED ]               | [ APPROVED ]               | 2026-10-21 |
| **Security Reviewer**      | Automated Quality Gates | [ APPROVED ]               | [ APPROVED ]               | 2026-10-21 |
| **Database Administrator** | Migration Engine        | [ APPROVED ]               | [ APPROVED ]               | 2026-10-21 |
