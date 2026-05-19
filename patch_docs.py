with open('docs/RECSY_V2_PROJECT_CONTEXT.md', 'rb') as f:
    content = f.read().decode('utf-8')

# Fix 1: Step 7 grace window -> data-availability guard (LF line endings)
old1 = (
    "   7. **Downstream automation picks up new phones** - promoted active phones have\n"
    "      `next_ingest_at = NULL`, so the existing tiered ingestion scheduler can\n"
    "      ingest them immediately. Scorecards use the catalog-created grace window\n"
    "      and normal ingest/scorecard scheduling so the recommender does not get a\n"
    "      premature neutral scorecard before evidence exists."
)
new1 = (
    "   7. **Downstream automation picks up new phones** \u2014 promoted active phones have\n"
    "      `next_ingest_at = NULL`, so the existing tiered ingest scheduler bootstraps\n"
    "      them immediately on the next cron. Scorecard is also eligible immediately\n"
    "      (`next_scorecard_at = NULL`), but the scorecard scheduler only picks phones\n"
    "      where `active_chunk_count > 0`, so it waits naturally until the first ingest\n"
    "      run completes. No artificial delay is needed \u2014 the scheduler\u2019s own\n"
    "      data-availability guard provides the gate. After ingest runs and writes\n"
    "      chunks, the 24h nudge mechanism pulls the scorecard deadline forward, so\n"
    "      aspect scores are typically available within 24\u201348h of the first ingest."
)

if old1 in content:
    content = content.replace(old1, new1, 1)
    print("step7: replaced OK")
else:
    print("step7: NOT FOUND")

# Fix 2: Bootstrap note (LF line endings, smart apostrophe)
old2 = (
    "**Bootstrap:** `bootstrapNextScorecardAt` assigns a jittered first deadline\n"
    "(~3 days, spread randomly) to phones with `next_scorecard_at IS NULL` so new\n"
    "catalog rows don\u2019t all hit the same cron."
)
new2 = (
    "**Bootstrap:** `bootstrapNextScorecardAt` assigns a jittered first deadline\n"
    "(~3 days, spread randomly) to phones with `next_scorecard_at IS NULL` so new\n"
    "catalog rows don\u2019t all hit the same cron. For phones promoted from the\n"
    "catalog pipeline, `next_scorecard_at` is left `NULL` (eligible immediately),\n"
    "but the scheduler\u2019s `active_chunk_count > 0` guard prevents it from running\n"
    "until the first ingest pass produces chunks. Scores are generated as soon as\n"
    "data is available \u2014 no artificial delay is added."
)

if old2 in content:
    content = content.replace(old2, new2, 1)
    print("bootstrap: replaced OK")
else:
    # try straight apostrophe
    old2b = old2.replace('\u2019', "'")
    new2b = new2.replace('\u2019', "'")
    if old2b in content:
        content = content.replace(old2b, new2b, 1)
        print("bootstrap (straight apostrophe): replaced OK")
    else:
        print("bootstrap: NOT FOUND either way")
        idx = content.find("bootstrapNextScorecardAt")
        if idx >= 0:
            print(repr(content[idx:idx+250]))

with open('docs/RECSY_V2_PROJECT_CONTEXT.md', 'wb') as f:
    f.write(content.encode('utf-8'))

print("Done.")
