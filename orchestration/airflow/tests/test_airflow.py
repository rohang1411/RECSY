"""
Unit tests for RECSY Airflow integration helpers and DAG definitions.
Can run under any standard Python 3.10+ environment without requiring
a full Airflow installation.
"""

from __future__ import annotations

import ast
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

# Ensure recsy_airflow is importable
SCRIPT_DIR = Path(__file__).resolve().parent
AIRFLOW_DIR = SCRIPT_DIR.parent
INCLUDE_DIR = AIRFLOW_DIR / "include"
DAGS_DIR = AIRFLOW_DIR / "dags"

sys.path.insert(0, str(INCLUDE_DIR))

from recsy_airflow.commands import pnpm, recsy_bash, stringify_inputs
from recsy_airflow.config import RecsyAirflowConfig, get_config


class TestAirflowCommands(unittest.TestCase):
    def test_pnpm_helper_basic(self):
        cmd = pnpm("db:smoke")
        self.assertEqual(cmd, "pnpm db:smoke")

    def test_pnpm_helper_with_arguments(self):
        cmd = pnpm("ingest:auto", "--tier", "all", "--limit", 15, "--shard", 0)
        self.assertEqual(cmd, "pnpm ingest:auto --tier all --limit 15 --shard 0")

    def test_pnpm_helper_ignores_none_and_empty(self):
        cmd = pnpm("catalog:auto", None, "", "--limit", 50)
        self.assertEqual(cmd, "pnpm catalog:auto --limit 50")

    def test_recsy_bash_wrapper(self):
        script = recsy_bash("pnpm db:smoke")
        self.assertIn("set -euo pipefail", script)
        self.assertIn('cd "${RECSY_PROJECT_ROOT:-/opt/recsy}"', script)
        self.assertTrue(script.endswith("pnpm db:smoke"))

    def test_stringify_inputs(self):
        inputs = {
            "tier": "all",
            "limit": 15,
            "force": True,
            "skipped": None,
        }
        res = stringify_inputs(inputs)
        self.assertEqual(res, {
            "tier": "all",
            "limit": "15",
            "force": "True",
        })

    def test_stringify_inputs_empty(self):
        self.assertEqual(stringify_inputs(None), {})
        self.assertEqual(stringify_inputs({}), {})


class TestAirflowConfig(unittest.TestCase):
    def test_config_dataclass(self):
        cfg = RecsyAirflowConfig(
            execution_mode="local",
            project_root="/opt/recsy",
            repo_owner="rohang1411",
            repo_name="RECSY",
            github_ref="main",
        )
        self.assertFalse(cfg.is_github_dispatch)
        self.assertEqual(cfg.execution_mode, "local")

    def test_config_dataclass_dispatch_mode(self):
        cfg = RecsyAirflowConfig(
            execution_mode="github_dispatch",
            project_root="/opt/recsy",
            repo_owner="rohang1411",
            repo_name="RECSY",
            github_ref="main",
        )
        self.assertTrue(cfg.is_github_dispatch)

    @patch("recsy_airflow.config._variable_or_env")
    def test_get_config_local_default(self, mock_var_or_env):
        mock_var_or_env.side_effect = lambda name, env, default: default
        cfg = get_config()
        self.assertEqual(cfg.execution_mode, "local")
        self.assertFalse(cfg.is_github_dispatch)
        self.assertEqual(cfg.repo_owner, "rohang1411")

    @patch("recsy_airflow.config._variable_or_env")
    def test_get_config_invalid_mode_raises(self, mock_var_or_env):
        mock_var_or_env.side_effect = lambda name, env, default: "invalid_mode" if name == "recsy_execution_mode" else default
        with self.assertRaises(ValueError) as ctx:
            get_config()
        self.assertIn("must be either 'local' or 'github_dispatch'", str(ctx.exception))


class TestGithubDispatch(unittest.TestCase):
    @patch.dict("os.environ", {"GITHUB_ACTIONS_TOKEN": "test-token-123"}, clear=True)
    def test_github_token_from_env(self):
        from recsy_airflow.github_actions import _github_token
        self.assertEqual(_github_token(), "test-token-123")

    @patch.dict("os.environ", {}, clear=True)
    def test_github_token_missing_raises(self):
        from recsy_airflow.github_actions import _github_token
        with self.assertRaises(RuntimeError) as ctx:
            _github_token()
        self.assertIn("requires an Airflow Connection", str(ctx.exception))

    @patch.dict("os.environ", {"GITHUB_ACTIONS_TOKEN": "test-token-123"}, clear=True)
    @patch("recsy_airflow.github_actions.urllib.request.urlopen")
    def test_dispatch_workflow_success(self, mock_urlopen):
        from recsy_airflow.github_actions import dispatch_workflow
        mock_response = unittest.mock.MagicMock()
        mock_response.status = 204
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        dispatch_workflow("ingest-tiered.yml", {"tier": "all", "limit": 10})
        self.assertTrue(mock_urlopen.called)
        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_method(), "POST")
        self.assertIn("ingest-tiered.yml/dispatches", req.get_full_url())


class TestDAGIntegrityAndSyntax(unittest.TestCase):
    """
    Validates all DAG Python files using AST parsing to guarantee
    valid syntax, correct DAG IDs, and adherence to safety guardrails
    (e.g. schedule=None, catchup=False).
    """

    EXPECTED_DAG_FILES = {
        "recsy_catalog_dag.py",
        "recsy_creator_watch_dag.py",
        "recsy_ingest_dag.py",
        "recsy_reports_dag.py",
        "recsy_scorecard_dag.py",
        "recsy_bootstrap_dag.py",
    }

    EXPECTED_DAG_IDS = {
        "recsy_catalog_refresh",
        "recsy_creator_watch",
        "recsy_ingest_tiered",
        "recsy_ingest_resume",
        "recsy_ingest_phone",
        "recsy_reports",
        "recsy_scorecard_auto",
        "recsy_production_bootstrap",
    }

    def test_all_expected_dag_files_exist(self):
        self.assertTrue(DAGS_DIR.exists(), f"DAGs directory missing: {DAGS_DIR}")
        actual_files = {p.name for p in DAGS_DIR.glob("*.py")}
        self.assertTrue(self.EXPECTED_DAG_FILES.issubset(actual_files))

    def test_dag_files_parse_as_valid_ast(self):
        for dag_file in self.EXPECTED_DAG_FILES:
            path = DAGS_DIR / dag_file
            content = path.read_text(encoding="utf-8")
            try:
                tree = ast.parse(content, filename=str(path))
                self.assertIsNotNone(tree)
            except SyntaxError as e:
                self.fail(f"Syntax error in {dag_file}: {e}")

    def test_dag_definitions_contain_expected_dag_ids_and_safety_settings(self):
        found_dag_ids = set()

        for dag_file in self.EXPECTED_DAG_FILES:
            path = DAGS_DIR / dag_file
            content = path.read_text(encoding="utf-8")

            # Check for schedule=None (preventing uncoordinated cron runs alongside GitHub Actions)
            self.assertIn("schedule=None", content, f"{dag_file} must have schedule=None")
            self.assertIn("catchup=False", content, f"{dag_file} must have catchup=False")

            # Extract dag_id from AST
            tree = ast.parse(content, filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    # Check for DAG(dag_id="...") or with DAG(...)
                    for keyword in node.keywords:
                        if keyword.arg == "dag_id" and isinstance(keyword.value, ast.Constant):
                            found_dag_ids.add(keyword.value.value)

        self.assertEqual(
            found_dag_ids,
            self.EXPECTED_DAG_IDS,
            f"Mismatch in found DAG IDs. Expected {self.EXPECTED_DAG_IDS}, found {found_dag_ids}",
        )


if __name__ == "__main__":
    unittest.main()
