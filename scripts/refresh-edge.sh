#!/usr/bin/env bash
# Reload Pi-hole DNS + Caddy proxy from generated edge files (when LAN proxy is on).
# Used after Control Center / CLI install so new *.domain routes apply immediately.
set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"
refresh_edge_stacks
