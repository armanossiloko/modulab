#!/usr/bin/env bash
# Appliance self-update. Invoked by Control Center: POST /api/system/update
# Prefer: python3 scripts/update-appliance.py launch

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
exec python3 "${root}/scripts/update-appliance.py" launch
