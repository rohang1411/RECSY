from __future__ import annotations

import os
from dataclasses import dataclass

from airflow.models import Variable


@dataclass(frozen=True)
class RecsyAirflowConfig:
    execution_mode: str
    project_root: str
    repo_owner: str
    repo_name: str
    github_ref: str

    @property
    def is_github_dispatch(self) -> bool:
        return self.execution_mode == "github_dispatch"


def _variable_or_env(name: str, env_name: str, default: str) -> str:
    return Variable.get(name, default_var=os.getenv(env_name, default))


def get_config() -> RecsyAirflowConfig:
    mode = _variable_or_env("recsy_execution_mode", "RECSY_EXECUTION_MODE", "local").strip()
    if mode not in {"local", "github_dispatch"}:
        raise ValueError(
            "recsy_execution_mode must be either 'local' or 'github_dispatch', "
            f"got {mode!r}",
        )

    return RecsyAirflowConfig(
        execution_mode=mode,
        project_root=_variable_or_env("recsy_project_root", "RECSY_PROJECT_ROOT", "/opt/recsy"),
        repo_owner=_variable_or_env("recsy_repo_owner", "RECSY_REPO_OWNER", "rohang1411"),
        repo_name=_variable_or_env("recsy_repo_name", "RECSY_REPO_NAME", "RECSY"),
        github_ref=_variable_or_env("recsy_github_ref", "RECSY_GITHUB_REF", "main"),
    )
