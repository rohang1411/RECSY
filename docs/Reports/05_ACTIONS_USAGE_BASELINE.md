# GitHub Actions Usage & Cost Baseline Report

> **Report Date:** 2026-11-13  
> **Observation Window:** Last 14 days  
> **Baseline Status:** ⚠️ **Provisional** (post-PR-82 green run accumulation in progress)  
> **Accounting Model:** Per GitHub Actions billing specification: each non-skipped job duration is rounded up to the next integer minute. Actual billed minutes on a public repository are $0, but this report measures true execution consumption as if private.

---

## 1. Executive Summary

| Metric                                              | Measured Value   |
| :-------------------------------------------------- | :--------------- |
| **Total Workflow Runs Analyzed**                    | **331**          |
| **Measured Billed Minutes (14d Window)**            | **1,195 min**    |
| **Extrapolated Billed Minutes / Month (30d)**       | **2,559 min/mo** |
| **Nominal Unconstrained Baseline (Plan 30 v1.0.0)** | 17,326 min/mo    |

---

## 2. Per-Workflow Measured Baseline

| Workflow                   | Cron                  | Runs    | Sched Runs | Median Gap | Sched Delay (p50 / p90) | Billed/Run (p50 / p90) | Total Mins | Extrapolated min/mo |
| :------------------------- | :-------------------- | :------ | :--------- | :--------- | :---------------------- | :--------------------- | :--------- | :------------------ |
| `abuse-detect.yml`         | `0 3 * * *`           | 14      | 14         | 24.0 h     | 439m / 465m             | 1m / 1m                | 14         | 30                  |
| `account-maintenance.yml`  | `0 2 * * *`           | 14      | 14         | 24.1 h     | 419m / 445m             | 1m / 1m                | 15         | 32                  |
| `billing-reconcile.yml`    | `*/30 * * * *`        | 53      | 53         | 6.2 h      | 16m / 26m               | 1m / 1m                | 53         | 114                 |
| `catalog-images.yml`       | `17 6 * * *`          | 14      | 14         | 24.1 h     | 490m / 594m             | 2m / 2m                | 28         | 60                  |
| `catalog-refresh.yml`      | `17 1 * * 1`          | 3       | 3          | 22.5 h     | 403m / 9115m            | 7m / 9m                | 22         | 47                  |
| `ci.yml`                   | —                     | 9       | 0          | —          | —                       | 9m / 10m               | 79         | 169                 |
| `creator-watch.yml`        | `23 */6 * * *`        | 33      | 33         | 10.7 h     | 77m / 334m              | 2m / 2m                | 69         | 148                 |
| `db-migrate.yml`           | —                     | 0       | 0          | —          | —                       | 0m / 0m                | 0          | 0                   |
| `db-tests.yml`             | —                     | 9       | 0          | —          | —                       | 1m / 1m                | 9          | 19                  |
| `ingest-on-new-phone.yml`  | —                     | 0       | 0          | —          | —                       | 0m / 0m                | 0          | 0                   |
| `ingest-resume.yml`        | `20 3 * * *`          | 14      | 14         | 24.0 h     | 468m / 489m             | 14m / 16m              | 220        | 471                 |
| `ingest-tiered.yml`        | `17 2 * * *`          | 13      | 13         | 24.1 h     | 437m / 459m             | 10m / 16m              | 138        | 296                 |
| `ingest.yml`               | —                     | 0       | 0          | —          | —                       | 0m / 0m                | 0          | 0                   |
| `keepalive.yml`            | `0 0 * * 0`           | 2       | 2          | 168.1 h    | 275m / 278m             | 1m / 1m                | 2          | 4                   |
| `metering-maintenance.yml` | `*/15 * * * *`        | 56      | 56         | 5.9 h      | 9m / 14m                | 1m / 1m                | 57         | 122                 |
| `ops-alerts.yml`           | `*/5 * * * *`         | 57      | 57         | 6.1 h      | 3m / 4m                 | 1m / 1m                | 57         | 122                 |
| `scorecard-auto.yml`       | `17 4,10,16,22 * * *` | 39      | 39         | 9.6 h      | 192m / 330m             | 12m / 23m              | 430        | 921                 |
| `source-watch.yml`         | `23 */6 * * *`        | 1       | 1          | —          | 35m / 35m               | 2m / 2m                | 2          | 4                   |
| **Total / Summary**        | —                     | **331** | —          | —          | —                       | —                      | **1195**   | **2559**            |

---

## 3. Workflow Details & Conclusions

### `abuse-detect.yml` (Abuse Detection)

- **Schedule:** `0 3 * * *`
- **Total Runs in Window:** 14
- **Events:** schedule: 14
- **Conclusions:** failure: 14
- **Scheduled Delivery:** 14 runs, median gap between runs: 24.0 h
- **Schedule Delay from Slot:** median 439 min, p90 465 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 1m
- **Extrapolated Monthly Consumption:** 30 min/mo

### `account-maintenance.yml` (Account Maintenance)

- **Schedule:** `0 2 * * *`
- **Total Runs in Window:** 14
- **Events:** schedule: 14
- **Conclusions:** success: 1, failure: 13
- **Scheduled Delivery:** 14 runs, median gap between runs: 24.1 h
- **Schedule Delay from Slot:** median 419 min, p90 445 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.1m, max 2m
- **Extrapolated Monthly Consumption:** 32 min/mo

### `billing-reconcile.yml` (Billing Reconciliation)

- **Schedule:** `*/30 * * * *`
- **Total Runs in Window:** 53
- **Events:** schedule: 53
- **Conclusions:** failure: 53
- **Scheduled Delivery:** 53 runs, median gap between runs: 6.2 h
- **Schedule Delay from Slot:** median 16 min, p90 26 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 1m
- **Extrapolated Monthly Consumption:** 114 min/mo

### `catalog-images.yml` (catalog images (backfill))

- **Schedule:** `17 6 * * *`
- **Total Runs in Window:** 14
- **Events:** schedule: 14
- **Conclusions:** failure: 14
- **Scheduled Delivery:** 14 runs, median gap between runs: 24.1 h
- **Schedule Delay from Slot:** median 490 min, p90 594 min
- **Billed Minutes:** median 2m, p90 2m, mean 2.0m, max 2m
- **Extrapolated Monthly Consumption:** 60 min/mo

### `catalog-refresh.yml` (catalog auto (refresh + media backfill))

- **Schedule:** `17 1 * * 1`
- **Total Runs in Window:** 3
- **Events:** schedule: 3
- **Conclusions:** success: 3
- **Scheduled Delivery:** 3 runs, median gap between runs: 22.5 h
- **Schedule Delay from Slot:** median 403 min, p90 9115 min
- **Billed Minutes:** median 7m, p90 9m, mean 7.3m, max 9m
- **Extrapolated Monthly Consumption:** 47 min/mo

### `ci.yml` (CI)

- **Schedule:** None (Manual or Event-driven)
- **Total Runs in Window:** 9
- **Events:** push: 4, pull_request: 5
- **Conclusions:** success: 8, failure: 1
- **Billed Minutes:** median 9m, p90 10m, mean 8.8m, max 10m
- **Extrapolated Monthly Consumption:** 169 min/mo

### `creator-watch.yml` (creator-watch)

- **Schedule:** `23 */6 * * *`
- **Total Runs in Window:** 33
- **Events:** schedule: 33
- **Conclusions:** success: 33
- **Scheduled Delivery:** 33 runs, median gap between runs: 10.7 h
- **Schedule Delay from Slot:** median 77 min, p90 334 min
- **Billed Minutes:** median 2m, p90 2m, mean 2.1m, max 3m
- **Extrapolated Monthly Consumption:** 148 min/mo

### `db-migrate.yml` (Database Migration (Production))

- **Schedule:** None (Manual or Event-driven)
- **Total Runs in Window:** 0
- **Events:** None
- **Conclusions:** None
- **Billed Minutes:** median 0m, p90 0m, mean 0.0m, max 0m
- **Extrapolated Monthly Consumption:** 0 min/mo

### `db-tests.yml` (Database Tests)

- **Schedule:** None (Manual or Event-driven)
- **Total Runs in Window:** 9
- **Events:** push: 4, pull_request: 5
- **Conclusions:** success: 9
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 1m
- **Extrapolated Monthly Consumption:** 19 min/mo

### `ingest-on-new-phone.yml` (ingest-on-new-phone)

- **Schedule:** None (Manual or Event-driven)
- **Total Runs in Window:** 0
- **Events:** None
- **Conclusions:** None
- **Billed Minutes:** median 0m, p90 0m, mean 0.0m, max 0m
- **Extrapolated Monthly Consumption:** 0 min/mo

### `ingest-resume.yml` (ingest (resume))

- **Schedule:** `20 3 * * *`
- **Total Runs in Window:** 14
- **Events:** schedule: 14
- **Conclusions:** success: 14
- **Scheduled Delivery:** 14 runs, median gap between runs: 24.0 h
- **Schedule Delay from Slot:** median 468 min, p90 489 min
- **Billed Minutes:** median 14m, p90 16m, mean 15.7m, max 44m
- **Extrapolated Monthly Consumption:** 471 min/mo

### `ingest-tiered.yml` (ingest (tiered))

- **Schedule:** `17 2 * * *`
- **Total Runs in Window:** 13
- **Events:** schedule: 13
- **Conclusions:** success: 13
- **Scheduled Delivery:** 13 runs, median gap between runs: 24.1 h
- **Schedule Delay from Slot:** median 437 min, p90 459 min
- **Billed Minutes:** median 10m, p90 16m, mean 10.6m, max 23m
- **Extrapolated Monthly Consumption:** 296 min/mo

### `ingest.yml` (ingest (manual))

- **Schedule:** None (Manual or Event-driven)
- **Total Runs in Window:** 0
- **Events:** None
- **Conclusions:** None
- **Billed Minutes:** median 0m, p90 0m, mean 0.0m, max 0m
- **Extrapolated Monthly Consumption:** 0 min/mo

### `keepalive.yml` (repository keepalive)

- **Schedule:** `0 0 * * 0`
- **Total Runs in Window:** 2
- **Events:** schedule: 2
- **Conclusions:** success: 2
- **Scheduled Delivery:** 2 runs, median gap between runs: 168.1 h
- **Schedule Delay from Slot:** median 275 min, p90 278 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 1m
- **Extrapolated Monthly Consumption:** 4 min/mo

### `metering-maintenance.yml` (Metering Maintenance)

- **Schedule:** `*/15 * * * *`
- **Total Runs in Window:** 56
- **Events:** schedule: 56
- **Conclusions:** success: 1, failure: 55
- **Scheduled Delivery:** 56 runs, median gap between runs: 5.9 h
- **Schedule Delay from Slot:** median 9 min, p90 14 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 2m
- **Extrapolated Monthly Consumption:** 122 min/mo

### `ops-alerts.yml` (Ops Alerts Sweep)

- **Schedule:** `*/5 * * * *`
- **Total Runs in Window:** 57
- **Events:** schedule: 57
- **Conclusions:** success: 1, failure: 56
- **Scheduled Delivery:** 57 runs, median gap between runs: 6.1 h
- **Schedule Delay from Slot:** median 3 min, p90 4 min
- **Billed Minutes:** median 1m, p90 1m, mean 1.0m, max 2m
- **Extrapolated Monthly Consumption:** 122 min/mo

### `scorecard-auto.yml` (scorecard (auto))

- **Schedule:** `17 4,10,16,22 * * *`
- **Total Runs in Window:** 39
- **Events:** schedule: 39
- **Conclusions:** success: 39
- **Scheduled Delivery:** 39 runs, median gap between runs: 9.6 h
- **Schedule Delay from Slot:** median 192 min, p90 330 min
- **Billed Minutes:** median 12m, p90 23m, mean 11.0m, max 40m
- **Extrapolated Monthly Consumption:** 921 min/mo

### `source-watch.yml` (source-watch (scout))

- **Schedule:** `23 */6 * * *`
- **Total Runs in Window:** 1
- **Events:** schedule: 1
- **Conclusions:** success: 1
- **Scheduled Delivery:** 1 runs, median gap between runs: N/A h
- **Schedule Delay from Slot:** median 35 min, p90 35 min
- **Billed Minutes:** median 2m, p90 2m, mean 2.0m, max 2m
- **Extrapolated Monthly Consumption:** 4 min/mo
