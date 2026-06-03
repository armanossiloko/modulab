#!/usr/bin/env bash
# Start one lab stack, or all stacks: bash scripts/start.sh all
# Requires setup first: bash scripts/setup.sh

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

start_stack() {
  local name="$1"
  shift
  local compose="${root}/docker-compose.${name}.yml"

  if [[ ! -f "$compose" ]]; then
    echo "skip ${name}: no ${compose}" >&2
    return 0
  fi

  if [[ "$name" == caddy ]] && docker ps -a --format '{{.Names}}' | grep -qx 'home'; then
    echo "Removing stale home container (dashboard moved into caddy)..." >&2
    docker rm -f home >/dev/null 2>&1 || true
  fi

  if [[ "$name" == odysseus ]]; then
    if [[ ! -f "${root}/odysseus/.env" ]]; then
      echo "skip odysseus: missing odysseus/.env" >&2
      return 0
    fi
    if [[ ! -f "${root}/odysseus/docker-compose.yml" ]]; then
      echo "skip odysseus: submodule not initialized (git submodule update --init odysseus)" >&2
      return 0
    fi
  elif [[ "$name" != odysseus ]]; then
    require_stack_env "$name"
  fi

  echo "Starting ${name}..." >&2

  case "$name" in
    odysseus)
      docker compose -f "$compose" up -d --build "$@"
      ;;
    postgres)
      stack_compose postgres up -d "$@"
      wait_for_postgres
      ;;
    caddy)
      caddy_compose up -d "$@"
      ;;
    *)
      stack_compose "$name" up -d "$@"
      ;;
  esac
}

name="${1:?Usage: bash scripts/start.sh <stack>|all}"
shift

if [[ "$name" == home ]]; then
  echo "note: home is served by caddy — starting caddy" >&2
  name=caddy
fi

if [[ "$name" == all ]]; then
  for stack in "${LAB_STACKS[@]}"; do
    start_stack "$stack" "$@"
  done
  echo "" >&2
  echo "Dashboard: $(lab_dashboard_url)" >&2
  exit 0
fi

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Usage: bash scripts/start.sh <stack>|all" >&2
  echo "Stacks: ${LAB_STACKS[*]} pihole caddy" >&2
  exit 1
fi

start_stack "$name" "$@"
print_stack_url "$name"
