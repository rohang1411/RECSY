from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import github_dispatch_task, join_task, local_command_task, mode_branch_task


with DAG(
    dag_id="recsy_catalog_refresh",
    description="Refresh the phone catalog through existing RECSY catalog automation.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "source": Param("both", enum=["both", "wikidata", "mobileapi"]),
        "since_years": Param("2", type="string"),
        "limit": Param("150", type="string"),
        "mobileapi_max_requests": Param("50", type="string"),
        "oem_enrich": Param(True, type="boolean"),
        "oem_limit": Param("25", type="string"),
        "promote": Param(True, type="boolean"),
        "media_backfill": Param(True, type="boolean"),
        "media_limit": Param("50", type="string"),
    },
    tags=["recsy", "catalog", "optional-airflow"],
) as dag:
    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id="catalog_auto_local",
        github_task_id="catalog_refresh_github",
    )

    catalog_auto_local = local_command_task(task_id="catalog_auto_local", command=pnpm("catalog:auto"))

    catalog_refresh_github = github_dispatch_task(
        task_id="catalog_refresh_github",
        workflow_file="catalog-refresh.yml",
        inputs={
            "source": "{{ params.source }}",
            "since_years": "{{ params.since_years }}",
            "limit": "{{ params.limit }}",
            "mobileapi_max_requests": "{{ params.mobileapi_max_requests }}",
            "oem_enrich": "{{ params.oem_enrich }}",
            "oem_limit": "{{ params.oem_limit }}",
            "promote": "{{ params.promote }}",
            "media_backfill": "{{ params.media_backfill }}",
            "media_limit": "{{ params.media_limit }}",
        },
        retries=1,
    )

    done = join_task()
    choose_mode >> [catalog_auto_local, catalog_refresh_github] >> done
