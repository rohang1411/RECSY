# RECSY v2 Disaster Recovery Drill Runbook

> **Normative reference:** Plan 25 Section 17.2, Section 16 WP-21.  
> **Target Objectives:** Recovery Time Objective (RTO) < 30 minutes, Recovery Point Objective (RPO) < 1 hour.

---

## 1. Drill Scope & Objectives

The Disaster Recovery (DR) Drill validates RECSY v2's ability to recover from a catastrophic database loss, regional outage, or data corruption incident by restoring a full database snapshot into an isolated scratch PostgreSQL instance.

### Validation Criteria

1. **Schema & Extension Integrity:** `vector`, `pg_trgm`, `pgcrypto` installed and operational.
2. **Catalog & Vector Indexes:** HNSW cosine similarity search on `chunks.embedding` and `phones.spec_embedding` executes correctly.
3. **Multi-User Metering Tables & Functions:** All 12 multi-user tables exist; `recsy_reserve_query` and `recsy_settle_lease` execute with zero errors.
4. **Data Invariants:** Zero balance discrepancies (`credit_wallets` matches `credit_ledger`), non-negative usage counters.
5. **Least-Privilege Role:** `recsy_app` login role exists with restricted DDL and no `auth` access.

---

## 2. Step-by-Step Drill Procedure

### Step 1: Export Snapshot from Source

Export a clean snapshot of the production database using standard PostgreSQL utilities:

```bash
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --exclude-schema=auth \
  --exclude-schema=storage \
  "$DATABASE_URL" > /tmp/recsy_prod_backup.dump
```

### Step 2: Spin Up Isolated Scratch Instance

Spin up a clean local PostgreSQL 16 container with `pgvector`:

```bash
docker run -d \
  --name recsy-dr-scratch \
  -e POSTGRES_PASSWORD=scratch_secret \
  -e POSTGRES_DB=postgres \
  -p 54322:5432 \
  pgvector/pgvector:pg16
```

### Step 3: Restore Snapshot to Scratch

Restore the snapshot into the scratch container:

```bash
export SCRATCH_DB_URL="postgresql://postgres:scratch_secret@localhost:54322/postgres"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -d "$SCRATCH_DB_URL" \
  /tmp/recsy_prod_backup.dump
```

### Step 4: Run Post-Restore Acceptance Checks

Run the automated verification suite against the scratch database:

```bash
# 1. Run database smoke verification
DATABASE_URL="$SCRATCH_DB_URL" pnpm db:smoke

# 2. Run transactional metering audit
DATABASE_URL="$SCRATCH_DB_URL" pnpm metering:audit

# 3. Verify retrieval & vector search
DATABASE_URL="$SCRATCH_DB_URL" pnpm retrieval:smoke
```

### Step 5: Clean Up Scratch Instance

Tear down the temporary drill environment:

```bash
docker stop recsy-dr-scratch
docker rm recsy-dr-scratch
rm /tmp/recsy_prod_backup.dump
```

---

## 3. Drill Execution Log

| Date           | Performed By             | Duration (RTO) | Result   | Notes                                                                  |
| -------------- | ------------------------ | -------------- | -------- | ---------------------------------------------------------------------- |
| **2026-10-21** | Engineering (Pair Agent) | 4 min 12 sec   | **PASS** | 12/12 tables restored; HNSW cosine roundtrip OK; `pnpm db:smoke` clean |
