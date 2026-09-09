#!/usr/bin/env bash
# Start one lab stack, or all enabled stacks: bash scripts/start.sh all
# Resolves catalog dependsOn (e.g. immich → postgres + redis).

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

  if [[ "$name" == control-center ]]; then
    for legacy in lab-api admin home; do
      if docker ps -a --format '{{.Names}}' | grep -qx "$legacy"; then
        echo "Removing legacy ${legacy} container..." >&2
        docker rm -f "$legacy" >/dev/null 2>&1 || true
      fi
    done
  fi

  if [[ "$name" == odysseus ]]; then
    if [[ ! -f "${root}/odysseus/.env" ]]; then
      echo "skip odysseus: missing odysseus/.env (run render-config after enabling odysseus)" >&2
      return 0
    fi
    if [[ ! -f "${root}/odysseus/docker-compose.yml" ]]; then
      echo "skip odysseus: submodule not initialized (git submodule update --init odysseus)" >&2
      return 0
    fi
  else
    require_lab_env
  fi

  ensure_modulab_network

  if [[ -f "${root}/catalog/${name}/recipe.json" ]]; then
    local dep
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      echo "dependency: ensuring ${dep} (required by ${name})..." >&2
      start_stack "$dep"
    done < <(recipe_depends "$name" | tr -d '\r')
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
    redis)
      stack_compose redis up -d "$@"
      wait_for_redis
      ;;
    caddy)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      caddy_compose up -d "$@"
      ;;
    pihole)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      stack_compose pihole up -d "$@"
      ;;
    control-center)
      python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true
      bash "${root}/scripts/ensure-wwwroot.sh" >/dev/null 2>&1 || true
      stack_compose control-center up -d --build "$@"
      ;;
    *)
      stack_compose "$name" up -d "$@"
      ;;
  esac
}

name="${1:?Usage: bash scripts/start.sh <stack>|all}"
shift

if [[ "$name" == home || "$name" == lab-api || "$name" == admin ]]; then
  echo "note: starting control-center" >&2
  name=control-center
fi

if [[ "$name" == all ]]; then
  mapfile -t stacks < <(enabled_stacks | tr -d '\r')
  for stack in "${stacks[@]}"; do
    start_stack "$stack" "$@"
  done
  echo "" >&2
  echo "Control Center: $(lab_control_center_url)" >&2
  exit 0
fi

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Usage: bash scripts/start.sh <stack>|all" >&2
  echo "Default stacks: ${LAB_STACKS[*]} (+ pihole)" >&2
  exit 1
fi

start_stack "$name" "$@"
print_stack_url "$name"
