#!/usr/bin/env bash
# Pull newer images and recreate one stack: bash scripts/update.sh <stack>|all

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${LAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

update_stack() {
  local name="$1"
  shift
  local compose="${root}/docker-compose.${name}.yml"

  if [[ ! -f "$compose" ]]; then
    echo "skip ${name}: no ${compose}" >&2
    return 0
  fi

  require_lab_env
  ensure_modulab_network

  echo "Updating ${name} (pull + up)..." >&2

  case "$name" in
    caddy)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      caddy_compose pull "$@"
      caddy_compose up -d "$@"
      ;;
    pihole)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      stack_compose pihole pull "$@"
      stack_compose pihole up -d "$@"
      ;;
    control-center)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      bash "${_scripts}/ensure-wwwroot.sh" >/dev/null 2>&1 || true
      stack_compose control-center pull "$@" || true
      stack_compose control-center up -d --build "$@"
      ;;
    postgres)
      stack_compose postgres pull "$@"
      stack_compose postgres up -d "$@"
      wait_for_postgres
      ;;
    redis)
      stack_compose redis pull "$@"
      stack_compose redis up -d "$@"
      wait_for_redis
      ;;
    *)
      stack_compose "$name" pull "$@"
      stack_compose "$name" up -d "$@"
      ;;
  esac
}

name="${1:?Usage: bash scripts/update.sh <stack>|all}"
shift

if [[ "$name" == all ]]; then
  mapfile -t stacks < <(enabled_stacks | tr -d '\r')
  for stack in "${stacks[@]}"; do
    update_stack "$stack" "$@"
  done
  exit 0
fi

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Usage: bash scripts/update.sh <stack>|all" >&2
  exit 1
fi

update_stack "$name" "$@"
print_stack_url "$name"
