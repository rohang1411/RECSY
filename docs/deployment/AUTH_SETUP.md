# RECSY Supabase Auth Configuration Checklist

Normative reference: Plan 25 Section 8.1 (WP-05).

---

## 1. Authentication Providers

### A. Google OAuth

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web Application).
3. Set **Authorized JavaScript origins**:
   - `http://localhost:3000` (development)
   - `https://recsy.com` (production)
4. Set **Authorized redirect URIs**:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Copy the Client ID and Client Secret into the Supabase Dashboard:
   - Navigate to **Authentication** &rarr; **Providers** &rarr; **Google**.
   - Enable Google, paste Client ID and Secret, and Save.

### B. Email (OTP & Magic Links)

1. In Supabase Dashboard &rarr; **Authentication** &rarr; **Providers** &rarr; **Email**:
   - Enable Email Provider.
   - Enable **Confirm email**.
   - Enable **Secure email change**.
   - Set OTP Expiration: `600` seconds (10 minutes).

---

## 2. Redirect URLs & Site URL

1. In Supabase Dashboard &rarr; **Authentication** &rarr; **URL Configuration**:
   - **Site URL**: `https://recsy.com` (or `http://localhost:3000` for local dev project)
   - **Redirect URLs (Allowlist)**:
     - `http://localhost:3000/**`
     - `https://recsy.com/**`
     - `https://*.vercel.app/**` (staging/preview only)

---

## 3. Custom SMTP Email Delivery

The built-in Supabase mailer is strictly rate-limited (3-4 emails/hour) and must not be used in production.

1. In Supabase Dashboard &rarr; **Project Settings** &rarr; **Authentication** &rarr; **SMTP Settings**:
   - Enable Custom SMTP.
   - Configure your provider (Resend, Postmark, AWS SES, or SendGrid).
   - Verify SPF, DKIM, and DMARC records on the sending domain.
   - Set Sender Name: `RECSY`
   - Set Sender Email: `auth@recsy.com` (or configured verified address)

---

## 4. Email Templates

Paste the branded dark-editorial HTML templates into Supabase Dashboard &rarr; **Authentication** &rarr; **Email Templates**:

1. **Magic Link / Confirm Signup**:
   - Subject: `Your RECSY code: {{ .Token }}`
   - Content: Copy from [`docs/email-templates/sign-in-code.html`](../email-templates/sign-in-code.html)
2. **Change Email Address**:
   - Subject: `Confirm your new RECSY email`
   - Content: Copy from [`docs/email-templates/email-change.html`](../email-templates/email-change.html)

---

## 5. Security & Bot Protection (Cloudflare Turnstile)

1. Obtain a Cloudflare Turnstile Site Key and Secret Key from the Cloudflare Dashboard.
2. In Supabase Dashboard &rarr; **Project Settings** &rarr; **Authentication** &rarr; **Bot Protection**:
   - Select **Cloudflare Turnstile**.
   - Enter your Turnstile Secret Key.
3. Configure the environment variables:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`

---

## 6. Local & Automated Testing Mode

For local development and unit tests without external network dependencies, RECSY provides an isolated `FakeAuthDriver`:

- Set `AUTH_DRIVER=fake` in `.env.local` or test runners.
- The fake driver is strictly protected by `assertFakeAuthAllowed()`: it will refuse to boot if `NEXT_PUBLIC_SITE_URL` is not localhost or if `DATABASE_URL` is a hosted database.
