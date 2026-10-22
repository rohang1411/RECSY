---
title: Privacy Policy
version: 2026.04.1
lastUpdated: 2026-04-15
---

# Privacy Policy

At RECSY ("we", "us", or "our"), we believe privacy should be transparent, verifiable, and minimal by design. This Privacy Policy outlines what information we collect, why we collect it, how long we retain it, and your legal rights regarding your personal data.

---

### 1. Data Controller & Contact

LEGAL_PLACEHOLDER: [Data Controller Legal Name, Registered Address, and Data Protection Officer (DPO) Contact Details]

If you have questions about this policy or wish to exercise your data rights, contact us at `privacy@recsy.app` or at the address above.

---

### 2. Personal Data Inventory & Retention

We collect only what is strictly necessary to deliver recommendation intelligence, enforce fair-use quotas, and process payments:

| Category                    | Specific Data                                                             | Purpose                                                               | Retention Period                                                                                                                                  |
| :-------------------------- | :------------------------------------------------------------------------ | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Account Identity**        | Email address, display name, profile avatar                               | Account sign-in, authentication, transactional receipts               | Retained until account deletion is requested and completed (30-day grace period).                                                                 |
| **Regional Context**        | Selected region, currency hint, country code                              | Present localized pricing, retailer availability, and specs           | Stored in cookie and profile until account deletion.                                                                                              |
| **Quota & Abuse Telemetry** | Salted cryptographic device ID hash, salted /24 or /48 IP subnet hash     | Enforce 2 free daily queries, prevent automated bot abuse             | 14 days for daily usage counters; 90 days for query leases.                                                                                       |
| **Conversations & Queries** | User query text, prompt transcripts, grounded AI responses                | Delivering the recommendation service, session history across devices | Up to 12 months for account history, or until deleted by user via "Clear History" or Account Deletion.                                            |
| **Financial Records**       | Order IDs, credit ledger entries, subscription status, billing timestamps | Statutory accounting, taxation compliance, dispute resolution         | Retained for legal statutory periods (typically 6–7 years), pseudonymized upon account deletion.                                                  |
| **Payment Credentials**     | Credit card numbers, CVV, billing address                                 | Processing transactions                                               | **Never collected or stored by RECSY.** Handled entirely by our PCI-DSS Level 1 certified payment processor (Stripe).                             |
| **BYOK API Keys**           | Third-party AI provider API keys                                          | Custom model execution                                                | **Never transmitted or stored on RECSY servers.** Stored exclusively in your browser's local storage and sent per query directly to the provider. |

---

### 3. Sub-Processors & Third-Party Service Providers

To operate our cloud infrastructure, we share minimal requisite data with the following vetted third-party sub-processors:

- **Supabase Inc.** (United States / EU): Database hosting, PostgreSQL storage, and authentication identity services.
- **Vercel Inc.** (United States / Global): Edge routing, application hosting, and cookieless web performance analytics.
- **Stripe Inc.** (United States / Global): Payment processing, hosted checkout, customer portal, and fraud detection.
- **Google Cloud & Google AI** (United States / Global): Google OAuth sign-in and Gemini large language model inference.
- **Cloudflare Inc.** (United States / Global): Turnstile privacy-preserving bot detection and DDoS defense.
- **Third-Party Inference Providers:** When processing queries under platform pools, queries may be routed through Groq, NVIDIA, Cerebras, GitHub Models, or OpenRouter for model execution.
- **Transactional Email:** Resend / Postmark for delivery of authentication magic links, OTP codes, and payment receipts.

**Important Notice Regarding AI Inference:** Query text submitted to the Service is processed by third-party model providers to generate conversational answers and recommendations. When using BYOK mode, queries are routed under your personal provider account subject to their separate data retention policies.

---

### 4. Cookies & Local Storage

We use only strictly necessary cookies and browser storage:

- `__Host-recsy_did`: Cryptographic device identifier for fair-use quota tracking (SameSite=Lax, HttpOnly, Secure).
- `sb-*-auth-token`: Secure authentication tokens issued upon login.
- `recsy_region`: Stores your selected country preference.
- `localStorage`: Stores your personal BYOK API keys strictly on your device.

We do NOT use non-essential advertising trackers, third-party remarketing pixels, or cross-site tracking cookies.

---

### 5. Your Rights: Export & Deletion

Under the General Data Protection Regulation (GDPR), California Consumer Privacy Act (CCPA), and similar laws, you have the right to:

- **Access & Portability:** Request a full JSON export of all personal data held about you via `POST /api/account/export` or your Account Dashboard.
- **Erasure ("Right to be Forgotten"):** Initiate complete account deletion via `POST /api/account/delete`. Upon request, all profile records, recommendation sessions, and chat logs are queued for permanent deletion after a 30-day cooling-off period.
- **History Deletion:** Clear conversational query history independently at any time without deleting your account.

---

### 6. Security & Safeguards

We implement strict security measures including Content Security Policies (CSP), Cross-Origin Opener/Resource Policies (COOP/CORP), rate limiting, row-level database security, and automated redaction of sensitive credentials in server logs.
