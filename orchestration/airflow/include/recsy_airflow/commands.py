from __future__ import annotations

import shlex
from collections.abc import Mapping


def pnpm(script: str, *args: object) -> str:
    rendered = ["pnpm", script, *(str(arg) for arg in args if arg is not None and str(arg) != "")]
    return " ".join(shlex.quote(part) for part in rendered)


def recsy_bash(command: str) -> str:
    return "\n".join(
        [
            "set -euo pipefail",
            'cd "${RECSY_PROJECT_ROOT:-/opt/recsy}"',
            command,
        ],
    )


def stringify_inputs(inputs: Mapping[str, object] | None) -> dict[str, str]:
    if not inputs:
        return {}
    return {key: str(value) for key, value in inputs.items() if value is not None}
