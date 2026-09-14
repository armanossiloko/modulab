#!/usr/bin/env bash
# Create control-center/wwwroot and seed dashboard.json from tracked defaults.
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
