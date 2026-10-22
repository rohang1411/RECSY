# ADR 0020: Identity and Authentication Architecture

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** Engineering & Product
- **Consulted:** Plan 25 Architecture Review

---

## Context

RECSY v2 requires identity and authentication to support user accounts, purchase entitlements, and persistent preferences across devices, while maintaining frictionless access for anonymous first-time visitors:

1. Anonymous users must be able to test recommendations immediately without upfront sign-in.
2. Sign-in must support Google OAuth and passwordless Email OTP / Magic Link.
3. Client browser bundles must stay lean (< 150 KB initial JS) and avoid bulky client-side auth SDKs.
4. Anonymous usage counters must seamlessly graduate to the signed-in account upon authentication, preventing quota abuse via instant cookie churn.
5. All sensitive operations must enforce CSRF protection and secure session management.

---

## Decision

We implement a server-side only authentication architecture utilizing Supabase Auth through Next.js App Router route handlers:

1. **Zero Client SDK Imports:**
   - No `@supabase/supabase-js` or `@supabase/ssr` packages are imported in client browser components. All auth flows execute via HTTP endpoints (`/auth/google`, `/auth/otp/send`, `/auth/otp/verify`, `/auth/callback`, `/auth/signout`).
   - Browser bundle analysis verifies zero Supabase code in client chunks, saving ~50 KB gzipped.

2. **Device Identity (`__Host-recsy_did`):**
   - Every visitor is provisioned an immutable, cryptographically random device UUID stored in an `__Host-recsy_did` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`).
   - Anonymous usage is tracked by subject `device:<uuid>` combined with a salted IP-prefix hash (`ip:<sha256>`).

3. **Anonymous-to-Account Graduation:**
   - When an anonymous user signs in or registers, the server invokes `claimAnonymousDevice(userId, deviceId)`.
   - The device is linked to `user_profiles.id`, and today's accumulated query counters are attributed to the user account, preventing duplicate free allowances.

4. **Security & Session Hardening:**
   - CSRF protection: All state-changing auth and API routes enforce `assertSameOrigin` checking `Origin` and `Sec-Fetch-Site`.
   - Magic link / OTP protection: Sign-in links use a `POST`-confirm flow to prevent enterprise email scanners from prematurely consuming one-time tokens.
   - Open redirect prevention: Return URLs are validated with `safeReturnTo()` restricting redirection to internal relative paths.

---

## Consequences

### Positive

- **Ultra-Lean Client Bundles:** Preserves fast initial page loads and zero hydration overhead.
- **Robust Multi-Device Support:** Clear separation between device-level identity and user account profiles.
- **Abuse Resistance:** Smooth transition from anonymous to registered state without resetting quota.

### Trade-offs / Mitigations

- **Server Route Orchestration:** All auth redirects and token exchanges must be handled explicitly in server route handlers. Thoroughly validated via unit and integration tests.
