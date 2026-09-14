#!/usr/bin/env bash
# Reload Pi-hole DNS + Caddy proxy from generated edge files (when LAN proxy is on).
# Used after Control Center / CLI install so new *.domain routes apply immediately.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"
refresh_edge_stacks
