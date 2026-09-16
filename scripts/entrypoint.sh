#!/usr/bin/env bash
# Appliance entrypoint: seed kit → state, render config, start base stacks, run API.
set -euo pipefail

export MODULAB_ROOT="${MODULAB_ROOT:-/lab}"
export MODULAB_KIT="${MODULAB_KIT:-/opt/modulab}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-modulab}"
export COMPOSE_IGNORE_ORPHANS="${COMPOSE_IGNORE_ORPHANS:-true}"

# Prefer kit scripts when present (image); fall back to state copy after seed.
KIT_SCRIPTS="${MODULAB_KIT}/scripts"
if [[ -d "${KIT_SCRIPTS}" ]]; then
  export MODULAB_SCRIPTS="${MODULAB_SCRIPTS:-${KIT_SCRIPTS}}"
else
  export MODULAB_SCRIPTS="${MODULAB_SCRIPTS:-${MODULAB_ROOT}/scripts}"
fi

mkdir -p "${MODULAB_ROOT}"

python3 "${MODULAB_SCRIPTS}/seed-lab-state.py"

# After seed, state has scripts; keep using kit scripts for LF-correctness in image.
if [[ -f "${MODULAB_ROOT}/scripts/run_bash.py" ]]; then
  :
fi

cd "${MODULAB_ROOT}"

# Keep generated .env / edge files in sync with lab.config.json after seed/upgrades.
if [[ -f "${MODULAB_ROOT}/lab.config.json" ]]; then
  python3 "${MODULAB_SCRIPTS}/run_bash.py" render-config.sh || true
fi

# Bring up lean base stacks (not control-center — this process *is* Control Center).
if [[ -f "${MODULAB_ROOT}/lab.config.json" && -f "${MODULAB_ROOT}/.env" ]]; then
  for stack in postgres caddy pihole redis; do
    if MODULAB_ROOT="${MODULAB_ROOT}" python3 - <<PY
import json, os, sys
from pathlib import Path
p = Path(os.environ["MODULAB_ROOT"]) / "lab.config.json"
data = json.loads(p.read_text(encoding="utf-8"))
enabled = data.get("enabled") or []
sys.exit(0 if "${stack}" in enabled else 1)
PY
    then
      echo "entrypoint: ensuring ${stack}..." >&2
      python3 "${MODULAB_SCRIPTS}/run_bash.py" start.sh "${stack}" || echo "entrypoint: warning: failed to start ${stack}" >&2
    fi
  done
fi

exec /app/Modulab.ControlCenter
