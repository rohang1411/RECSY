# Automated Scorecard Generation

> **Status**: Implemented and verified (2026-05-14). Script follow-ups applied 2026-05-15.
> **Goal**: Make scorecard generation fully automatic so aspect scores stay fresh without manual `pnpm scorecard:run`.

## Implementation Status (as of 2026-05-14)

All files listed in the File Summary below have been implemented. A live
end-to-end smoke test was run locally (`pnpm scorecard:auto --dry-run --limit 2`
then `pnpm scorecard:auto --limit 1` twice). Key observations:

- **Dry-run** exits 0, prints the two most-overdue phones — confirms DB
  connectivity, schema guard, and `pickScorecardPhones` all work.
- **Real run (1 phone)** exits 0 in ~49 s with `7 updated, 0 failed`. No LLM
  call is made when the corpus is empty (neutral rows are written directly by
  `runSingleAspect`, see §Empty corpus behaviour below).
- **Second real run** exits 0 and picks a _different_ phone — because
  `markScorecardComplete` pushed the first phone's `next_scorecard_at` forward
  by 3–7 days. See the corrected Verification Plan below.

### Known issues / gaps

None blocking. Telemetry and rescheduling fixes (2026-05-15):

- **Staleness skip telemetry** — `scorecard:auto.ts` now inserts **seven**
  `scorecard_runs` rows (`ASPECT_NAMES`), each `status: 'skipped'`,
  `skipReason: 'chunks_unchanged'`, so per-aspect queries align with real runs.
- **`markScorecardComplete` after failed runs** — after `runScorecardForPhone`,
  `markScorecardComplete` is called **only when `result.updated > 0`**. If every
  aspect fails (`updated === 0`), the phone stays due for the next cron; a warn
  log is emitted and `failures` is incremented for exit-code purposes.

---

## Decisions (resolved)

- **Cadence**: Scorecard refresh **24h** after ingestion completes.
- **Post-ingest hook**: **Yes** — wire the hook in `ingest-auto.ts` from day one.
- **GH Actions schedule**: Use the **same** schedule as ingestion (`02:17 UTC`). The scorecard job is a separate workflow file but fires at the same cron time; the staleness guard and `next_scorecard_at` scheduling ensure phones are only scored when due (not every run).
- **Free tier**: All calls must stay within Gemini free tier (15 RPM structured output, 1500 RPM embeddings). Pacing enforced via sleep.

## Background & Existing Code Context

### What exists today

| File                                          | Role                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/services/scorecard/agent.ts`             | Core logic: `runSingleAspect(ctx, def)` and `runScorecardForPhone(ctx)`. Retrieves chunks via `HybridRetriever`, calls `llm.structured()` with `aspectScorecardExtractionSchema`, validates chunk IDs (one retry), upserts into `aspects` table. |
| `src/services/scorecard/constants.ts`         | `SCORECARD_K_PER_RETRIEVER=30`, `SCORECARD_TARGET_RESULTS=8`, `SCORECARD_MIN_DISTINCT_SOURCES=2`, `SCORECARD_RECENCY_WINDOW_MS=90d`                                                                                                              |
| `src/services/scorecard/definitions.ts`       | `latestAspectDefinitionsByAspect(rows)` — picks highest-version definition per aspect                                                                                                                                                            |
| `src/services/scorecard/extraction-schema.ts` | Zod schema: `overallScore(0-10)`, `confidence(0-1)`, `summary`, `supporting[]`, `dissenting[]`                                                                                                                                                   |
| `src/services/scorecard/query-build.ts`       | `buildCombinedRetrievalQuery(prompts)` — joins `query_prompts` with byte cap                                                                                                                                                                     |
| `src/services/scorecard/recency.ts`           | `recencyConfidenceBoost(chunks)` — small additive boost (max 0.12)                                                                                                                                                                               |
| `src/services/scorecard/types.ts`             | `AspectDefinitionRow`, `AspectRow`, `ScorecardQuote` types                                                                                                                                                                                       |
| `src/services/scorecard/index.ts`             | Re-exports all public API                                                                                                                                                                                                                        |
| `scripts/scorecard-run.ts`                    | Manual CLI: `pnpm scorecard:run --phone <slug>` or `--all`. Iterates active phones, calls `runScorecardForPhone`.                                                                                                                                |

### Ingestion automation pattern (to mirror)

| File                                           | Role                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/ingest/scheduler/pick-phones.ts` | `pickPhones(db, opts)` — selects phones where `next_ingest_at <= now` or null. Uses `shardIndex()` (FNV hash) for GH Actions matrix sharding.                                            |
| `src/services/ingest/scheduler/enqueue.ts`     | `markIngested(db, { phoneId, tier })` — sets `last_ingest_at`, computes `next_ingest_at` from tier interval. `bootstrapNextIngestAt(db)` — backfills null rows with jittered scheduling. |
| `src/services/ingest/scheduler/tiers.ts`       | `classifyTier(launchDate)`, `computeNextIngestAt(tier, from)`, `REFRESH_INTERVAL_DAYS`                                                                                                   |
| `scripts/ingest-auto.ts`                       | Automated CLI: schema guard → `pickPhones` → iterate with per-phone try/catch → `markIngested` → print totals.                                                                           |
| `.github/workflows/ingest-tiered.yml`          | Cron `02:17 UTC`, plan job selects tiers by day-of-week, 4-shard matrix, `pnpm exec tsx scripts/ingest-auto.ts`.                                                                         |
| `src/services/db/schema-guard.ts`              | `findMissingPublicSchema(db, requirements)` / `describeMissingSchema(scriptName, missing)` — exits gracefully if DB schema is outdated.                                                  |

### Key schema context

**`phones` table** already has `lastIngestAt` and `nextIngestAt` (lines 128-137 of `schema.ts`). We add the analogous `lastScorecardAt` / `nextScorecardAt` right next to them.

**`aspects` table** uses `onConflictDoUpdate` on `(phoneId, aspectDefinitionId)` — the upsert in `agent.ts` is idempotent.

**`ingestStatusEnum`** = `['started', 'success', 'failed', 'skipped']` — reused for `scorecard_runs.status`.

**`aspectEnum`** = `['camera', 'battery', 'performance', 'display', 'build', 'software', 'value']` — reused for `scorecard_runs.aspect`.

**`ASPECT_NAMES`** from `src/lib/constants.ts` — the canonical list iterated by `runScorecardForPhone`.

---

## Proposed Changes

### 1. Schema — `phones` table additions

#### [MODIFY] [schema.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/db/schema.ts)

Add two columns to the `phones` table definition, right after `nextIngestAt` (line ~137):

```ts
/** When scorecard was last computed for this phone. Null = never scored. */
lastScorecardAt: timestamp('last_scorecard_at', { withTimezone: true }),
/** When the scheduler should next re-score. Null = eligible now. */
nextScorecardAt: timestamp('next_scorecard_at', { withTimezone: true }),
```

Add to the table's index array:

```ts
index('phones_next_scorecard_at_idx').on(t.nextScorecardAt),
```

---

### 2. Schema — `scorecard_runs` telemetry table

#### [NEW] Add after the `aspects` table block in [schema.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/db/schema.ts)

```ts
export const scorecardRuns = pgTable(
  'scorecard_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneId: uuid('phone_id').references(() => phones.id, { onDelete: 'set null' }),
    aspect: aspectEnum('aspect').notNull(),
    status: ingestStatusEnum('status').notNull(),
    skipReason: text('skip_reason'),
    chunkFingerprint: text('chunk_fingerprint'),
    score: numeric('score', { precision: 3, scale: 1 }),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    nSources: integer('n_sources'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('scorecard_runs_phone_idx').on(t.phoneId),
    index('scorecard_runs_status_idx').on(t.status),
    index('scorecard_runs_started_at_idx').on(t.startedAt),
  ],
);
```

Also add a relation:

```ts
export const scorecardRunsRelations = relations(scorecardRuns, ({ one }) => ({
  phone: one(phones, { fields: [scorecardRuns.phoneId], references: [phones.id] }),
}));
```

And update `phonesRelations` to add `scorecardRuns: many(scorecardRuns)`.

---

### 3. Migration

Run `pnpm db:generate` to create the migration. Verify it produces the ALTER TABLE + CREATE TABLE SQL. Then apply with `pnpm db:setup` or `pnpm db:push`.

---

### 4. Scorecard scheduler

#### [NEW] [src/services/scorecard/scheduler.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/scorecard/scheduler.ts)

Two functions, mirroring the ingestion scheduler pattern:

**`pickScorecardPhones(db, opts)`**:

- Query active/upcoming phones where `next_scorecard_at <= now` OR `next_scorecard_at IS NULL`.
- Order by `COALESCE(last_scorecard_at, '1970-01-01')` ASC (never-scored first).
- Apply shard filter using `shardIndex()` imported from `src/services/ingest/scheduler/pick-phones.ts`.
- Return `{ id, slug, brand, model, lastScorecardAt, lastIngestAt }[]`.

**`markScorecardComplete(db, { phoneId, at? })`**:

- Sets `last_scorecard_at = at`, computes `next_scorecard_at`:
  - If `lastIngestAt` is within 7 days → next = `at + 3 days`.
  - Otherwise → next = `at + 7 days`.
- Reads `lastIngestAt` from the phone row to decide interval.

**`bootstrapNextScorecardAt(db)`** (optional, for migration backfill):

- For phones with `next_scorecard_at IS NULL`, set a jittered value (same pattern as `bootstrapNextIngestAt`).

---

### 5. Staleness guard

#### [NEW] [src/services/scorecard/staleness.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/scorecard/staleness.ts)

**`computeChunkFingerprint(db, phoneId)`**: Executes raw SQL:

```sql
SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS fingerprint
FROM chunks WHERE phone_id = $1
```

Returns the hash string, or empty string `''` if no chunks exist.

**`getLastScorecardFingerprint(db, phoneId)`**: Queries `scorecard_runs` for the most recent `status='success'` row for this phone and returns its `chunk_fingerprint` column. Returns `null` if none found.

If `computeChunkFingerprint() === getLastScorecardFingerprint()` and `--force` is not set → skip this phone.

---

### 6. Enhanced scorecard agent

#### [MODIFY] [src/services/scorecard/agent.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/scorecard/agent.ts)

**`ScorecardRunContext`** — add optional fields:

```ts
export interface ScorecardRunContext {
  // ... existing fields ...
  readonly chunkFingerprint?: string;
  /** Delay in ms between aspect calls for rate limiting. Default 0. */
  readonly aspectDelayMs?: number;
}
```

**`runSingleAspect`** — wrap existing body in try/catch:

- Record `const startedAt = Date.now()`.
- On success: insert `scorecard_runs` row with `status='success'`, `score`, `confidence`, `nSources`, `durationMs`, `chunkFingerprint` from context.
- On error: insert `scorecard_runs` row with `status='failed'`, `error: err.message`. **Do not re-throw** — return a failure indicator instead.
- Change return type to `Promise<{ ok: boolean }>`.

**`runScorecardForPhone`** — changes:

- After each `runSingleAspect` call, if `ctx.aspectDelayMs > 0`, await a `setTimeout` promise.
- Track `updated`, `failed` counts.
- Return `{ updated: number; failed: number; fingerprint: string }` instead of `{ updated: number }`.

> [!WARNING]
> **Do not break the existing `scripts/scorecard-run.ts` CLI.** The return type change from `{ updated }` to `{ updated, failed, fingerprint }` is backwards-compatible since callers only destructure `updated`. But verify `scorecard-run.ts` still compiles.

---

### 7. Automated script

#### [NEW] [scripts/scorecard-auto.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/scripts/scorecard-auto.ts)

Model closely on `scripts/ingest-auto.ts`. Key structure:

```ts
#!/usr/bin/env tsx
// Usage: pnpm scorecard:auto [options]
//   --limit N          Max phones (default: 10)
//   --shard K          Shard index (default: 0)
//   --total-shards N   (default: 1)
//   --force            Ignore staleness guard
//   --dry-run          Print selection, skip scoring
//   --help

import { ASPECT_NAMES } from '../src/lib/constants';
import { getDb } from '../src/services/db/client';
import { scorecardRuns } from '../src/services/db/schema';
import { findMissingPublicSchema, describeMissingSchema } from '../src/services/db/schema-guard';
import { logger } from '../src/services/logger';
import { getLlm } from '../src/services/llm';
import { createHybridRetriever } from '../src/services/retrieval/factory';
import { pickScorecardPhones, markScorecardComplete } from '../src/services/scorecard/scheduler';
import {
  computeChunkFingerprint,
  getLastScorecardFingerprint,
} from '../src/services/scorecard/staleness';
import { runScorecardForPhone } from '../src/services/scorecard/agent';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  // Schema guard — exit 0 if DB not ready
  const missing = await findMissingPublicSchema(db, [
    { table: 'phones', columns: ['last_scorecard_at', 'next_scorecard_at'] },
    { table: 'scorecard_runs' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('scorecard:auto', missing));
    process.exit(0);
  }

  const picked = await pickScorecardPhones(db, {
    limit: args.limit,
    shard: args.shard,
    totalShards: args.totalShards,
  });

  if (picked.length === 0) {
    console.log('[scorecard:auto] no phones due');
    process.exit(0);
  }

  if (args.dryRun) {
    for (const p of picked) console.log(`  would score: ${p.slug}`);
    process.exit(0);
  }

  const retriever = createHybridRetriever();
  const llm = getLlm();
  const log = logger.child({ script: 'scorecard-auto' });
  let scored = 0,
    skipped = 0,
    failures = 0;

  for (const phone of picked) {
    try {
      const fingerprint = await computeChunkFingerprint(db, phone.id);
      if (!args.force) {
        const last = await getLastScorecardFingerprint(db, phone.id);
        if (last !== null && last === fingerprint) {
          console.log(`  ${phone.slug}: skipped (chunks_unchanged)`);
          const now = new Date();
          await db.insert(scorecardRuns).values(
            ASPECT_NAMES.map((aspect) => ({
              phoneId: phone.id,
              aspect,
              status: 'skipped' as const,
              skipReason: 'chunks_unchanged',
              chunkFingerprint: fingerprint,
              startedAt: now,
              finishedAt: now,
              durationMs: 0,
            })),
          );
          await markScorecardComplete(db, { phoneId: phone.id });
          skipped++;
          continue;
        }
      }
      const result = await runScorecardForPhone({
        phoneId: phone.id,
        brand: phone.brand,
        model: phone.model,
        db,
        retriever,
        llm,
        log,
        chunkFingerprint: fingerprint,
        aspectDelayMs: 4500, // 4.5s pacing for free tier
      });
      console.log(`  ${phone.slug}: ${result.updated} updated, ${result.failed} failed`);
      if (result.updated > 0) {
        await markScorecardComplete(db, { phoneId: phone.id });
        scored++;
      } else {
        failures++;
        log.warn(
          { phone: phone.slug, updated: result.updated, failed: result.failed },
          'no aspects updated; leaving phone due for retry (not rescheduling)',
        );
      }
    } catch (err) {
      failures++;
      log.error(
        { phone: phone.slug, err: err instanceof Error ? err.message : String(err) },
        'scorecard failed',
      );
    }
  }

  console.log(`[scorecard:auto] done scored=${scored} skipped=${skipped} failures=${failures}`);
  process.exit(failures > 0 && scored === 0 && skipped === 0 ? 1 : 0);
}
```

#### [MODIFY] [package.json](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/package.json)

Add next to the existing `scorecard:run` script (~line 33):

```json
"scorecard:auto": "tsx --env-file=.env.local scripts/scorecard-auto.ts",
```

---

### 8. GitHub Actions workflow

#### [NEW] [.github/workflows/scorecard-auto.yml](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/.github/workflows/scorecard-auto.yml)

Uses the **same cron as ingestion** (`02:17 UTC`). The `next_scorecard_at` scheduling ensures phones are only scored when actually due.

```yaml
name: scorecard (auto)

on:
  schedule:
    - cron: '17 2 * * *'
  workflow_dispatch:
    inputs:
      limit:
        description: 'Max phones to score'
        required: false
        default: '20'
        type: string
      force:
        description: 'Ignore staleness guard'
        required: false
        default: 'false'
        type: boolean

concurrency:
  group: scorecard-auto
  cancel-in-progress: false

jobs:
  score:
    name: Compute scorecards
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      NODE_ENV: production
      NODE_OPTIONS: --dns-result-order=ipv4first
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      LLM_PROVIDER: gemini
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      LOG_LEVEL: info
      SKIP_ENV_VALIDATION: 'false'
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          run_install: false
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Run automated scorecard
        shell: bash
        run: |
          LIMIT="${{ github.event.inputs.limit || '20' }}"
          ARGS="--limit $LIMIT"
          if [ "${{ github.event.inputs.force }}" = "true" ]; then
            ARGS="$ARGS --force"
          fi
          pnpm exec tsx scripts/scorecard-auto.ts $ARGS
```

No Python setup, no sharding needed. Simpler than `ingest-tiered.yml`.

---

### 9. Post-ingestion hook

#### [MODIFY] [scripts/ingest-auto.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/scripts/ingest-auto.ts)

After the `markIngested(db, ...)` call (line ~273), add:

```ts
// Nudge scorecard schedule — re-score 24h after fresh ingestion
// Only bring forward, never push back a sooner deadline.
if (summary.totals.chunksWritten > 0) {
  const nudgeTarget = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db
    .update(phones)
    .set({
      nextScorecardAt: nudgeTarget,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(phones.id, phone.id),
        or(isNull(phones.nextScorecardAt), gt(phones.nextScorecardAt, nudgeTarget)),
      ),
    );
}
```

Add these imports at the top of the file:

```ts
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
// phones is already imported
```

> [!NOTE]
> The `and`, `eq`, `sql` imports likely already exist in `ingest-auto.ts` (it uses `eq` on line 206). Only add `gt` and `isNull` if not already imported.

The guard `summary.totals.chunksWritten > 0` ensures we only nudge when ingestion actually produced new evidence. If all sources were skipped/deduped, the scorecard would produce identical results — no point nudging.

---

### 10. Update scorecard index exports

#### [MODIFY] [src/services/scorecard/index.ts](file:///c:/Users/rohan/Documents/RECSY/mobile_recommender/src/services/scorecard/index.ts)

Add re-exports:

```ts
export { pickScorecardPhones, markScorecardComplete, type ScorecardPickedPhone } from './scheduler';
export { computeChunkFingerprint, getLastScorecardFingerprint } from './staleness';
```

---

## Free Tier Budget Analysis

| Resource                     | Limit      | Our usage per full run (20 phones)   | Headroom |
| ---------------------------- | ---------- | ------------------------------------ | -------- |
| Gemini structured output RPM | 15         | ~13.3 (one call per 4.5s)            | ✅ Safe  |
| Gemini embedding RPM         | 1500       | ~140 (7 per phone, burst OK)         | ✅ Safe  |
| Gemini daily requests        | 1500       | 140 structured + 140 embedding = 280 | ✅ Safe  |
| GH Actions minutes (free)    | 2000/month | ~10 min/day × 30 = 300 min           | ✅ Safe  |

**Staleness guard savings**: On a typical day, ingestion skips ~60-80% of phones (dedup). Those phones get fingerprint-skipped by the scorecard → 0 LLM calls. Realistic daily usage: **~40-60 calls**, well within limits.

---

## Potential Issues & Mitigations

| Issue                                             | Mitigation                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemini 429 rate limit                             | Per-aspect try/catch; 4.5s pacing; failed aspects retain old data; phone re-queued next cycle                                                                                                                                                                                                                                                   |
| Ingestion and scorecard cron overlap (same time)  | Not harmful — `next_scorecard_at` scheduling means most phones won't be due. Upsert is idempotent. Worst case: scorecard reads pre-ingest chunks, next run catches new ones                                                                                                                                                                     |
| Schema migration not applied                      | Schema guard (`findMissingPublicSchema`) exits 0 with warning — same pattern as `ingest-auto.ts`                                                                                                                                                                                                                                                |
| Chunks unchanged since last score                 | Chunk fingerprint guard skips → 0 LLM calls for that phone                                                                                                                                                                                                                                                                                      |
| Phone has no chunks (empty corpus)                | `runSingleAspect` writes neutral rows (`score=5.0, confidence=0.15`) without calling the LLM; `status=success` is recorded. Fingerprint stored as `''`. On subsequent runs the phone is correctly skip-guarded (`'' === ''`) until ingestion populates chunks. `scored=1 skipped=0 failures=0` on an empty-corpus phone is correct, not broken. |
| `markScorecardComplete` after scoring             | After `runScorecardForPhone`, `markScorecardComplete` runs **only if `result.updated > 0`**. If no aspect succeeded, the phone remains due; a warning is logged and the run counts as a failure for exit-code purposes (see `scripts/scorecard-auto.ts`). Partial success (`updated > 0` with some failures) still reschedules.                 |
| Staleness skip telemetry                          | On fingerprint skip, seven `scorecard_runs` rows are inserted (one per `ASPECT_NAMES` value), each `status: 'skipped'`, `skipReason: 'chunks_unchanged'`.                                                                                                                                                                                       |
| `aspect_definitions` version bumped               | Agent loads latest definitions; new version = new aspect definition ID = new upsert target. Old definition's row stays until overwritten                                                                                                                                                                                                        |
| Phone deleted mid-run                             | FK error caught by per-phone try/catch                                                                                                                                                                                                                                                                                                          |
| First-ever backfill (all 20 phones at once)       | 140 calls × 4.5s = ~10.5 min — within GH Actions 30-min timeout and free tier daily limit                                                                                                                                                                                                                                                       |
| `scorecard-run.ts` breaks from return type change | Return type goes from `{ updated }` to `{ updated, failed, fingerprint }` — backwards compatible since existing callers only destructure `updated`                                                                                                                                                                                              |

---

## File Summary

| File                                   | Action | Status  | Purpose                                                                                     |
| -------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------- |
| `src/services/db/schema.ts`            | MODIFY | ✅ Done | Add `lastScorecardAt`, `nextScorecardAt` to `phones`; add `scorecardRuns` table + relations |
| `drizzle/migrations/XXXX_*.sql`        | NEW    | ✅ Done | Auto-generated by `pnpm db:generate`                                                        |
| `src/services/scorecard/scheduler.ts`  | NEW    | ✅ Done | `pickScorecardPhones()`, `markScorecardComplete()`, `bootstrapNextScorecardAt()`            |
| `src/services/scorecard/staleness.ts`  | NEW    | ✅ Done | `computeChunkFingerprint()`, `getLastScorecardFingerprint()`                                |
| `src/services/scorecard/agent.ts`      | MODIFY | ✅ Done | Per-aspect try/catch, timing, `scorecard_runs` telemetry writes, `aspectDelayMs` pacing     |
| `src/services/scorecard/index.ts`      | MODIFY | ✅ Done | Re-export new modules                                                                       |
| `scripts/scorecard-auto.ts`            | NEW    | ✅ Done | Automated CLI entry (mirrors `ingest-auto.ts`)                                              |
| `.github/workflows/scorecard-auto.yml` | NEW    | ✅ Done | Daily cron `02:17 UTC` + manual dispatch                                                    |
| `scripts/ingest-auto.ts`               | MODIFY | ✅ Done | Post-ingest `nextScorecardAt` nudge when `chunksWritten > 0`                                |
| `package.json`                         | MODIFY | ✅ Done | Add `scorecard:auto` script                                                                 |

---

## Implementation Order

> All steps below are complete. Listed for historical reference.

1. ✅ **Schema changes** → `schema.ts` modifications + `pnpm db:generate` + apply migration
2. ✅ **New modules** → `scheduler.ts`, `staleness.ts` (no dependencies on agent changes)
3. ✅ **Agent changes** → `agent.ts` telemetry + error handling + pacing
4. ✅ **Index exports** → `index.ts` re-exports
5. ✅ **Automated script** → `scorecard-auto.ts` + `package.json` script
6. ✅ **Post-ingest hook** → `ingest-auto.ts` modification
7. ✅ **GH Actions workflow** → `scorecard-auto.yml`
8. ✅ **Verified** → local smoke test passed (see Implementation Status above)

### Remaining follow-up items

- **Scorecard only generates meaningful scores after ingestion**: the automation
  is correct and functional, but the product value (real scores vs. neutral
  5.0 placeholders) depends entirely on `pnpm ingest` having run first.

The script-level items below were **resolved in code on 2026-05-15** (see
`scripts/scorecard-auto.ts`):

- ~~`markScorecardComplete` only when `updated > 0`~~ — done.
- ~~Per-aspect `skipped` telemetry rows~~ — done (seven rows via `ASPECT_NAMES`).

---

## Verification Plan

### Local Smoke Test

```bash
# 1. Apply migration
pnpm db:generate && pnpm db:setup

# 2. Dry run — verify phone selection logic
pnpm scorecard:auto --dry-run --limit 2
# Expected: exits 0, prints due phone slugs

# 3. Real run on one phone
pnpm scorecard:auto --limit 1
# Expected: exits 0, "7 updated, 0 failed"
# If corpus is empty: neutral rows are written (score=5.0, no LLM call). That is
# correct — meaningful scores appear only after ingestion populates chunks.

# 4. Re-run immediately — picks the NEXT due phone, not the same one
pnpm scorecard:auto --limit 1
# NOTE: The previous run called markScorecardComplete which pushed that phone's
# next_scorecard_at forward by 3–7 days, so it is no longer due. The scheduler
# picks the next phone in the due queue — you will NOT see "skipped (chunks_unchanged)"
# here unless you manually reset next_scorecard_at.
#
# To verify the skip path specifically:
#   1. Reset the phone back to eligible:
#      UPDATE phones SET next_scorecard_at = NULL WHERE slug = '<slug>';
#   2. Re-run:
#      pnpm scorecard:auto --limit 1
#   Expected output: "skipped (chunks_unchanged)" (fingerprint '' matches stored '')

# 5. Force re-score — should ignore fingerprint and write neutral rows again
pnpm scorecard:auto --limit 1 --force
# Expected: same phone scored again regardless of fingerprint match

# 6. Verify existing CLI still works
pnpm scorecard:run --phone google-pixel-9-pro-xl
```

### DB Verification

```sql
-- Check scheduling columns populated
SELECT slug, last_scorecard_at, next_scorecard_at FROM phones WHERE status = 'active';

-- Check telemetry
SELECT phone_id, aspect, status, score, duration_ms, chunk_fingerprint
FROM scorecard_runs ORDER BY started_at DESC LIMIT 20;
```

### CI Verification

- Push branch and manually trigger `scorecard-auto.yml` via workflow_dispatch.
- Verify GH Actions logs show: schema guard pass → phone selection → fingerprint check → scoring with 4.5s pacing → telemetry writes → mark complete.
