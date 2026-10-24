#!/usr/bin/env bash
# Roll a stack back to the images it ran before the last update: bash scripts/rollback.sh <stack>
# The rollback point is recorded by update.sh (see rollback_images.py).

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

name="${1:?Usage: bash scripts/rollback.sh <stack>}"

if [[ -z "$(stack_compose_file "$name")" ]]; then
  echo "Unknown stack '${name}'" >&2
  exit 1
fi

require_lab_env
ensure_modulab_network

echo "Re-pointing image tags to the previous version..." >&2
MODULAB_ROOT="$root" python3 "${root}/scripts/rollback_images.py" restore "$name"

echo "Recreating ${name} without pulling..." >&2
stack_compose "$name" up -d --pull never --force-recreate
MODULAB_ROOT="$root" python3 "${root}/scripts/rollback_images.py" done "$name"
echo "Rolled back ${name}. Use Update to move forward again." >&2
