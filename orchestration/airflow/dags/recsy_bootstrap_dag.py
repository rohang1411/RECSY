from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import chain_all, local_command_task


with DAG(
    dag_id="recsy_production_bootstrap",
    description="Manual-only first-run/recovery bootstrap. Local execution only.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "ingest_limit": Param("25", type="string"),
        "per_phone_limit": Param("5", type="string"),
        "scorecard_limit": Param("20", type="string"),
        "max_runtime_minutes": Param("38", type="string"),
    },
    tags=["recsy", "bootstrap", "manual", "optional-airflow"],
) as dag:
    db_setup = local_command_task(task_id="db_setup", command=pnpm("db:setup"), retries=0)
    db_smoke = local_command_task(task_id="db_smoke", command=pnpm("db:smoke"), retries=1)
    spec_embeddings = local_command_task(
        task_id="spec_embedding_backfill",
        command=pnpm("spec-embed:backfill"),
        retries=0,
        pool="recsy_gemini_pool",
    )
    catalog_auto = local_command_task(task_id="catalog_auto", command=pnpm("catalog:auto"), retries=0)
    ingest_auto = local_command_task(
        task_id="ingest_auto_small_batch",
        command=pnpm(
            "ingest:auto",
            "--tier",
            "all",
            "--limit",
            "{{ params.ingest_limit }}",
            "--per-phone-limit",
            "{{ params.per_phone_limit }}",
        ),
        retries=0,
        pool="recsy_ingest_pool",
    )
    scorecard_auto = local_command_task(
        task_id="scorecard_auto",
        command=pnpm(
            "scorecard:auto",
            "--limit",
            "{{ params.scorecard_limit }}",
            "--max-runtime-minutes",
            "{{ params.max_runtime_minutes }}",
        ),
        retries=0,
        pool="recsy_gemini_pool",
    )
    retrieval_smoke = local_command_task(task_id="retrieval_smoke", command=pnpm("retrieval:smoke"))
    ingest_report = local_command_task(task_id="ingest_report", command=pnpm("ingest:report", "--days", "7"))

    chain_all(
        [
            db_setup,
            db_smoke,
            spec_embeddings,
            catalog_auto,
            ingest_auto,
            scorecard_auto,
            retrieval_smoke,
            ingest_report,
        ],
    )
