# ADR 0014 — Automated, tiered ingestion with LLM curation

## Status

Accepted (2026-04-22)

## Context

ADR 0003 set up the ingestion framework in TypeScript and ADR 0012 fixed the
UX regression where a phone with no corpus looked like a broken product. But
both assumed that **an operator runs `pnpm ingest --phone <slug>`** when they
want coverage for a device. In practice that means:

- A user can land on `/p/pixel-9-pro-xl` and hit the empty-corpus message
  simply because nobody remembered to run ingestion for that phone.
- The one GitHub Actions nightly we had shipped (`ingest.yml`'s scheduled
  job) walked a **hand-curated list of four slugs** — which drifted out of
  sync with the `phones` table the moment anyone added a new device.
- Every ingestion run was "all-or-nothing": we never filtered out low-signal
  content, so a Reddit thread with three shitposts and an article from a
  content farm both made it into the corpus with the same weight as a
  20-minute MKBHD review.

We also had no source of truth for what a "trusted" source _is_: the Reddit
adapter had a hardcoded subreddit allowlist, the YouTube adapter could pull
any channel, and the Article adapter trusted whatever came back from search.
Expanding coverage meant code edits.

The goal for this ADR is a pipeline that:

1. Keeps the corpus fresh **without** operator involvement.
2. Doesn't pollute the database with low-signal content.
3. Stays polite enough not to get us banned.
4. Runs at zero incremental cost on the free tier (GitHub Actions + Supabase
   - Gemini Flash).

## Decision

### 1. Freshness tiers drive scheduling, not a hand-curated roster

A new `phones.nextIngestAt` column pairs with `phones.lastIngestAt` to make
the scheduler declarative. Tiers are a function of launch date:

| Tier | Criterion                                       | Cadence   |
| ---- | ----------------------------------------------- | --------- |
| hot  | Launched in last 60 days (or `status=upcoming`) | ~3.5 days |
| warm | Launched 60d–365d ago                           | 7 days    |
| cold | Launched >365d ago                              | 14 days   |

`src/services/ingest/scheduler/tiers.ts` is the single source of truth:
`classifyTier(launchDate)` → `'hot' | 'warm' | 'cold'`; `computeNextIngestAt(tier)`
→ `Date`. The scheduler (`scheduler/pick-phones.ts`) picks phones where
`next_ingest_at <= now()` or `null`, filters by tier, shards deterministically
(FNV-32 hash on phone id), and orders hot → warm → cold. When a run finishes
successfully, `markIngested` writes `last_ingest_at=now` and
`next_ingest_at=now + interval(tier)` so the phone drops out of the queue.

**Result:** new phones auto-bootstrap (null `next_ingest_at` is treated as
immediately due), and the roster evolves with the catalog rather than with
hand-edits to a YAML file.

### 2. GitHub Actions matrix 4×N replaces the hand-curated nightly

Three workflows replace the single `ingest.yml`:

- **`ingest-tiered.yml`** — daily at 02:17 UTC. A `plan` job decides which
  tiers to run (hot every day; warm Mon/Wed/Fri/Sat; cold Sunday). The
  `ingest` matrix is `tiers × [shard 0,1,2,3]` with `max-parallel: 4`. Each
  shard calls `scripts/ingest-auto.ts --tier $T --shard $K --total-shards 4`.
- **`creator-watch.yml`** — every 6h. Metadata-only RSS poll of allowlisted
  YouTube channels (MKBHD, Mrwhosetheboss, TheTechChap, SuperSaf, TheUnlockr,
  MrMobile). Matches entries against `phone_aliases` and inserts hot-tier
  rows into `crawl_queue`. Cheap enough to run 4×/day.
- **`ingest-on-new-phone.yml`** — `workflow_dispatch` only. Manually fire a
  single-phone ingestion when an admin adds a device that shouldn't wait for
  the next tiered cron.

The legacy `ingest.yml` shrinks to the manual `workflow_dispatch` entrypoint
only; the nightly roster is retired.

### 3. Curator agent gates every source before embedding

`src/services/ingest/agents/curator.ts` runs between `adapter.chunk()` and
`embedder.embedAll()`. It takes a small sample (title + first 3 chunks) and
asks Gemini Flash to score `relevance` and `quality` (0–10), extract
`aspectsCovered`, and emit a `sentimentSummary`. If `keep=false`, the source
is **not embedded** — we only pay the (free-tier) LLM call, not the embedder.
A `rejectedReason` is recorded in `ingest_runs` so we can audit false
negatives.

This matters because:

- Embeddings are the expensive step. Gating them on a fast Flash call saves
  both quota and DB rows.
- The same enrichment feeds the retriever: `sources.relevance`,
  `sources.quality`, `sources.aspects_covered`, and `sources.sentiment_summary`
  are now set in the writer, so downstream features (aspect scorecard,
  recommender tie-breaks) stop flying blind.

Fallback behaviour is deliberately permissive: if the Curator call fails
(LLM outage, JSON parse error), the source is kept — we'd rather have
un-enriched content than lose it.

### 4. Disambiguator agent handles multi-phone titles

Reviewers routinely publish "S25 Ultra vs Pixel 9 Pro" comparison videos. If
such a video was surfaced while ingesting _S25 Ultra_, we want chunks linked
to S25 Ultra _and_ Pixel 9 Pro, but not mis-assigned if the content is
actually Pixel-centric.

`src/services/ingest/agents/disambiguator.ts` only runs when a cheap
heuristic (`alias-match.ts`, longest-match-wins) finds ≥2 distinct phones in
the title+description. The LLM picks the _primary_ phone (confidence + reason)
and lists secondaries with relevance scores. The orchestrator can reassign
the primary if `phoneLookup` resolves the slug, and writes both `role=primary`
and `role=secondary` rows into `source_phone_links`.

Alias matches are cached per orchestrator run, so we load `phone_aliases`
exactly once per invocation regardless of how many phones are processed.

### 5. Polite HTTP is mandatory for all external fetches

New `src/services/ingest/http.ts` wraps every network call. The non-negotiable
properties are:

- **Per-host rate limits** (token-bucket, persisted in `rate_limit_state`
  so parallel GH Actions shards cooperate via UPSERT).
- **User-Agent pool** of 3 self-identifying variants pointing at the repo.
- **robots.txt respect** — 24h cache in `domain_profiles` + in-memory;
  disallowed URLs throw `NotFoundError` and skip.
- **`Retry-After` honoring** on 429/503 (capped at 30s so a single host
  can't stall the whole run).
- **Timeout + `p-retry`** for transient 5xx, exponential backoff with jitter.

GSMArena, Reddit `/new.json`, Reddit `/search.json`, article extraction, and
YouTube RSS all go through this wrapper. The existing `YouTubeAdapter`
transcript fetch (via `youtubei.js`) is the one exception and is gated by
the YouTube hostname in the limiter.

### 6. Source profiles are DB-driven

Four new tables make the pipeline configurable without code edits:

- `phone_aliases` — "S25 Ultra", "S25U", "Galaxy S25 Ultra" → phone_id.
- `creator_profiles` — platform + external_id + trust_weight.
- `subreddit_profiles` — name + scope (`general` vs `device`) + min_score.
- `domain_profiles` — host + trust_weight + robots_fetched_at.

Seed scripts populate the initial allowlist; admins edit rows rather than
PRs. Alias matching is the longest-match-wins variant described above —
critical to avoid matching "S25" when "S25 Ultra" is present.

### 7. UI / UX: time-aware empty-corpus message

The ADR 0012 short-circuit stays (no LLM spend on empty corpora), but the
message is now **user-friendly and time-aware**. `runPhoneQna` takes an
optional `phoneMeta: { brand, model, lastIngestAt, nextIngestAt }` and
`buildNoContextMessage` renders one of:

- "We don't have ingested reviews for **Google Pixel 9 Pro** yet. We haven't
  run an ingestion pass for it yet — it will be picked up on the next
  scheduled crawl. In the meantime, try the recommender …"
- "… Our last ingestion for it ran 4 days ago and didn't find usable reviews.
  Next refresh is scheduled in about 3 days. …"
- "… Next refresh is scheduled in about 12h."

No more `pnpm ingest --phone <slug>` in user-facing text. The API route
(`src/app/api/ask/route.ts`) loads brand/model/lastIngestAt/nextIngestAt in
the same row it already fetches, so there's no extra query cost.

### 8. Weekly digest for auditability

`scripts/ingest-report.ts` (aliased as `pnpm ingest:report`) prints:

- `ingest_runs` grouped by adapter × status and by tier.
- Top 10 `rejected_reason` values — the early-warning signal if Curator
  starts over-rejecting real content.
- Average `relevance` / `quality` of sources written this window.
- Phones >2× overdue relative to their tier's interval.

The output is console-only on purpose: a richer dashboard can build on the
same queries later; we don't need an admin UI on day one.

## Consequences

### Positive

- **Freshness without operator involvement.** New phones bootstrap on insert.
  Hot-tier devices refresh twice a week; cold-tier don't starve.
- **Corpus quality.** Curator stops low-signal sources from taking up space
  in `chunks` and degrading retrieval. Disambiguator stops mis-attribution
  on comparison content.
- **Cooperative politeness.** `rate_limit_state` in Postgres lets parallel
  GH Actions shards coordinate without file-system locks. Robots + retry-after
  mean we're not going to get IP-banned.
- **Zero-cost scaling path.** GH Actions free tier covers daily + 6h cron.
  Gemini Flash curator call is the only LLM spend per source, well within
  the free tier.
- **Testability.** Every agent/adapter/scheduler piece has focused unit
  tests; the orchestrator's disambiguation branch has explicit tests for
  the reassignment path.

### Trade-offs

- **Curator false negatives.** A strict Flash prompt will occasionally
  reject legitimate content (especially short articles or comments). The
  `rejected_reason` histogram in the weekly report is the mitigation; we
  can tune thresholds without re-deploying code.
- **Disambiguator latency.** Only runs on ≥2-phone matches, so typical
  videos are unaffected; but for creators whose titles always mention
  two phones (comparison channels), the extra LLM call adds ~500ms per
  source. Worth it for better links.
- **`robots.txt` over-compliance.** Our parser only honours `User-agent: *`
  and `User-agent: RECSYBot*` groups and applies `Disallow:` paths. If a
  future site uses wildcard groups + `Allow:` to permit us, we'll fail
  closed. Acceptable for now.
- **Cold-tier only runs on Sundays.** If a run fails, affected phones
  don't retry for another week. Mitigation: `ingest-auto.ts` exits non-zero
  on total failure (so the workflow surfaces red in the UI), and the
  weekly report's "overdue" section will flag missed phones before their
  message surfaces to users.
- **Freshness tier is launch-date based.** A niche phone that goes viral
  on TikTok will stay in "cold" until we manually re-classify. Fine as v1;
  a popularity-aware tier is a follow-up.

## Implementation surface

- `src/services/ingest/scheduler/{tiers,pick-phones,enqueue}.ts` — scheduler.
- `src/services/ingest/agents/{curator,disambiguator,alias-match,alias-loader}.ts`
  — intelligence layer.
- `src/services/ingest/adapters/{gsmarena,youtube-channel}.ts` — new adapters.
- `src/services/ingest/adapters/reddit.ts` — now profile-driven + `/new.json`.
- `src/services/ingest/http.ts` + `rate-limit.ts` — polite HTTP.
- `src/services/db/schema.ts` — new tables + `sources`/`phones`/`ingest_runs`
  columns. Drizzle migrations in `drizzle/migrations/`.
- `src/services/chat/answer.ts` — `buildNoContextMessage(phoneMeta)`.
- `src/app/api/ask/route.ts` — passes phone metadata.
- `scripts/ingest-auto.ts`, `scripts/creator-watch.ts`, `scripts/ingest-report.ts`.
- `.github/workflows/{ingest,ingest-tiered,creator-watch,ingest-on-new-phone}.yml`.
- `docs/ImplementationPlans/automated-ingestion-pipeline.md` — full plan.

## Alternatives considered

- **Cron per phone.** Obviously non-starter at scale; GH Actions has limits
  on concurrent workflows. Sharding on matrix is the right shape.
- **One mega-agent that does discover + curate + disambiguate + write.** A
  single-agent design is easier to reason about but far more expensive per
  token and coupled to the LLM's availability. Splitting into one cheap
  heuristic + two narrow Flash-scoped agents costs less and degrades
  gracefully when a single agent fails.
- **Scheduled SQL edge function in Supabase** (instead of GH Actions). The
  Supabase free tier doesn't give enough runtime; GH Actions minutes are
  plentiful and we already use them for CI.
- **BullMQ / Redis queue.** Overkill for our scale. `crawl_queue` rows in
  Postgres + hash-mod sharding is enough for thousands of phones.

## Forward work (not in this ADR)

- Popularity-aware tier (promote phones trending on Reddit/YouTube into
  `hot` regardless of age).
- Admin UI to edit `creator_profiles` / `subreddit_profiles` from a browser.
- Scorecard-driven curator tuning — auto-raise thresholds for aspects we
  already have plenty of data on, lower for under-covered aspects.
- Retry-aware queue draining for `crawl_queue` (currently the queue is an
  input to `creator-watch` only; the tiered run doesn't consume it yet).
