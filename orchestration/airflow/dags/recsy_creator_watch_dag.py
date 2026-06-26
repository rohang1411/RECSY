from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import github_dispatch_task, join_task, local_command_task, mode_branch_task


with DAG(
    dag_id="recsy_creator_watch",
    description="Poll trusted creator RSS feeds and enqueue matching phone candidates.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={"max_candidates": Param("5", type="string")},
    tags=["recsy", "ingest", "creator-watch", "optional-airflow"],
) as dag:
    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id="creator_watch_local",
        github_task_id="creator_watch_github",
    )

    creator_watch_local = local_command_task(
        task_id="creator_watch_local",
        command=pnpm("creator:watch", "--max-candidates", "{{ params.max_candidates }}"),
        retries=1,
    )

    creator_watch_github = github_dispatch_task(
        task_id="creator_watch_github",
        workflow_file="creator-watch.yml",
        inputs={"max_candidates": "{{ params.max_candidates }}"},
        retries=1,
    )

    done = join_task()
    choose_mode >> [creator_watch_local, creator_watch_github] >> done
