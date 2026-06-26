from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import github_dispatch_task, join_task, local_command_task, mode_branch_task


with DAG(
    dag_id="recsy_scorecard_auto",
    description="Drain the automated scorecard queue with existing RECSY guardrails.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "limit": Param("20", type="string"),
        "force": Param(False, type="boolean"),
        "max_runtime_minutes": Param("38", type="string"),
    },
    tags=["recsy", "scorecard", "optional-airflow"],
) as dag:
    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id="scorecard_auto_local",
        github_task_id="scorecard_auto_github",
    )

    scorecard_auto_local = local_command_task(
        task_id="scorecard_auto_local",
        command=(
            pnpm(
                "scorecard:auto",
                "--limit",
                "{{ params.limit }}",
                "--max-runtime-minutes",
                "{{ params.max_runtime_minutes }}",
            )
            + " {% if params.force %}--force{% endif %}"
        ),
        retries=0,
        pool="recsy_gemini_pool",
    )

    scorecard_auto_github = github_dispatch_task(
        task_id="scorecard_auto_github",
        workflow_file="scorecard-auto.yml",
        inputs={
            "limit": "{{ params.limit }}",
            "force": "{{ params.force }}",
            "max_runtime_minutes": "{{ params.max_runtime_minutes }}",
        },
        retries=1,
    )

    done = join_task()
    choose_mode >> [scorecard_auto_local, scorecard_auto_github] >> done
