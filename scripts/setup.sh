#!/usr/bin/env bash
# Copy lab.config.example.json → lab.config.json, render all .env.* files.
# Run once after clone (or whenever you change lab.config.json).

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

echo "Lab setup: rendering env files from lab.config.json..." >&2
bash "${root}/scripts/render-config.sh"

cat <<'EOF'

Setup finished.

Next:
  1. Edit lab.config.json (passwords, domain, host IP, timezone).
     Optional: put sensitive values in secrets/ and reference them as "$secret:filename".
  2. bash scripts/render-config.sh   (after any lab.config.json change)
  3. bash scripts/start.sh caddy     (dashboard at http://127.0.0.1:8888)
  4. bash scripts/start.sh all       or  bash scripts/start.sh <stack>

Stacks: caddy postgres jellyfin n8n seerr it-tools stirling-pdf bentopdf picoshare immich pihole odysseus
EOF
