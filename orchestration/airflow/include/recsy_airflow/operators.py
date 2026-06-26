from __future__ import annotations

from collections.abc import Mapping, Sequence

from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator
from airflow.operators.python import BranchPythonOperator, PythonOperator

from recsy_airflow.commands import recsy_bash
from recsy_airflow.config import get_config
from recsy_airflow.github_actions import dispatch_workflow


def local_command_task(
    *,
    task_id: str,
    command: str,
    retries: int = 0,
    pool: str | None = None,
) -> BashOperator:
    return BashOperator(
        task_id=task_id,
        bash_command=recsy_bash(command),
        retries=retries,
        pool=pool,
        env={"RECSY_PROJECT_ROOT": "{{ var.value.get('recsy_project_root', '/opt/recsy') }}"},
        append_env=True,
    )


def github_dispatch_task(
    *,
    task_id: str,
    workflow_file: str,
    inputs: Mapping[str, object] | None = None,
    retries: int = 0,
) -> PythonOperator:
    return PythonOperator(
        task_id=task_id,
        python_callable=dispatch_workflow,
        op_kwargs={"workflow_file": workflow_file, "inputs": dict(inputs or {})},
        retries=retries,
    )


def mode_branch_task(
    *,
    task_id: str,
    local_task_id: str | Sequence[str],
    github_task_id: str,
) -> BranchPythonOperator:
    def _choose() -> str | list[str]:
        if get_config().is_github_dispatch:
            return github_task_id
        if isinstance(local_task_id, str):
            return local_task_id
        return list(local_task_id)

    return BranchPythonOperator(task_id=task_id, python_callable=_choose)


def join_task(task_id: str = "join") -> EmptyOperator:
    return EmptyOperator(task_id=task_id, trigger_rule="none_failed_min_one_success")


def chain_all(tasks: Sequence[object]) -> None:
    for left, right in zip(tasks, tasks[1:]):
        left >> right
