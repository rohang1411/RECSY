# Ingestion Resumability & Intelligent Retry System

> **Status**: Implemented (2026-05-15). Migration: `drizzle/migrations/0004_equal_sauron.sql`.
> **Problem statement**: LLM quota exhaustion during ingestion leaves sources in a partially-processed
> state with no DB record of the failure. Re-running the pipeline re-spends quota on sources that
> were already successfully ingested, and phones with partial quota failures may not be retried on
> the right schedule.

---

## 1. Root Cause Analysis

### 1.1 What actually happens when Gemini quota runs out

The ingestion pipeline for a single phone+adapter runs like this:

```
discover → [for each candidate]:
  fetch → chunk → disambiguate (LLM?) → curate (LLM) → embed (LLM) → write
```

When `embedAll()` throws a `RESOURCE_EXHAUSTED` / 429 error in the middle of processing a candidate:

1. The error is caught by the `catch (err)` block at the bottom of `runAdapter()`.
2. It's pushed into the in-memory `errors[]` array.
3. **No `ingest_runs` row is written** for that candidate/URL. The failure is invisible to
   the DB. Only the `discover`-level failure path writes a `ingest_runs` row today; all other
   failure paths inside the per-candidate loop rely on the writer's own catch, which is never
   reached if embed throws first.
4. The phone-level `summary.totals.errors` counter increments, but this is ephemeral.

### 1.2 When the phone IS rescheduled despite quota failures

In `ingest-auto.ts`:

```typescript
const wroteContent = summary.totals.chunksWritten > 0 || summary.totals.sourcesWritten > 0;
if (wroteContent) {
  await markIngested(db, { phoneId: phone.id, tier: phone.tier });
  // ... nudge scorecard ...
  successes += 1;
} else {
  empty += 1;
  // phone is NOT rescheduled → next_ingest_at stays at now/null
}
```

**Scenario A – all candidates fail (quota hit immediately)**: `wroteContent = false`.
The phone is NOT rescheduled. `next_ingest_at` stays null/past. The next cron picks it up
again. This part works correctly — but the re-run wastes resources re-discovering candidates
because there's no record of what was already tried.

**Scenario B – some candidates succeed before quota is hit**: `wroteContent = true`.
`markIngested` is called → phone is rescheduled to hot+3d / warm+7d / cold+14d.
The remaining failed candidates (e.g. sources 3–5 of 5) are orphaned until the phone's
next scheduled run. They have NO record in `ingest_runs`. On the next run, the pipeline
re-discovers all 5 candidates and, for sources 1–2 (already in DB), calls curator (LLM) +
embed (LLM) before the writer detects the unchanged content hash and skips. **Two LLM calls
per already-ingested source are wasted every re-run.**

### 1.3 The three concrete waste categories

| Waste type                               | Root cause                                           | When it happens                 |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| **Missing failure records**              | `ingest_runs` not written for embed/curator failures | Every quota-exhausted candidate |
| **Re-curating already-written sources**  | No pre-curator hash check against `sources` table    | Every re-run of a phone         |
| **Re-embedding already-written sources** | Curator runs before writer can short-circuit         | Every re-run of a phone         |

---

## 2. Design Principles

1. **Single source of truth in the DB.** All per-source pipeline outcomes — success, skip,
   reject, every kind of failure — must be recorded in `ingest_runs`. No ephemeral in-memory
   error counts for anything that matters to retry logic.

2. **Fail fast, fail cheap.** The cheapest check (DB read for content hash) must happen
   before the most expensive operations (LLM calls). Short-circuit before curator if the
   source hash already exists.

3. **No schema locks on re-runs.** Retry and resume logic must be additive — the same
   orchestrator codebase handles a fresh run and a resume run. A `--resume-failed` flag
   should be the only difference, not a separate code path.

4. **Classifiable errors.** `quota_exceeded` errors are retriable the next UTC day.
   `not_found` errors are permanent. Network errors may be transient. These must be
   machine-readable fields in the DB, not buried in `error` text strings.

5. **Backward compatible schema.** All new columns are nullable so existing rows remain
   valid. No backfills required.

---

## 3. Database Schema Changes

### 3.1 `ingest_runs` — new columns

Add to `src/services/db/schema.ts` inside the `ingestRuns` table definition:

```typescript
/** Which pipeline stage produced this record. */
stage: text('stage'),
// Values: 'discover' | 'fetch' | 'curator' | 'embed' | 'write' | 'phone_run'
// null on old rows.

/** Machine-readable error classification for retry routing. */
errorCode: text('error_code'),
// Values: 'quota_exceeded' | 'rate_limit' | 'network_error' | 'not_found'
//        | 'schema_error' | 'unknown'
// null on success/skip rows.

/** Earliest UTC time this source is eligible for retry. Null = eligible now. */
retryAfter: timestamp('retry_after', { withTimezone: true }),
```

Also add a composite index for the resume query pattern:

```typescript
index('ingest_runs_phone_status_stage_idx').on(t.phoneId, t.status, t.stage),
index('ingest_runs_error_code_started_idx').on(t.errorCode, t.startedAt),
```

**Why not enums?** Using `text` columns (not PG enums) for `stage` and `errorCode` avoids
requiring ALTER TYPE migrations when new stages/codes are added later. Application-layer
validation via TypeScript union types is sufficient.

### 3.2 `phones` — new column

Add to `src/services/db/schema.ts` inside the `phones` table definition:

```typescript
/**
 * Outcome of the most recent ingest attempt:
 *   'success'         — all adapters ran cleanly
 *   'partial'         — some sources written but >=1 failed (e.g. quota mid-run)
 *   'quota_exhausted' — quota hit before any source could be written
 *   'failed'          — non-quota crash
 *   null              — never attempted
 */
lastIngestStatus: text('last_ingest_status'),
```

Add index:

```typescript
index('phones_last_ingest_status_idx').on(t.lastIngestStatus),
```

### 3.3 Migration file

After adding columns to `schema.ts`, run:

```bash
pnpm db:generate
```

This generates a Drizzle migration SQL file in `drizzle/` with `ALTER TABLE` statements.
Review the generated SQL to confirm it adds only the new nullable columns, then apply:

```bash
pnpm db:migrate
```

**Do not apply the migration until all code changes are in place** (the new columns are
nullable so existing code continues to work before or after migration).

---

## 4. New TypeScript Types

### 4.1 `src/services/ingest/types.ts` — add to exports

```typescript
/** Pipeline stage that produced an ingest_runs record. */
export type IngestStage = 'discover' | 'fetch' | 'curator' | 'embed' | 'write' | 'phone_run';

/**
 * Machine-readable error category for retry routing.
 * 'quota_exceeded' → retriable after UTC day reset.
 * 'rate_limit'     → retriable after short backoff (minutes).
 * 'network_error'  → retry on next run.
 * 'not_found'      → permanent skip.
 * 'schema_error'   → LLM returned invalid output; may be transient.
 * 'unknown'        → unclassified.
 */
export type IngestErrorCode =
  | 'quota_exceeded'
  | 'rate_limit'
  | 'network_error'
  | 'not_found'
  | 'schema_error'
  | 'unknown';
```

### 4.2 Error classification utility — `src/services/ingest/error-classify.ts` (NEW FILE)

```typescript
import { NotFoundError } from '@/lib/errors';
import type { IngestErrorCode } from './types';

/**
 * Classify an ingestion error into a machine-readable code for retry routing.
 * Used when writing ingest_runs.error_code.
 */
export function classifyIngestError(err: unknown): IngestErrorCode {
  if (err instanceof NotFoundError) return 'not_found';

  const msg = err instanceof Error ? err.message : String(err);

  if (
    /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|daily request budget reached/i.test(
      msg,
    )
  ) {
    return 'quota_exceeded';
  }
  if (/rate.?limit|429|too many requests/i.test(msg)) return 'rate_limit';
  if (/network|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(msg)) {
    return 'network_error';
  }
  if (/schema.*validation|validation.*failed|ZodError/i.test(msg)) return 'schema_error';
  if (err instanceof Error && err.name === 'AI_RetryError') return 'quota_exceeded';

  return 'unknown';
}

/**
 * Compute the earliest UTC time a quota-exhausted source should be retried.
 * Returns null for non-quota errors (eligible immediately).
 */
export function computeRetryAfter(code: IngestErrorCode, from: Date = new Date()): Date | null {
  if (code !== 'quota_exceeded') return null;
  // Retry after the next UTC midnight + 5 min buffer.
  const nextUtcDay = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 5, 0),
  );
  return nextUtcDay;
}
```

---

## 5. Writer Changes — `src/services/ingest/writer.ts`

### 5.1 Update `WriteSourceInput` interface

Add optional fields:

```typescript
export interface WriteSourceInput {
  // ... existing fields ...
  /** Which pipeline stage produced this write (defaults to 'write'). */
  readonly stage?: IngestStage;
}
```

### 5.2 Update `recordRejectedRun` signature

Add `stage` and `errorCode` params:

```typescript
async recordRejectedRun(input: {
  readonly adapterName: string;
  readonly phoneId: string;
  readonly sourceUrl: string;
  readonly rejectedReason: string;
  readonly stage?: IngestStage;
  readonly errorCode?: IngestErrorCode;
  readonly retryAfter?: Date | null;
  readonly tier?: 'hot' | 'warm' | 'cold' | null;
  readonly discoveryStrategy?: string | null;
  readonly error?: string | null;
}): Promise<void>
```

Include the new fields when inserting into `ingest_runs`:

```typescript
stage: input.stage ?? 'curator',
errorCode: input.errorCode ?? null,
retryAfter: input.retryAfter ?? null,
```

### 5.3 New method: `recordFailedRun`

This method is called by the orchestrator when a candidate fails at curator, embed, or
any other pre-write stage. Currently these failures are silently dropped from the DB.

```typescript
/**
 * Record a pipeline failure that occurred BEFORE the write transaction.
 * Called when embed or other LLM steps throw — these failures are not
 * currently captured by writeSource's own catch block.
 */
async recordFailedRun(input: {
  readonly adapterName: string;
  readonly phoneId: string;
  readonly sourceUrl: string;
  readonly stage: IngestStage;
  readonly errorCode: IngestErrorCode;
  readonly error: string;
  readonly retryAfter?: Date | null;
  readonly tier?: 'hot' | 'warm' | 'cold' | null;
  readonly discoveryStrategy?: string | null;
}): Promise<void> {
  const startedAt = new Date();
  try {
    await this.db.insert(ingestRuns).values({
      adapter: input.adapterName,
      phoneId: input.phoneId,
      sourceUrl: input.sourceUrl,
      status: 'failed',
      chunksCreated: 0,
      error: input.error.slice(0, 2_000),
      stage: input.stage,
      errorCode: input.errorCode,
      retryAfter: input.retryAfter ?? null,
      tier: input.tier ?? null,
      discoveryStrategy: input.discoveryStrategy ?? null,
      startedAt,
      finishedAt: new Date(),
      durationMs: 0,
    });
  } catch (dbErr) {
    const message = dbErr instanceof Error ? dbErr.message : String(dbErr);
    this.log.warn({ url: input.sourceUrl, err: message }, 'failed to record failed ingest run');
  }
}
```

### 5.4 Update `writeSource` to pass through new fields

In the `ingest_runs` insert inside `writeSource()`, add:

```typescript
stage: 'write',
errorCode: null,
retryAfter: null,
```

And in the failure catch (bottom of `writeSource`):

```typescript
import { classifyIngestError, computeRetryAfter } from './error-classify';

// inside catch:
const errorCode = classifyIngestError(err);
await this.db.insert(ingestRuns).values({
  // ... existing fields ...
  stage: 'write',
  errorCode,
  retryAfter: computeRetryAfter(errorCode),
});
```

---

## 6. Orchestrator Changes — `src/services/ingest/orchestrator.ts`

This is the most significant change. The `runAdapter` private method needs three additions:

### 6.1 Hash pre-check before curator (avoids wasted LLM calls on re-runs)

After `adapter.fetch()` returns `raw` and before the disambiguator/curator block:

```typescript
import { eq, sql } from 'drizzle-orm';
import { sources } from '@/services/db/schema';

// ---  NEW: hash pre-check ---
// If a source with this exact content hash already exists for this phone,
// skip all LLM steps (curator + embed) — the writer will detect unchanged
// content and short-circuit anyway, but this saves 2 LLM calls per source.
const existingSource = await this.opts.db
  .select({ id: sources.id, contentHash: sources.contentHash })
  .from(sources)
  .where(sql`${sources.phoneId} = ${phone.id} AND ${sources.url} = ${candidate.url}`)
  .limit(1);

if (existingSource[0]?.contentHash === raw.contentHash) {
  // Fast-path: content unchanged. Call writeSource so it bumps lastFetchedAt
  // and appends a 'skipped/unchanged-content' ingest_run row — no LLM needed.
  const result = await this.writer.writeSource({
    phoneId: primaryPhone.id, // note: primaryPhone = phone at this point
    type: adapter.type,
    raw,
    preparedChunks: [], // empty — writer will skip if hash matches
    embeddingModel: 'unchanged',
    adapterName: adapter.type,
    tier: options.tier ?? null,
    discoveryStrategy: options.discoveryStrategy ?? null,
  });
  // result.skipped === true because hash matched
  skippedDuplicate += 1;
  log.debug({ url: candidate.url }, 'hash unchanged — skipped curator + embed');
  continue; // move to next candidate
}
// --- END hash pre-check ---
```

**Important implementation note**: The hash pre-check must happen AFTER `adapter.fetch()` gives
us `raw.contentHash`. Place it immediately after the fetch+chunk block, before any LLM calls.
The `writeSource` call in the fast-path still updates `sources.last_fetched_at` and writes
a `skipped` `ingest_runs` row, preserving the audit trail.

Actually, a slightly cleaner approach: skip the `writeSource` call in the fast-path entirely
and just log a debug message. The existing `sources` row doesn't need `last_fetched_at` bumped
every hour. This avoids a DB write in the fast path. Use whichever approach aligns with
the existing "bump lastFetchedAt" design intent in `writer.ts`.

### 6.2 Curator failure recording

Wrap the curator call in try/catch and record failures:

```typescript
import { classifyIngestError, computeRetryAfter } from './error-classify';

if (this.curator) {
  try {
    const decision = await this.curator.decide({ ... });
    // ... existing decision handling ...
    if (!decision.keep) {
      await this.writer.recordRejectedRun({
        adapterName: adapter.type,
        phoneId: primaryPhone.id,
        sourceUrl: candidate.url,
        rejectedReason: decision.rejectedReason ?? 'curator-rejected',
        stage: 'curator',
        tier: options.tier ?? null,
        discoveryStrategy: options.discoveryStrategy ?? null,
      });
      continue;
    }
  } catch (curatorErr) {
    const code = classifyIngestError(curatorErr);
    const retryAfter = computeRetryAfter(code);
    await this.writer.recordFailedRun({
      adapterName: adapter.type,
      phoneId: primaryPhone.id,
      sourceUrl: candidate.url,
      stage: 'curator',
      errorCode: code,
      error: errMsg(curatorErr),
      retryAfter,
      tier: options.tier ?? null,
      discoveryStrategy: options.discoveryStrategy ?? null,
    });
    errors.push({ url: candidate.url, error: errMsg(curatorErr) });
    log.error({ url: candidate.url, err: errMsg(curatorErr) }, 'curator failed');
    continue; // do not proceed to embed for this candidate
  }
}
```

### 6.3 Embed failure recording

Wrap the `embedder.embedAll()` call:

```typescript
let embedResult: { embeddings: number[][]; model: string };
try {
  embedResult = await this.embedder.embedAll(rawChunks.map((c) => c.text));
} catch (embedErr) {
  const code = classifyIngestError(embedErr);
  const retryAfter = computeRetryAfter(code);
  await this.writer.recordFailedRun({
    adapterName: adapter.type,
    phoneId: primaryPhone.id,
    sourceUrl: candidate.url,
    stage: 'embed',
    errorCode: code,
    error: errMsg(embedErr),
    retryAfter,
    tier: options.tier ?? null,
    discoveryStrategy: options.discoveryStrategy ?? null,
  });
  errors.push({ url: candidate.url, error: errMsg(embedErr) });
  log.error({ url: candidate.url, err: errMsg(embedErr) }, 'embed failed');
  continue;
}
const { embeddings, model: embeddingModel } = embedResult;
```

### 6.4 Disambiguator failure recording (optional but complete)

Wrap the disambiguator call similarly with `stage: 'fetch'` (it happens during the fetch
processing phase). Use the same pattern as curator above.

### 6.5 Update `OrchestratorOptions` to expose `db` for hash pre-check

The `opts.db` is already available via `OrchestratorOptions.db` — no change needed there.
However, `runAdapter` currently doesn't have access to `db` directly. Add:

```typescript
private readonly db: Db;

constructor(private readonly opts: OrchestratorOptions) {
  this.db = opts.db;
  // ... rest unchanged
}
```

Or access via `this.opts.db` everywhere inside `runAdapter`.

---

## 7. ingest-auto.ts Changes — Resume Mode

### 7.1 New CLI flag

Add `--resume-failed` boolean flag to `CliArgs` and `parseArgs()`:

```typescript
interface CliArgs {
  // ... existing fields ...
  /** When true, prioritise phones with recent quota failures before the normal schedule. */
  resumeFailed: boolean;
}

// In parseArgs():
case '--resume-failed':
  args.resumeFailed = true;
  break;
```

### 7.2 New helper: `pickResumePhones`

Add to `src/services/ingest/scheduler/pick-phones.ts` (or a new
`src/services/ingest/scheduler/pick-resume-phones.ts`):

```typescript
import { and, desc, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { ingestRuns, phones } from '@/services/db/schema';
import type { Db } from '../writer';
import type { PickedPhone } from './pick-phones';
import { classifyTier } from './tiers';

export interface PickResumePhonesOptions {
  /** Only look at failures within this window. Default: last 2 days. */
  readonly windowMs?: number;
  /** Error codes to target. Default: quota_exceeded + rate_limit. */
  readonly errorCodes?: readonly string[];
  readonly limit?: number;
  readonly shard?: number;
  readonly totalShards?: number;
}

/**
 * Returns phones that have at least one `failed` ingest_run with a
 * retriable error code in the recent window. Ordered by most failures desc
 * (phones that failed most are most urgent).
 */
export async function pickResumePhones(
  db: Db,
  opts: PickResumePhonesOptions = {},
): Promise<PickedPhone[]> {
  const windowMs = opts.windowMs ?? 2 * 24 * 60 * 60 * 1000;
  const errorCodes = opts.errorCodes ?? ['quota_exceeded', 'rate_limit'];
  const since = new Date(Date.now() - windowMs);

  // Find distinct phone IDs with recent retriable failures.
  const failedRows = await db
    .selectDistinct({ phoneId: ingestRuns.phoneId })
    .from(ingestRuns)
    .where(
      and(
        sql`${ingestRuns.status} = 'failed'`,
        inArray(sql`${ingestRuns.errorCode}`, errorCodes),
        gte(ingestRuns.startedAt, since),
        isNotNull(ingestRuns.phoneId),
      ),
    );

  if (failedRows.length === 0) return [];

  const phoneIds = failedRows.map((r) => r.phoneId!);

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
    })
    .from(phones)
    .where(inArray(phones.id, phoneIds));

  const totalShards = Math.max(1, opts.totalShards ?? 1);
  const shard = opts.shard ?? 0;
  const { shardIndex } = await import('./pick-phones');

  return rows
    .filter((r) => shardIndex(r.id, totalShards) === shard)
    .slice(0, opts.limit ?? 50)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      brand: r.brand,
      model: r.model,
      launchDate: r.launchDate ? r.launchDate.toISOString().slice(0, 10) : null,
      tier: classifyTier(r.launchDate ?? null),
      lastIngestAt: r.lastIngestAt,
      nextIngestAt: r.nextIngestAt,
    }));
}
```

### 7.3 New helper: `getFailedCandidatesForPhone`

Add to `src/services/ingest/scheduler/pick-resume-phones.ts`:

```typescript
import type { SourceType } from '../types';

export interface FailedCandidate {
  readonly sourceUrl: string;
  readonly adapter: string;
  readonly stage: string;
  readonly errorCode: string;
}

/**
 * Returns source URLs that failed for a given phone in a recent window.
 * Used to pass as `candidatesByType` to the orchestrator, bypassing
 * re-discovery for sources we already know need to be retried.
 */
export async function getFailedCandidatesForPhone(
  db: Db,
  phoneId: string,
  opts: { windowMs?: number; errorCodes?: readonly string[] } = {},
): Promise<FailedCandidate[]> {
  const windowMs = opts.windowMs ?? 2 * 24 * 60 * 60 * 1000;
  const errorCodes = opts.errorCodes ?? ['quota_exceeded', 'rate_limit'];
  const since = new Date(Date.now() - windowMs);

  const rows = await db
    .select({
      sourceUrl: ingestRuns.sourceUrl,
      adapter: ingestRuns.adapter,
      stage: ingestRuns.stage,
      errorCode: ingestRuns.errorCode,
    })
    .from(ingestRuns)
    .where(
      and(
        sql`${ingestRuns.phoneId} = ${phoneId}`,
        sql`${ingestRuns.status} = 'failed'`,
        inArray(sql`${ingestRuns.errorCode}`, errorCodes),
        gte(ingestRuns.startedAt, since),
        isNotNull(ingestRuns.sourceUrl),
      ),
    );

  return rows
    .filter((r) => r.sourceUrl !== null)
    .map((r) => ({
      sourceUrl: r.sourceUrl!,
      adapter: r.adapter,
      stage: r.stage ?? 'unknown',
      errorCode: r.errorCode ?? 'unknown',
    }));
}
```

### 7.4 Wire resume mode into `ingest-auto.ts` main loop

In `main()`, after building `adapters` and `orchestrator`, before the normal `pickPhones` call:

```typescript
let phonesQueue: PickedPhone[];

if (args.resumeFailed) {
  // Resume mode: prioritise phones with recent quota failures.
  const resumePhones = await pickResumePhones(db, {
    limit: args.limit,
    shard: args.shard,
    totalShards: args.totalShards,
  });

  if (resumePhones.length === 0) {
    console.log(
      '[ingest:auto] --resume-failed: no retriable failures found; falling back to normal schedule',
    );
    phonesQueue = await pickPhones(db, {
      tiers,
      limit: args.limit,
      shard: args.shard,
      totalShards: args.totalShards,
    });
  } else {
    console.log(
      `[ingest:auto] --resume-failed: found ${resumePhones.length} phones with quota failures to retry`,
    );
    // Also pull normal due phones, appending them after the resume set (deduplicated by id).
    const normalPhones = await pickPhones(db, {
      tiers,
      limit: Math.max(0, args.limit - resumePhones.length),
      shard: args.shard,
      totalShards: args.totalShards,
    });
    const seenIds = new Set(resumePhones.map((p) => p.id));
    const merged = [...resumePhones, ...normalPhones.filter((p) => !seenIds.has(p.id))];
    phonesQueue = merged.slice(0, args.limit);
  }
} else {
  phonesQueue = await pickPhones(db, {
    tiers,
    limit: args.limit,
    shard: args.shard,
    totalShards: args.totalShards,
  });
}
```

For phones in the resume set, pass the known-failed source URLs as direct candidates:

```typescript
for (const phone of phonesQueue) {
  const isResume = args.resumeFailed && resumePhoneIds.has(phone.id);
  let candidatesByType: Partial<Record<SourceType, SourceCandidate[]>> | undefined;

  if (isResume) {
    const failed = await getFailedCandidatesForPhone(db, phone.id);
    if (failed.length > 0) {
      // Group by adapter and build minimal SourceCandidate objects from the URLs.
      // The adapter's fetch() will hydrate the full body; we only need url+title here.
      candidatesByType = {};
      for (const fc of failed) {
        const type = fc.adapter as SourceType;
        if (!candidatesByType[type]) candidatesByType[type] = [];
        candidatesByType[type]!.push({
          url: fc.sourceUrl,
          title: fc.sourceUrl, // placeholder; will be overwritten by fetch
          author: null,
          channel: null,
          language: 'en',
          publishedAt: null,
          raw: {},
        });
      }
      log.info(
        { phone: phone.slug, candidateCount: failed.length },
        'resume: injecting known-failed candidates',
      );
    }
  }

  const summary = await orchestrator.ingestPhone(
    {
      id: phone.id,
      slug: phone.slug,
      brand: phone.brand,
      model: phone.model,
      launchDate: phone.launchDate,
    },
    {
      discover: { limit: args.perPhoneLimit },
      candidatesByType, // null for normal runs; set for resume runs
      dryRun: args.dryRun,
      tier: phone.tier,
      discoveryStrategy: isResume ? 'resume' : 'tiered',
    },
  );
  // ... rest of phone processing loop unchanged
}
```

### 7.5 Update `phones.last_ingest_status` after each phone run

At the end of the phone processing block in `ingest-auto.ts`, after computing `wroteContent`:

```typescript
const hasQuotaFailures = summary.adapters.some((a) =>
  a.errors.some((e) => /quota|RESOURCE_EXHAUSTED/i.test(e.error)),
);
const lastIngestStatus: string =
  !wroteContent && hasQuotaFailures
    ? 'quota_exhausted'
    : !wroteContent && summary.totals.errors > 0
      ? 'failed'
      : wroteContent && summary.totals.errors > 0
        ? 'partial'
        : wroteContent
          ? 'success'
          : 'failed';

if (!args.dryRun) {
  await db
    .update(phones)
    .set({ lastIngestStatus, updatedAt: sql`now()` })
    .where(eq(phones.id, phone.id));
}
```

---

## 8. New GitHub Actions Workflow

### 8.1 `.github/workflows/ingest-resume.yml`

```yaml
# =============================================================================
# Ingestion resume workflow.
#
# Runs ~1h after the main ingestion cron (03:20 UTC) to retry phones that
# failed due to Gemini quota exhaustion the previous night. Can also be
# triggered manually to force a retry pass.
# =============================================================================
name: ingest (resume)

on:
  schedule:
    - cron: '20 3 * * *' # 03:20 UTC — 1h after main ingest
  workflow_dispatch:
    inputs:
      limit:
        description: 'Max phones per shard'
        required: false
        default: '20'
        type: string

concurrency:
  group: ingest-resume-${{ github.run_id }}
  cancel-in-progress: false

jobs:
  secrets-gate:
    name: Check pipeline secrets
    runs-on: ubuntu-latest
    outputs:
      configured: ${{ steps.check.outputs.configured }}
    steps:
      - id: check
        shell: bash
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
        run: |
          if [ -n "$GEMINI_API_KEY" ] && [ -n "$DATABASE_URL" ] && \
             [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] && \
             [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then
            echo "configured=true" >> "$GITHUB_OUTPUT"
          else
            echo "configured=false" >> "$GITHUB_OUTPUT"
          fi

  resume:
    name: ingest (resume) shard=${{ matrix.shard }}
    needs: secrets-gate
    if: needs.secrets-gate.outputs.configured == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      max-parallel: 4
      matrix:
        shard: [0, 1, 2, 3]
    env:
      NODE_ENV: production
      NODE_OPTIONS: --dns-result-order=ipv4first
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      LLM_PROVIDER: gemini
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      GEMINI_API_KEY_2: ${{ secrets.GEMINI_API_KEY_2 }}
      GEMINI_API_KEY_3: ${{ secrets.GEMINI_API_KEY_3 }}
      YTDLP_COOKIES_BASE64: ${{ secrets.YTDLP_COOKIES_BASE64 }}
      YTDLP_PROXY: ${{ secrets.YTDLP_PROXY }}
      YTDLP_EXTRACTOR_ARGS: ${{ secrets.YTDLP_EXTRACTOR_ARGS }}
      YTDLP_SLEEP_REQUESTS_SECONDS: '3'
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

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install transcript fallback tools
        run: python -m pip install --disable-pip-version-check --upgrade yt-dlp youtube-transcript-api

      - name: Run resume ingestion
        shell: bash
        run: |
          LIMIT="${{ github.event.inputs.limit || '20' }}"
          pnpm exec tsx scripts/ingest-auto.ts \
            --tier all \
            --limit "$LIMIT" \
            --resume-failed \
            --shard "${{ matrix.shard }}" \
            --total-shards 4
```

---

## 9. Updated ingest-report.ts — Resume Observability

Add a new section to `scripts/ingest-report.ts` after the existing "Phones overdue" section:

```typescript
hr('Retriable failures (quota / rate-limit) — last window');
const quotaFailed = await db
  .select({
    phoneSlug: phones.slug,
    adapter: ingestRuns.adapter,
    stage: ingestRuns.stage,
    errorCode: ingestRuns.errorCode,
    n: sql<number>`count(*)::int`,
    latestAt: sql<string>`max(${ingestRuns.startedAt})::text`,
  })
  .from(ingestRuns)
  .leftJoin(phones, eq(ingestRuns.phoneId, phones.id))
  .where(
    and(
      gte(ingestRuns.startedAt, since),
      sql`${ingestRuns.status} = 'failed'`,
      sql`${ingestRuns.errorCode} in ('quota_exceeded', 'rate_limit')`,
    ),
  )
  .groupBy(phones.slug, ingestRuns.adapter, ingestRuns.stage, ingestRuns.errorCode)
  .orderBy(desc(sql<number>`count(*)`))
  .limit(20);

if (quotaFailed.length === 0) {
  console.log('  (none — no quota failures this window)');
} else {
  for (const r of quotaFailed) {
    console.log(
      `  ${pad(r.phoneSlug ?? 'unknown', 36)} ${pad(r.adapter, 12)} stage=${pad(r.stage ?? '?', 8)} ` +
        `code=${pad(r.errorCode ?? '?', 16)} n=${r.n}  last=${r.latestAt?.slice(0, 16)}`,
    );
  }
}

hr('phones.last_ingest_status distribution');
const statusDist = await db
  .select({
    status: phones.lastIngestStatus,
    n: sql<number>`count(*)::int`,
  })
  .from(phones)
  .where(eq(phones.status, 'active'))
  .groupBy(phones.lastIngestStatus)
  .orderBy(desc(sql<number>`count(*)`));
for (const r of statusDist) {
  console.log(`  ${pad(r.status ?? 'null', 18)} phones=${r.n}`);
}
```

---

## 10. Implementation Order (Phases)

Implement in this exact sequence. Each phase is independently deployable and testable.
Do NOT skip ahead — later phases depend on earlier ones being correct.

### Phase 1 — Schema + migration (DB-only, no logic change)

**Files changed**:

- `src/services/db/schema.ts` — add `stage`, `errorCode`, `retryAfter` to `ingestRuns`;
  add `lastIngestStatus` to `phones`
- Run `pnpm db:generate` → review generated migration → commit migration file
- Run `pnpm db:migrate` (or apply via Supabase dashboard)

**Verification**: `pnpm db:smoke` passes. Confirm new columns exist via a raw SQL check:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ingest_runs' AND column_name IN ('stage', 'error_code', 'retry_after');
```

### Phase 2 — Error classification utility (new file, no downstream wiring yet)

**Files changed**:

- `src/services/ingest/error-classify.ts` — new file (pure functions, no side effects)
- `src/services/ingest/types.ts` — add `IngestStage` and `IngestErrorCode` exports

**Verification**: `pnpm test` — write a unit test in
`src/services/ingest/error-classify.test.ts` that:

- Verifies a `RESOURCE_EXHAUSTED` error → `'quota_exceeded'`
- Verifies a `NotFoundError` → `'not_found'`
- Verifies `computeRetryAfter('quota_exceeded')` returns a timestamp in the next UTC day
- Verifies `computeRetryAfter('not_found')` returns `null`

### Phase 3 — Writer changes (surface new columns, add `recordFailedRun`)

**Files changed**:

- `src/services/ingest/writer.ts` — add `recordFailedRun`, update `recordRejectedRun`
  signature, pipe new fields through `writeSource`'s existing `ingest_runs` inserts

**Verification**: Writer unit tests pass. Confirm `recordFailedRun` writes a row with
`status='failed'`, correct `stage`, `errorCode`, `retryAfter`. Confirm `writeSource`
still writes `stage='write'` and `errorCode=null` on success.

### Phase 4 — Orchestrator changes (hash pre-check + failure recording)

**Files changed**:

- `src/services/ingest/orchestrator.ts` — add hash pre-check before curator, wrap
  curator call, wrap embed call, all three using the new `classifyIngestError` +
  `writer.recordFailedRun`

**Verification**:

1. Run `pnpm ingest:auto --tier hot --limit 1 --dry-run` — confirms no crash.
2. Run `pnpm ingest:auto --tier hot --limit 1` — inspect `ingest_runs` in DB; every
   processed source URL should now have a row with `stage` populated.
3. Immediately re-run the same command — verify the second run produces ZERO curator/embed
   calls for sources already in `sources` with the same hash (check logs for
   `hash unchanged — skipped curator + embed` messages, or count LLM calls via governor).

### Phase 5 — ingest-auto.ts resume mode + lastIngestStatus updates

**Files changed**:

- `src/services/ingest/scheduler/pick-resume-phones.ts` — new file
- `src/services/ingest/scheduler/index.ts` — re-export new functions
- `src/services/ingest/index.ts` — re-export if needed
- `scripts/ingest-auto.ts` — `--resume-failed` flag, phone loop update for
  `candidatesByType` injection, `lastIngestStatus` update

**Verification**:

1. With known quota failures in DB: `pnpm ingest:auto --resume-failed --dry-run --limit 5`
   → confirm it picks the failed phones, not the normal scheduled set.
2. After a real run where some sources fail: check `phones.last_ingest_status` is set to
   `'partial'` or `'quota_exhausted'` as expected.

### Phase 6 — GitHub Actions workflow

**Files changed**:

- `.github/workflows/ingest-resume.yml` — new file

**Verification**: Trigger `workflow_dispatch` manually from GitHub Actions UI → confirm
it runs without error, picks up any quota failures from the previous night.

### Phase 7 — ingest-report updates

**Files changed**:

- `scripts/ingest-report.ts` — new sections for quota failures and status distribution

**Verification**: `pnpm ingest:report` — new sections appear without errors.

---

## 11. Edge Cases & Potential Issues

### 11.1 Hash pre-check returning stale data

**Problem**: The `sources` table is checked before curator, but if the source was
previously written for a _different_ adapter run (different `phoneId`, e.g. after a
disambiguator reassignment), the pre-check query keyed on `(phoneId, url)` would miss it.

**Resolution**: The query is `WHERE phoneId = X AND url = Y`. This is the same key the
writer uses for the upsert conflict target. They are consistent by design. If the
disambiguator reassigns the primary phone, the new `phoneId` is the one passed to the
pre-check — the same one that the writer would use. No inconsistency.

### 11.2 Resume injecting candidates whose URLs are now gone (404)

**Problem**: A URL failed at `embed` stage last night. We inject it as a candidate today.
The adapter's `fetch()` returns 404. The orchestrator's outer catch handles `NotFoundError`
→ `skippedUnusable += 1`. A new `ingest_runs` row is written with `status='failed'`,
`errorCode='not_found'`. Future resume queries will still find this URL (it's still
`status='failed'`) unless we filter on `retryAfter`.

**Resolution**: In `getFailedCandidatesForPhone`, add a `retryAfter` filter:

```typescript
or(isNull(ingestRuns.retryAfter), lte(ingestRuns.retryAfter, new Date()));
```

This ensures permanently-failed (null retryAfter but `not_found`) URLs aren't re-injected
on every resume run. Actually, for `not_found` errors, `computeRetryAfter` returns `null`
(immediately retriable) — which means they WILL be retried. That's probably fine for one
retry. To avoid infinite loops, track `attempts` or use the `retryAfter` approach: set
`retryAfter = far_future` for `not_found` so they're not re-queued. Alternatively, only
resume `quota_exceeded` and `rate_limit` errors, not `not_found`.

**Preferred fix**: In `pickResumePhones` and `getFailedCandidatesForPhone`, default
`errorCodes` to `['quota_exceeded', 'rate_limit']` only (exclude `not_found`, `unknown`).
`not_found` failures are permanent and don't benefit from resume.

### 11.3 Double-recording failures

**Problem**: If `recordFailedRun` is called for a candidate and then the catch block in
the outer `runAdapter` loop also runs some recording logic, we might double-record.

**Resolution**: The new try/catch blocks for curator and embed use `continue` to skip to
the next candidate after recording. They never fall through to the outer catch. The outer
catch remains as the backstop for errors from `adapter.fetch()` and `adapter.chunk()`.
There is no double-recording path.

### 11.4 DB unavailability inside `recordFailedRun`

**Problem**: If the DB is down when `recordFailedRun` is called, the failure is silently
swallowed (matching the existing pattern in `recordRejectedRun`).

**Resolution**: The method already has a try/catch that logs a warn and continues. This is
acceptable — the primary operation (ingestion) should not fail because the audit trail
couldn't be written. Keep the existing pattern.

### 11.5 Migration on a production database with high traffic

**Problem**: Adding nullable columns to `phones` and `ingest_runs` on a Postgres database
with active reads/writes may briefly lock rows.

**Resolution**: Both `ALTER TABLE ... ADD COLUMN` statements add nullable columns with
no default value computation (`DEFAULT` expressions on existing rows). In Postgres 11+
this is a metadata-only operation (no table rewrite) and takes milliseconds even on large
tables. Safe to run during normal operations.

### 11.6 Resume injecting candidates for phones rescheduled to the future

**Problem**: If a phone has `next_ingest_at = tomorrow` (it was partially successful
last night), but also has quota failures, `pickResumePhones` will return it regardless
of `next_ingest_at`. The phone gets processed today even though it was "rescheduled".

**Resolution**: This is intentional and desirable. The resume workflow specifically exists
to complete the partial work from the previous night. The rescheduling only applies to the
_successful_ sources; the failed ones need to be retried. When the resume run completes
successfully, `markIngested` will be called and will push `next_ingest_at` forward from
today, overwriting yesterday's rescheduling.

**Caution**: If the resume run ALSO fails (quota still exhausted), `markIngested` won't
be called for that phone and it'll remain due for the resume workflow again tomorrow. This
is correct behavior — keep retrying until it succeeds or permanently fails.

### 11.7 `candidatesByType` titles are placeholders

**Problem**: When injecting known-failed URLs as candidates, the `title` field is set to
the URL string (a placeholder) because we don't have the original title. The writer
writes this placeholder title to `sources.title`.

**Resolution**: Look up the existing `ingest_runs` row for context. Actually, the best
resolution is: the adapter's `fetch()` will return a `SourceCandidate` with the proper
title embedded in `raw.candidate.title` (the adapter hydrates this from the fetched
content). The injected `SourceCandidate` only needs a valid URL and a non-empty title
string — the title from a previous run is not needed because the `sources` upsert will
overwrite it with the freshly fetched title. The placeholder title `"<url>"` is never
read because the writer uses `raw.candidate.title` not the injected candidate title.

Wait — actually, looking at `orchestrator.ts`: the `candidatesByType` candidates are
used _directly_ as the `candidate` variable in the loop body. They are passed to
`adapter.fetch(candidate)` which uses `candidate.url` to fetch. The returned `raw`
object contains `raw.candidate` which is the ORIGINAL candidate (with the injected title).
Then `writeSource` uses `raw.candidate.title` for the `sources.title` column. So yes,
the injected placeholder title would be persisted.

**Fix**: In `getFailedCandidatesForPhone`, also query the `sources` table for the original
title:

```typescript
// In getFailedCandidatesForPhone query:
.leftJoin(sources, and(eq(sources.phoneId, phoneId), eq(sources.url, ingestRuns.sourceUrl)))
// Include: title: sources.title
```

Then populate `title: row.title ?? row.sourceUrl` in the returned `FailedCandidate`.

Alternatively, since the orchestrator calls `adapter.fetch(candidate)` which returns a
`RawSource` with `raw.candidate = candidate` (the passed-in candidate), the adapter doesn't
re-hydrate the title from the fetched content — it uses what was passed in. This means the
placeholder title WILL be persisted if the source doesn't already exist in `sources`.

If the source DID exist (hash pre-check), we skip the whole path. If it DIDN'T exist
(embed failed, so source was never written), then on resume we need the real title.
Query the title from a prior `ingest_runs` or store it on the failure record.

**Simpler fix**: Store `title` on the `ingest_runs` row. Add `candidateTitle: text('candidate_title')`
to `ingest_runs`. Set it when recording a failure. Use it when injecting resume candidates.
OR: just accept that on the first resume run, the title might be the URL string. On the
second run (if the resume run succeeds), the source will be in `sources` already and the
hash pre-check will take the fast path — so the title placeholder is only written once and
only if the first resume attempt fails. Acceptable trade-off given the complexity of the
alternative.

**Recommended**: Add `candidateTitle: text('candidate_title')` to `ingest_runs` as Phase 1.5
(add column). Set it in `recordFailedRun`. Use it in `getFailedCandidatesForPhone`.

### 11.8 LLM cache interaction

The system has an `llm_cache` table. Curator calls for the same source content may be
cached after the first call. This means curator is sometimes near-free on re-runs even
without the hash pre-check. However:

1. Cache hits depend on exact prompt hashes; the phone context (slug, brand, model) is
   part of the prompt, making cache hits less likely across different phones.
2. The cache only helps curator, not embed. Embed calls are currently NOT cached.
3. The hash pre-check is still worth implementing as it's a single DB read that avoids
   both curator + embed calls with certainty.

### 11.9 `ingest_runs` table growth

Adding failure records for every quota-failed embed will increase the number of rows in
`ingest_runs`. Previously, only sources that passed curator got a row (either success or
skip). Now every failed embed/curator also gets a row.

**Estimate**: If 20 phones × 5 candidates × 3 adapters = 300 candidates per run,
and 30% fail due to quota → 90 new failure rows per night's run. Over 30 days = ~2,700
rows. The table likely already has thousands of rows; this growth rate is minimal.

**Long-term**: Consider a `pg_cron` cleanup job to delete `ingest_runs` rows older than
90 days with `status = 'skipped'` or `status = 'failed'` that have a `retryAfter` in
the past (already past their retry window). This keeps the table lean. Out of scope for
this implementation plan but worth noting.

---

## 12. File Summary

| File                                                  | Change type                                                             | Phase |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ----- |
| `src/services/db/schema.ts`                           | Modify — add columns to `ingestRuns` and `phones`                       | 1     |
| `drizzle/<timestamp>_migration.sql`                   | Generated — run `pnpm db:generate`                                      | 1     |
| `src/services/ingest/types.ts`                        | Modify — add `IngestStage`, `IngestErrorCode` types                     | 2     |
| `src/services/ingest/error-classify.ts`               | **New** — `classifyIngestError`, `computeRetryAfter`                    | 2     |
| `src/services/ingest/error-classify.test.ts`          | **New** — unit tests for error classification                           | 2     |
| `src/services/ingest/writer.ts`                       | Modify — `recordFailedRun`, update `recordRejectedRun`, pipe new fields | 3     |
| `src/services/ingest/orchestrator.ts`                 | Modify — hash pre-check, curator/embed failure recording                | 4     |
| `src/services/ingest/scheduler/pick-resume-phones.ts` | **New** — `pickResumePhones`, `getFailedCandidatesForPhone`             | 5     |
| `src/services/ingest/scheduler/index.ts`              | Modify — re-export new scheduler functions                              | 5     |
| `src/services/ingest/index.ts`                        | Modify — re-export if needed                                            | 5     |
| `scripts/ingest-auto.ts`                              | Modify — `--resume-failed` flag, phone loop, `lastIngestStatus` write   | 5     |
| `.github/workflows/ingest-resume.yml`                 | **New** — daily 03:20 UTC resume cron                                   | 6     |
| `scripts/ingest-report.ts`                            | Modify — quota failures section + status distribution                   | 7     |

---

## 13. Quick Verification Queries

After full implementation, use these queries to verify the system health:

```sql
-- 1. How many sources per stage/status in the last 24h?
SELECT stage, status, error_code, count(*) AS n
FROM ingest_runs
WHERE started_at > now() - interval '24 hours'
GROUP BY stage, status, error_code
ORDER BY n DESC;

-- 2. Phones with quota failures needing resume
SELECT p.slug, p.last_ingest_status, count(ir.id) AS failed_sources
FROM phones p
JOIN ingest_runs ir ON ir.phone_id = p.id
WHERE ir.status = 'failed'
  AND ir.error_code = 'quota_exceeded'
  AND ir.started_at > now() - interval '2 days'
GROUP BY p.slug, p.last_ingest_status
ORDER BY failed_sources DESC;

-- 3. Confirm hash pre-check is working (re-run savings)
SELECT source_url, count(*) AS skips
FROM ingest_runs
WHERE status = 'skipped'
  AND rejected_reason = 'unchanged-content'
  AND started_at > now() - interval '7 days'
GROUP BY source_url
ORDER BY skips DESC
LIMIT 20;

-- 4. last_ingest_status distribution across active phones
SELECT last_ingest_status, count(*) AS phones
FROM phones
WHERE status = 'active'
GROUP BY last_ingest_status
ORDER BY phones DESC;
```

---

## 14. Open Questions / Decisions Needed Before Implementation

1. **Should the hash pre-check call `writeSource` (to bump `lastFetchedAt`)** or just
   silently `continue`? The current writer design bumps `lastFetchedAt` on unchanged-content
   as an audit trail. The pre-check version would save one DB write by skipping `writeSource`
   entirely. Trade-off: audit completeness vs. DB write reduction.
   **Recommendation**: Call `writeSource` in the fast-path to maintain consistent audit trail.

2. **`candidateTitle` column on `ingest_runs`**: Is it worth adding for resume correctness
   (§11.7), or accept that the first resume run may persist the URL as the source title?
   **Recommendation**: Add the column (Phase 1.5) since it's a one-line schema addition and
   avoids confusing data in `sources.title`.

3. **`retryAfter` filter in `getFailedCandidatesForPhone`**: Should we filter out candidates
   whose `retryAfter` is still in the future? On the daily resume run (03:20 UTC), any
   `quota_exceeded` failures from the previous night (02:17 UTC) will have `retryAfter`
   set to today's UTC midnight which has already passed — so they will be included. This
   is the expected behavior.

4. **Should `--resume-failed` be the default behavior** (always check for quota failures
   before running normal schedule) rather than an opt-in flag? This would simplify the
   workflow (no separate ingest-resume.yml needed) but increases each run's startup time
   by one extra query. **Recommendation**: Keep it as an explicit flag / separate workflow
   for now; can be merged into the default later.
