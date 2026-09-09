#!/usr/bin/env bash
# Create control-center/wwwroot from tracked defaults + generated services.json.
# Safe to re-run: never overwrites an existing dashboard.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/control-center/wwwroot"
DEFAULTS="$ROOT/control-center/defaults"

mkdir -p "$WWW"

if [[ ! -f "$WWW/dashboard.json" ]]; then
  if [[ -f "$DEFAULTS/dashboard.json" ]]; then
    cp "$DEFAULTS/dashboard.json" "$WWW/dashboard.json"
    echo "seeded control-center/wwwroot/dashboard.json from defaults" >&2
  else
    echo "warning: missing $DEFAULTS/dashboard.json" >&2
  fi
fi

if [[ -f "$DEFAULTS/dashboard.example.json" && ! -f "$WWW/dashboard.example.json" ]]; then
  cp "$DEFAULTS/dashboard.example.json" "$WWW/dashboard.example.json"
fi

python3 "$ROOT/control-center/render-services.py"
