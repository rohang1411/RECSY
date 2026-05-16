# Aspect scorecard (operator notes)

Phase 4 fills `aspects` (one row per phone × latest `aspect_definitions` row per
axis). See [ADR 0006](../adr/0006-aspect-scorecard-mvp.md) for design scope and
deferrals.

## Prerequisites

- `.env.local` with `DATABASE_URL` and Gemini keys (same as chat / retrieval).
- Ingested chunks for the phone; empty retrieval produces a **neutral** score
  row (5 / low confidence) for that aspect.

## Commands

```bash
# One phone (slug from `phones.slug`)
pnpm scorecard:run --phone google-pixel-9-pro

# All phones with status = active
pnpm scorecard:run --all
```

Each full run performs **seven** hybrid searches and **seven** structured LLM
calls per phone (one per aspect). Budget accordingly on Gemini quota.

## Code map

| Path                                          | Role                                   |
| --------------------------------------------- | -------------------------------------- |
| `src/services/scorecard/agent.ts`             | Retrieve → extract → validate → upsert |
| `src/services/scorecard/query-build.ts`       | Collapse `query_prompts` → one query   |
| `src/services/scorecard/recency.ts`           | Confidence bump from cited chunk dates |
| `src/services/scorecard/extraction-schema.ts` | Zod schema for structured output       |
| `scripts/scorecard-run.ts`                    | CLI entry                              |

## UI

After rows exist, `/p/[slug]` shows **Consensus scorecard** above the chat panel.

## Automated scorecard

Since ADR 0015, scorecard generation runs as a daily batch job:

```bash
# Automated batch (respects staleness guard — skips recently scored phones)
pnpm scorecard:auto

# Force re-score all phones (ignores staleness)
pnpm scorecard:auto --force

# Dry-run (logs what would run, no DB writes)
pnpm scorecard:auto --dry-run --limit 5
```

The scheduler (`src/services/scorecard/scheduler.ts`) selects phones where `next_scorecard_at <= now()` or `null`, ordered by staleness. `src/services/scorecard/staleness.ts` derives a spec fingerprint (hash of `spec_json` + aspect definitions) so unchanged specs skip re-scoring. `scorecard_runs` records each run's outcome for telemetry.

See [ADR 0015](../adr/0015-automated-aspect-scorecard.md) for the full design.

## Code map (updated)

| Path                                          | Role                                       |
| --------------------------------------------- | ------------------------------------------ |
| `src/services/scorecard/agent.ts`             | Retrieve → extract → validate → upsert     |
| `src/services/scorecard/scheduler.ts`         | Pick stale phones, enforce staleness guard |
| `src/services/scorecard/staleness.ts`         | Fingerprint + cache-hit check              |
| `src/services/scorecard/query-build.ts`       | Collapse `query_prompts` → one query       |
| `src/services/scorecard/recency.ts`           | Confidence bump from cited chunk dates     |
| `src/services/scorecard/extraction-schema.ts` | Zod schema for structured output           |
| `scripts/scorecard-run.ts`                    | Manual CLI entry                           |
| `scripts/scorecard-auto.ts`                   | Automated batch CLI                        |
| `.github/workflows/scorecard-auto.yml`        | Daily cron (02:17 UTC)                     |

## Future work (tracked in §25 of context doc)

- Multi-query retrieval per aspect (multiple embeds + fusion).
- Z-score / price-bracket calibration; divergent `raw_score` vs `score`.
- Feedback loop: user thumbs-down → flag aspect for re-extraction.
