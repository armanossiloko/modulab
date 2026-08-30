#!/usr/bin/env bash
# Render .env.* from lab.config.json

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
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
python3 "${root}/dashboard/render-services.py"
