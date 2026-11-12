# ADR 0021: Billing Architecture and Payment Integration

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** Engineering & Product
- **Consulted:** Plan 25 Architecture Review

---

## Context

To provide sustainable monetization for RECSY v2, users can purchase credit packs (one-time query top-ups) or subscribe to RECSY Pro (monthly recurring subscription with included volume, Deep reasoning, and cross-device sync).
Key requirements:

1. PCI compliance: RECSY must never touch, process, or store raw credit card numbers.
2. Webhook delivery reliability: Webhooks from Stripe can arrive out of order, be delayed, fail, or be re-sent multiple times.
3. Financial ledger integrity: Double credit fulfillment must be impossible under duplicate events.
4. Testability: CI and preview environments must be able to test end-to-end checkout and billing workflows without relying on live Stripe credentials or test network mocks.

---

## Decision

We adopt a hosted checkout model with an idempotent webhook inbox and double-entry credit ledger:

1. **Stripe Hosted Checkout & Customer Portal:**
   - Checkout sessions are created server-side via `POST /api/billing/checkout`.
   - The user is redirected to Stripe's secure checkout page. Upon completion, Stripe redirects back to `/account/billing?success=true`.
   - Subscription management (upgrades, card updates, cancellations) is delegated to Stripe Customer Portal.

2. **Idempotent Webhook Inbox (`billing_events`):**
   - Webhook events received at `POST /api/billing/webhook` are cryptographically verified using `stripe.webhooks.constructEvent`.
   - Raw event IDs are recorded in `billing_events` with unique constraint `(provider, event_id)`. Replayed webhooks return `200 OK` immediately without duplicate side-effects.

3. **Immutable Credit Ledger (`credit_ledger`):**
   - All balance changes execute via `recsy_apply_credit_delta` with strict `idempotency_key` unique indexing.
   - Credit granting creates an audited ledger entry (`kind = 'purchase'`), atomically incrementing `credit_wallets.balance`. Duplicate attempts resolve idempotently.

4. **Self-Healing Reconciliation (`scripts/billing-reconcile.ts`):**
   - A scheduled job queries pending or unfulfilled orders against Stripe's API, correcting any missing fulfillments caused by transient network failures.

5. **Provider Abstraction (`BillingProvider`):**
   - Core billing operations implement the `BillingProvider` interface (`createCheckoutSession`, `createPortalSession`, `handleWebhook`, `cancelSubscription`, etc.).
   - A fully featured `FakeBillingProvider` is provided for automated testing, local development, and CI without external network calls.

---

## Consequences

### Positive

- **Zero PCI Scope:** Hosted Checkout keeps payment card handling completely off RECSY infrastructure.
- **Auditability:** Complete transaction history maintained in `billing_orders` and `credit_ledger`.
- **Fault Tolerance:** Out-of-order and repeated webhook deliveries are safely handled.

### Trade-offs / Mitigations

- **Eventual Consistency on Return:** If a user returns immediately from checkout before the webhook fires, the return page shows a pending confirmation banner and polls `/api/me/entitlement` until fulfillment completes.
