#!/usr/bin/env bash
# Render generated lab files from lab.config.json (.env, edge, wwwroot seed).

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${LAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"

config="${root}/lab.config.json"
example="${root}/lab.config.example.json"

if [[ ! -f "$config" ]]; then
  if [[ -f "$example" ]]; then
    cp "$example" "$config"
    echo "created lab.config.json from lab.config.example.json" >&2
  else
    echo "Missing lab.config.json and lab.config.example.json" >&2
    exit 1
  fi
fi

python3 "${root}/scripts/render-config.py" "$config"
python3 "${root}/scripts/generate-edge.py"
bash "${_scripts}/ensure-wwwroot.sh"
