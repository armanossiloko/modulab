#!/usr/bin/env bash
# Copy lab.config.example.json → lab.config.json, render all generated files.
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
  1. Edit lab.config.json (passwords, domain, host IP, timezone, enabled apps).
  2. bash scripts/render-config.sh
  3. bash scripts/start.sh all       (control-center + postgres + redis by default)
  4. Open http://127.0.0.1:8888  (Control Center)

Open Modulab.slnx in Visual Studio → control-center/src-backend/Modulab.ControlCenter
UI is generated under control-center/wwwroot/ (and/or ui/dist) by setup / publish-ui.
EOF
