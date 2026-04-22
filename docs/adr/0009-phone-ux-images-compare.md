# ADR 0009 — Phone page detail, images, about, compare, recommender price

Date: 2026-04-21  
Status: Accepted  
Supersedes: none.

## Context

The `/p/[slug]` page only showed brand, model, and tagline; `phones.spec_json`,
`msrp_usd`, and `image_url` were not surfaced. The header linked to **About** with
no route. Users could not compare two picks. Recommender cards showed neither price
nor imagery. Seeds often leave `image_url` null — the UI must degrade gracefully.

## Decision

1. **Phone page** — Load `msrp_usd`, `image_url`, `spec_json`; show `PhoneHeader` with
   image (or initial placeholder) + MSRP, and `PhoneSpecSummary` from validated
   `PhoneSpecSchema`.
2. **Images** — `next/image` with `unoptimized` for arbitrary `image_url` hosts (no
   per-CDN `remotePatterns` churn). Placeholder: letter avatar when `image_url` is
   null; same component on **Browse** and **recommend** pick cards.
3. **Recommender API** — Extend `RecommendApiPick` with `msrpUsd` and `imageUrl` from
   `PhoneCatalogEntry` / `ScoredCandidate`.
4. **Compare** — New `/compare?a=slug&b=slug` server page: two-column hero, MSRP, and
   a spec table when both specs parse. Empty params show usage instructions. **404**
   if both slugs are not active.
5. **About** — New `/about` with product framing and links.
6. **Nav** — Surface Browse, About, and Compare on all breakpoints (previously
   hidden on small screens for Browse/About only).

## Consequences

- **Compare** is URL-driven only (no stateful “picker”); recommender deep-links
  “Compare the top 2” for the first two slugs. Users can hand-edit the URL.
- **Images** in production improve when `phones.image_url` is populated (ingestion
  or manual seed), without code changes per CDN.
