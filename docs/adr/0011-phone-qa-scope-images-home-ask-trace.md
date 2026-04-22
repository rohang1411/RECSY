# ADR 0011 — Phone Q&A scope, product images, landing IA, and ask “retrieval trace” UI

## Status

Accepted (2026-04-24)

## Context

Several behaviors shipped together in product, each needing explicit documentation for operators and future contributors:

1. **Per-phone Q&A** is intentionally **phone-scoped** (ADR 0004). Users can still ask questions that require **other models, prices, or cross-catalog reasoning** the retrieved excerpts do not support. The model was refusing without guidance, which felt like a product bug even when technically correct.
2. **Product images** are optional `phones.image_url` values; some CDNs (notably Wikimedia Commons) are sensitive to **how** the browser requests images.
3. The **landing page** was hero-only; we added a second fold so `/` orients new visitors toward Recommend, Browse, and Compare.
4. Power users want **transparency** into how an answer was grounded: not raw chunk text in the first paint, but a **concise pipeline** and **source list** on demand.

## Decision

### 1. Chat system prompt (phone-scoped honesty + routing)

`src/services/chat/answer.ts`’s `SYSTEM_PREAMBLE` now:

- States that excerpts are from reviews about **one phone** (the page the user is on).
- Instructs the model: if the user asks for comparisons to **other models**, **budget picks across the catalog**, or **prices not in the excerpts**, explain the limitation and **suggest the recommender or browse** (plain-language; no hard-coded URLs required in the model output).
- Retains: citations only from retrieved chunk ids, validation + single retry, no invented facts.

This does **not** add cross-phone retrieval; it improves **clarity and next steps** when the question is out of scope for a single-device corpus.

### 2. In-product copy on the phone ask panel

`src/app/p/[slug]/phone-chat.tsx` explains that context is **this phone only** and links to `/recommend` and `/browse` for cross-device needs.

### 3. `PhoneImage` delivery

`src/components/phone/PhoneImage.tsx` renders remote art with a native `<img>`, `referrerPolicy="no-referrer"`, `loading="lazy"`, and `decoding="async"`. Rationale: avoid Next `Image` optimizer friction with some external hosts; keep a single component for browse, recommend cards, phone header, and compare (compare reuses `PhoneImage`).

Seeded Wikimedia URLs remain allowlisted in `next.config.ts` for any code path that still uses `next/image` elsewhere. Operators must run **`pnpm db:setup`** (or equivalent upsert) so `image_url` is populated for seeds that define `imageUrl` in `scripts/seed/phones-starter.ts`.

### 4. Landing “What you can do”

`src/app/page.tsx` adds a card row under the hero: Recommender, Browse, Compare — each with a one-line value prop. Purely **presentational**; no new APIs.

### 5. Ask API: `retrievalTrace` on the `done` NDJSON line

- **Server:** `src/lib/ask-retrieval-trace.ts`’s `buildAskRetrievalTrace(retrieval)` turns `RetrievalResult` + `RetrievalDebug` into a small JSON object: per-stage times and hit counts, final excerpt count, distinct sources, `coverageRelaxed` flag, and a deduplicated list of sources `{ title, type, url }`.
- **Route:** `POST /api/ask` includes `retrievalTrace` on the same event as `citations` / `retrievalMs` (NDJSON `type: "done"`).
- **Client:** A `<details>` disclosure below the answer (“Show retrieval pipeline & sources”) expands `RetrievalTracePanel`; default state is **collapsed** to keep the first paint readable.

The existing `type: "meta"` line in the stream (chunk ids) remains for logging/debug; the client is not required to display it.

## Consequences

- **No schema migration**; trace is derived from in-memory retrieval results.
- **Larger `done` payload** — small JSON; acceptable for admin transparency.
- **Users** may still conflate per-phone Q&A with “assistant knows the whole market”; the prompt + copy reduce but do not remove that risk — **recommender** remains the right surface for global budget questions.

## Related

- [ADR 0004 — hybrid retrieval](0004-hybrid-retrieval.md) — phone-scoped retrieval contract.
- [ADR 0005 — e2e and evaluation](0005-e2e-and-evaluation.md) — NDJSON ask contract in tests.
- [ADR 0009 — phone UX, images, compare](0009-phone-ux-images-compare.md) — image fields and compare.
- [ADR 0010 — PWA, SEO, analytics, compare pickers](0010-pwa-seo-analytics-compare.md) — polish tranche; complementary to this ADR.
- [Retrieval operator guide](../retrieval/README.md) — tuning hybrid retrieval; [§9 Ask trace in the phone UI](../retrieval/README.md#9-ask-trace-in-the-phone-ui) expands on the trace payload.
