#!/usr/bin/env bash
# Copy lab.config.example.json → lab.config.json (if missing), render all generated files.
# Run once after clone (or whenever you change lab.config.json).

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

echo "Lab setup: rendering env files from lab.config.json..." >&2
bash "${root}/scripts/render-config.sh"

host_ip="$(grep -E '^LAB_HOST_IP=' "${root}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' || true)"
host_ip="${host_ip:-<your-lan-ip>}"

cat <<EOF

Setup finished.

Next:
  1. Edit lab.config.json — set lab.hostIp to this machine's LAN IP (now: ${host_ip}).
  2. bash scripts/render-config.sh
  3. bash scripts/start.sh all
  4. Open http://${host_ip}:8888  (or http://home.network.lan if clients use ${host_ip} as DNS)

Default credentials are modulab / modulab (see lab.config.example.json).
Control Center mutating API calls need header X-Lab-Key: modulab (the UI prompts for it).

UI is built into the Control Center image on first start (Docker). For local Angular
dev: cd control-center && npm start
EOF
