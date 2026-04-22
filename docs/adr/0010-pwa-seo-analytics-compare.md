# ADR 0010 — PWA metadata, public SEO shell, Vercel analytics, compare pickers, CI retrieval eval

## Status

Accepted (2026-04-22)

## Context

Phase 7 intended to ship: installable **PWA** surface (at least manifest + icons), **SEO** (sitemap, robots, **Open Graph** previews), product **analytics** on the hosted target, a **richer** `/compare` path than URL-only, **seeded** `image_url` for a subset of the starter corpus, and a **gated** hybrid **retrieval eval** in CI (ADR 0004/0005). Service-worker-based offline shell is out of scope for this ADR; it adds operational surface (caching, invalidation) and is tracked as a follow-up.

## Decision

1. **PWA (shell)** — `app/manifest.ts` (Next App Router) plus `icon.tsx` / `apple-icon.tsx` (generated PNG via `ImageResponse`) so the app is installable where the browser supports it. No service worker in this tranche.
2. **SEO** — `sitemap.ts` lists static app routes; when `DATABASE_URL` is available at request time, active `/p/[slug]` pages are included. `robots.ts` references the sitemap. `opengraph-image.tsx` provides a default 1200×630 OG image for the root layout; existing `metadata` in `layout.tsx` remains the source of titles/descriptions.
3. **Analytics** — `@vercel/analytics` and `@vercel/speed-insights` mounted in the root layout behind a small client component. On non-Vercel hosts they are effectively no-ops; no PII in event payloads by default.
4. **Compare** — `ComparePhonePickers` (server component: two `<select>` + native GET) complements `CompareSlugForm` for direct `/compare` entry and not-found states.
5. **Seed images** — Optional `imageUrl` on `PhoneSeed`; five flagship rows use **Wikimedia Commons** URLs; `next.config` allowlists `upload.wikimedia.org` for `next/image`.
6. **CI retrieval eval** — Optional workflow job runs when the repository has `GEMINI_API_KEY`. After `db-setup`, `pnpm ci:retrieval-fixture` inserts a minimal `sources` + `chunks` row for `apple-iphone-16-pro`, then `tsx scripts/eval-retrieval.ts` (no `.env.local` in CI: env is injected in the job).

## Consequences

- Product photos remain **best-effort**; ingestion/ops can still override `image_url` in production.
- **Cost**: CI eval accrues one Gemini **embedding** call per fixture per run; keep the job behind the secret to avoid surprise spend on fork PRs (forks do not receive secrets; job is skipped if the secret is absent).
- **Follow-ups**: service worker or Serwist for offline shell; dynamic OG images per phone route; broader eval fixtures once corpus coverage grows.

## Related

- [ADR 0011 — phone Q&A scope, images, home, ask trace](0011-phone-qa-scope-images-home-ask-trace.md) — complements this ADR (per-phone chat behavior and `PhoneImage` notes).
- [ADR 0004 — hybrid retrieval](0004-hybrid-retrieval.md)
- [ADR 0005 — e2e and evaluation](0005-e2e-and-evaluation.md)
- [ADR 0009 — phone UX, images, compare](0009-phone-ux-images-compare.md)
- [Eval docs](../eval/README.md)
