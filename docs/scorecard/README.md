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

## Future work (not MVP)

- Multi-query retrieval per aspect (multiple embeds + fusion).
- Z-score / price-bracket calibration; divergent `raw_score` vs `score`.
- Scheduled `pg_cron` job (pattern TBD alongside ingestion cron).
