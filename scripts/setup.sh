#!/usr/bin/env bash
# First-time / refresh setup: check deps, ensure lab.config.json, render generated files.
# Run once after clone (or whenever you change lab.config.json).
set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

bash "${_scripts}/check-deps.sh"

config="${root}/lab.config.json"
example="${root}/lab.config.example.json"

if [[ ! -f "$config" ]]; then
  if [[ ! -f "$example" ]]; then
    echo "Missing ${example}" >&2
    exit 1
  fi
  cp "$example" "$config"
  echo "Created lab.config.json from lab.config.example.json" >&2
fi

echo "Lab setup: rendering env files from lab.config.json..." >&2
bash "${_scripts}/render-config.sh"

mkdir -p "${root}/data" "${root}/media" "${root}/secrets"

host_ip="$(grep -E '^MODULAB_HOST_IP=' "${root}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' || true)"
host_ip="${host_ip:-<your-lan-ip>}"

cat <<EOF

Setup finished.

Next:
  1. Set lab.hostIp (edit lab.config.json, or open Control Center → Settings → Lab).
  2. python3 scripts/lab.py render-config
  3. python3 scripts/lab.py start all
  4. Open http://${host_ip}:8888  (or http://home.network.lan if clients use ${host_ip} as DNS via optional Pi-hole)

Default credentials are modulab / modulab (see lab.config.example.json).
Base stack: control-center + postgres + caddy. Redis and Pi-hole are optional.
Anyone who can open Control Center can install/start/stop — keep :8888 on the LAN only.

Cross-platform CLI: python3 scripts/lab.py start all

UI is baked into the Control Center image on first start (Docker). For local Angular
dev: cd control-center && npm start
EOF
