from __future__ import annotations

import pendulum
from airflow import DAG
from airflow.models.param import Param

from recsy_airflow.commands import pnpm
from recsy_airflow.operators import github_dispatch_task, join_task, local_command_task, mode_branch_task


SHARDS = [0, 1, 2, 3]


with DAG(
    dag_id="recsy_ingest_tiered",
    description="Run tiered, sharded RECSY ingestion or dispatch the existing GitHub workflow.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "tier": Param("all", enum=["all", "hot", "warm", "cold"]),
        "limit": Param("15", type="string"),
        "per_phone_limit": Param("5", type="string"),
    },
    tags=["recsy", "ingest", "optional-airflow"],
) as dag:
    local_shard_task_ids = [f"ingest_shard_{shard}" for shard in SHARDS]
    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id=local_shard_task_ids,
        github_task_id="ingest_tiered_github",
    )

    local_shards = [
        local_command_task(
            task_id=f"ingest_shard_{shard}",
            command=pnpm(
                "ingest:auto",
                "--tier",
                "{{ params.tier }}",
                "--limit",
                "{{ params.limit }}",
                "--per-phone-limit",
                "{{ params.per_phone_limit }}",
                "--fail-on-zero-success",
                "--shard",
                shard,
                "--total-shards",
                len(SHARDS),
            ),
            retries=0,
            pool="recsy_ingest_pool",
        )
        for shard in SHARDS
    ]

    ingest_tiered_github = github_dispatch_task(
        task_id="ingest_tiered_github",
        workflow_file="ingest-tiered.yml",
        inputs={
            "tier": "{{ params.tier }}",
            "limit": "{{ params.limit }}",
            "per_phone_limit": "{{ params.per_phone_limit }}",
        },
        retries=1,
    )

    ingest_report = local_command_task(
        task_id="ingest_report_local",
        command=pnpm("ingest:report", "--days", "7"),
        retries=0,
    )

    done = join_task()
    choose_mode >> local_shards
    choose_mode >> ingest_tiered_github
    local_shards >> ingest_report >> done
    ingest_tiered_github >> done


with DAG(
    dag_id="recsy_ingest_resume",
    description="Retry failed, partial, quota-exhausted, or empty-corpus phone ingestion.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={"limit": Param("20", type="string")},
    tags=["recsy", "ingest", "resume", "optional-airflow"],
) as dag:
    local_resume_task_ids = [f"resume_shard_{shard}" for shard in SHARDS]
    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id=local_resume_task_ids,
        github_task_id="ingest_resume_github",
    )

    local_resume_shards = [
        local_command_task(
            task_id=f"resume_shard_{shard}",
            command=pnpm(
                "ingest:auto",
                "--tier",
                "all",
                "--limit",
                "{{ params.limit }}",
                "--resume-failed",
                "--fail-on-zero-success",
                "--fail-on-empty",
                "--shard",
                shard,
                "--total-shards",
                len(SHARDS),
            ),
            retries=0,
            pool="recsy_ingest_pool",
        )
        for shard in SHARDS
    ]

    ingest_resume_github = github_dispatch_task(
        task_id="ingest_resume_github",
        workflow_file="ingest-resume.yml",
        inputs={"limit": "{{ params.limit }}"},
        retries=1,
    )

    done = join_task()
    choose_mode >> local_resume_shards
    choose_mode >> ingest_resume_github
    local_resume_shards >> done
    ingest_resume_github >> done


with DAG(
    dag_id="recsy_ingest_phone",
    description="Manually bootstrap ingestion for one phone slug.",
    start_date=pendulum.datetime(2026, 6, 1, tz="UTC"),
    schedule=None,
    catchup=False,
    max_active_runs=1,
    params={
        "phone": Param("", type="string"),
        "limit": Param("5", type="string"),
    },
    tags=["recsy", "ingest", "manual", "optional-airflow"],
) as dag:
    validate_phone = local_command_task(
        task_id="validate_phone_param",
        command='test -n "{{ params.phone }}" || (echo "phone param is required" && exit 2)',
    )

    choose_mode = mode_branch_task(
        task_id="choose_execution_mode",
        local_task_id="ingest_phone_local",
        github_task_id="ingest_phone_github",
    )

    ingest_phone_local = local_command_task(
        task_id="ingest_phone_local",
        command=pnpm("ingest", "--phone", "{{ params.phone }}", "--limit", "{{ params.limit }}"),
        retries=0,
    )

    ingest_phone_github = github_dispatch_task(
        task_id="ingest_phone_github",
        workflow_file="ingest-on-new-phone.yml",
        inputs={"phone": "{{ params.phone }}", "limit": "{{ params.limit }}"},
        retries=1,
    )

    done = join_task()
    validate_phone >> choose_mode >> [ingest_phone_local, ingest_phone_github] >> done
