#!/usr/bin/env bash
set -euo pipefail

AIRFLOW_VERSION="${AIRFLOW_VERSION:-3.2.2}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AIRFLOW_HOME_DIR="$SCRIPT_DIR/.airflow-home"
VENV="$SCRIPT_DIR/.venv"
DAGS_FOLDER="$SCRIPT_DIR/dags"
INCLUDE_FOLDER="$SCRIPT_DIR/include"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. On Ubuntu, run: sudo apt update && sudo apt install -y python3 python3-venv python3-pip"
  exit 1
fi

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

# shellcheck source=/dev/null
source "$VENV/bin/activate"

python -m pip install --upgrade pip

CONSTRAINT_URL="https://raw.githubusercontent.com/apache/airflow/constraints-${AIRFLOW_VERSION}/constraints-${PYTHON_VERSION}.txt"
python -m pip install "apache-airflow==${AIRFLOW_VERSION}" --constraint "$CONSTRAINT_URL"
python -m pip install -r "$SCRIPT_DIR/requirements.txt"

export AIRFLOW_HOME="$AIRFLOW_HOME_DIR"
export AIRFLOW__CORE__DAGS_FOLDER="$DAGS_FOLDER"
export AIRFLOW__CORE__LOAD_EXAMPLES="false"
export AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION="true"
export AIRFLOW__CORE__EXECUTOR="SequentialExecutor"
export PYTHONPATH="$INCLUDE_FOLDER"
export RECSY_PROJECT_ROOT="$ROOT"
export RECSY_EXECUTION_MODE="local"

airflow db migrate
airflow pools set recsy_gemini_pool 1 "RECSY Gemini/LLM-heavy tasks"
airflow pools set recsy_ingest_pool 4 "RECSY ingestion shard tasks"
airflow users create \
  --username airflow \
  --password airflow \
  --firstname RECSY \
  --lastname Operator \
  --role Admin \
  --email recsy@example.local >/dev/null 2>&1 || true

cat <<EOF

Airflow is installed locally in WSL/Linux.

Run these in two separate WSL/Linux shells from this folder:

  source ./.venv/bin/activate
  export AIRFLOW_HOME="$AIRFLOW_HOME_DIR"
  export AIRFLOW__CORE__DAGS_FOLDER="$DAGS_FOLDER"
  export AIRFLOW__CORE__LOAD_EXAMPLES=false
  export PYTHONPATH="$INCLUDE_FOLDER"
  export RECSY_PROJECT_ROOT="$ROOT"
  export RECSY_EXECUTION_MODE=local
  airflow api-server --port 8080

And in the second shell:

  source ./.venv/bin/activate
  export AIRFLOW_HOME="$AIRFLOW_HOME_DIR"
  export AIRFLOW__CORE__DAGS_FOLDER="$DAGS_FOLDER"
  export AIRFLOW__CORE__LOAD_EXAMPLES=false
  export PYTHONPATH="$INCLUDE_FOLDER"
  export RECSY_PROJECT_ROOT="$ROOT"
  export RECSY_EXECUTION_MODE=local
  airflow scheduler

Then open http://localhost:8080 and log in with airflow / airflow.
EOF
