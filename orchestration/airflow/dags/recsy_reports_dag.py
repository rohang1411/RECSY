from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import chain_all, local_command_task


with DAG(
    dag_id="recsy_reports",
    description="Run lightweight RECSY operational reports and smoke checks.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "ingest_days": Param("7", type="string"),
        "catalog_days": Param("35", type="string"),
        "run_retrieval_smoke": Param(False, type="boolean"),
    },
    tags=["recsy", "reports", "optional-airflow"],
) as dag:
    db_smoke = local_command_task(task_id="db_smoke", command=pnpm("db:smoke"), retries=1)
    ingest_report = local_command_task(
        task_id="ingest_report",
        command=pnpm("ingest:report", "--days", "{{ params.ingest_days }}"),
    )
    catalog_report = local_command_task(
        task_id="catalog_report",
        command=pnpm("catalog:report", "--days", "{{ params.catalog_days }}"),
    )
    retrieval_smoke = local_command_task(
        task_id="retrieval_smoke",
        command="{% if params.run_retrieval_smoke %}"
        + pnpm("retrieval:smoke")
        + "{% else %}echo 'retrieval smoke skipped'{% endif %}",
    )

    chain_all([db_smoke, ingest_report, catalog_report, retrieval_smoke])
