#!/usr/bin/env bash
# Stop one lab stack (keeps volumes): bash scripts/stop.sh <stack>|all

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

stop_stack() {
  local name="$1"
  shift
  local compose="${root}/docker-compose.${name}.yml"

  if [[ ! -f "$compose" ]]; then
    echo "skip ${name}: no ${compose}" >&2
    return 0
  fi

  echo "Stopping ${name}..." >&2

  case "$name" in
    odysseus)
      docker compose -f "$compose" down "$@"
      ;;
    *)
      stack_down "$name" "$@"
      ;;
  esac
}

name="${1:?Usage: bash scripts/stop.sh <stack>|all}"
shift

if [[ "$name" == home ]]; then
  echo "note: home is served by caddy — stopping caddy" >&2
  name=caddy
fi

if [[ "$name" == all ]]; then
  for ((i = ${#LAB_STACKS[@]} - 1; i >= 0; i--)); do
    stop_stack "${LAB_STACKS[i]}" "$@"
  done
  exit 0
fi

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Usage: bash scripts/stop.sh <stack>|all" >&2
  echo "Stacks: ${LAB_STACKS[*]} pihole caddy" >&2
  exit 1
fi

stop_stack "$name" "$@"
