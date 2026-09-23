#!/usr/bin/env bash
# Stop one lab stack (keeps volumes): bash scripts/stop.sh <stack>|all

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

stop_stack() {
  local name="$1"
  shift
  local compose="${root}/docker-compose.${name}.yml"

  if [[ ! -f "$compose" ]]; then
    echo "skip ${name}: no ${compose}" >&2
    return 0
  fi

  echo "Stopping ${name}..." >&2
  stack_down "$name" "$@"
}

name="${1:?Usage: bash scripts/stop.sh <stack>|all}"
shift

if [[ "$name" == all ]]; then
  mapfile -t stacks < <(enabled_stacks | tr -d '\r')
  for ((i = ${#stacks[@]} - 1; i >= 0; i--)); do
    stop_stack "${stacks[i]}" "$@"
  done
  exit 0
fi

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Usage: bash scripts/stop.sh <stack>|all" >&2
  echo "Default stacks: ${MODULAB_STACKS[*]} (+ pihole)" >&2
  exit 1
fi

stop_stack "$name" "$@"
