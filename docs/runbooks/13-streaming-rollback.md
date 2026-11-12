# Runbook 13: Streaming Rollback & Citation Stream Repair

> **Scope:** `/api/ask` token streaming, `CitationStreamGuard`, NDJSON transport  
> **Audience:** On-call engineers, operators  
> **Trigger:** High citation repair rates, client stream decoding failures, or partial model disconnects

---

## 1. Symptoms

- **Alert / Log Metric:** Spike in `citation_stream_repair` log events or `citationRepairs > 0` in `metered_request_summary` logs.
- **Client Reports:** Users seeing truncated responses, raw unmatched citation tags (`[c:...`), or sudden client connection resets during Q&A generation.
- **Provider Outage:** LLM provider streaming API experiencing frequent mid-stream disconnections or malformed chunks.

---

## 2. Check

### 2.1 Inspect Current Performance Flags

Query the live `perf_flags` state from the database:

```sql
SELECT value FROM platform_flags WHERE key = 'perf_flags';
```

Expected output:

```json
{
  "ask_streaming": "canary",
  "admission_single_statement": true,
  "auth_local_claims": true,
  "redis_rate_limit": false
}
```

### 2.2 Inspect Citation Repair Rate

Check recent logs in Vercel / log drain:

```bash
# Filter structured logs for citation stream repairs
grep "citation_stream_repair" /path/to/logs.jsonl | jq '{time: .time, phoneId: .phoneId, tag: .rawTag}'
```

If the repair rate exceeds 2% of total streamed Q&A answers, an immediate rollback or canary down-step is required.

---

## 3. Action

### 3.1 Step 1: Emergency Rollback to Buffered Mode (`off`)

Use the operator flags endpoint to instantly disable token streaming without redeploying code.

Run this one-line command from an operator terminal:

```bash
curl -X POST https://recsy.app/api/internal/flags \
  -H "Authorization: Bearer $OPERATOR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "perf_flags",
    "value": {
      "ask_streaming": "off"
    }
  }'
```

_(Note: In `off` mode, `/api/ask` falls back to buffered execution using `chatAnswer`. The full response is generated and verified before emission, eliminating streaming syntax risks.)_

### 3.2 Step 2: Intermediate Quarantine (`shadow`)

If testing a prompt or guard update, you can set `ask_streaming: "shadow"`. In `shadow` mode, responses are delivered buffered, but `CitationStreamGuard` executes concurrently in background to record telemetry without impacting the user experience.

```bash
curl -X POST https://recsy.app/api/internal/flags \
  -H "Authorization: Bearer $OPERATOR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"key": "perf_flags", "value": {"ask_streaming": "shadow"}}'
```

---

## 4. Verify

1. **Send a Test Question:**
   Perform an anonymous ask request against the live endpoint:
   ```bash
   curl -X POST https://recsy.app/api/ask \
     -H "Content-Type: application/json" \
     -d '{
       "phoneId": "00000000-0000-4000-8000-000000000001",
       "question": "What is the battery life like on this phone?"
     }'
   ```
2. **Confirm Response Structure:**
   Verify that NDJSON events stream with full chunks (`delta`), concluding with a `done` event where `mode` is `off` or buffered.
3. **Verify Zero Repair Spikes:**
   Confirm that `citation_stream_repair` events cease in live log drains.

---

## 5. Follow-up

1. File an incident issue with prompt context and log samples of malformed citations.
2. If the model hallucinated invalid chunk IDs, examine retrieval relevance and system prompt citation instructions.
3. Once corrected, advance the flag from `off` → `shadow` (24h) → `canary` (10% internal traffic) → `on`.
