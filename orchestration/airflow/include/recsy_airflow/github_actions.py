from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Mapping

from airflow.hooks.base import BaseHook

from recsy_airflow.config import get_config
from recsy_airflow.commands import stringify_inputs

GITHUB_CONNECTION_ID = "github_recsy_actions"


def _github_token() -> str:
    try:
        conn = BaseHook.get_connection(GITHUB_CONNECTION_ID)
        token = conn.password or conn.extra_dejson.get("token")
        if token:
            return token
    except Exception:
        pass

    token = os.getenv("GITHUB_ACTIONS_TOKEN") or os.getenv("GITHUB_TOKEN")
    if token:
        return token

    raise RuntimeError(
        "GitHub dispatch mode requires an Airflow Connection named "
        f"{GITHUB_CONNECTION_ID!r} with a token, or GITHUB_ACTIONS_TOKEN.",
    )


def dispatch_workflow(workflow_file: str, inputs: Mapping[str, object] | None = None) -> None:
    config = get_config()
    payload = {
        "ref": config.github_ref,
        "inputs": stringify_inputs(inputs),
    }
    url = (
        "https://api.github.com/repos/"
        f"{config.repo_owner}/{config.repo_name}/actions/workflows/{workflow_file}/dispatches"
    )
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {_github_token()}",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )

    print(f"[recsy-airflow] dispatching {workflow_file} on {config.github_ref}")
    print(f"[recsy-airflow] inputs: {payload['inputs']}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status not in {200, 201, 202, 204}:
                raise RuntimeError(f"unexpected GitHub response status: {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub workflow dispatch failed: {exc.code} {detail}") from exc

    actions_url = f"https://github.com/{config.repo_owner}/{config.repo_name}/actions"
    print(f"[recsy-airflow] dispatched. Check GitHub Actions: {actions_url}")
