#!/usr/bin/env bash
# Start one lab stack, or all enabled stacks.
# Prefer: python3 scripts/lab.py start <stack>|all
# (LF-normalizes scripts — required for Windows → Linux container installs)

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${LAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

start_stack() {
  local name="$1"
  shift
  local compose="${root}/docker-compose.${name}.yml"

  if [[ ! -f "$compose" ]]; then
    echo "skip ${name}: no ${compose}" >&2
    return 0
  fi

  require_lab_env
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
    postgres)
      stack_compose postgres up -d "$@"
      wait_for_postgres
      ;;
    redis)
      stack_compose redis up -d "$@"
      wait_for_redis
      ;;
    caddy)
      python3 "${root}/scripts/generate-edge.py"
      caddy_compose up -d "$@"
      ;;
    pihole)
      python3 "${root}/scripts/generate-edge.py"
      stack_compose pihole up -d "$@"
      ;;
    control-center)
      python3 "${root}/scripts/generate-edge.py"
      bash "${_scripts}/ensure-wwwroot.sh"
      # Docker Desktop + Control Center: avoid rebuild/recreate loops when already up
      # (Compose cannot docker-build with a Windows host path from inside the container).
      if docker_desktop && [[ "${root}" == "/lab" || "${root}" == "/lab/" ]]; then
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx control-center; then
          echo "control-center already running — skip recreate" >&2
        elif docker image inspect modulab-control-center >/dev/null 2>&1; then
          stack_compose control-center up -d "$@"
        else
          echo "control-center image missing — build once from the host:" >&2
          echo "  python3 scripts/lab.py start control-center" >&2
          stack_compose control-center up -d "$@"
        fi
      else
        stack_compose control-center up -d --build "$@"
      fi
      ;;
    jellyfin)
      # Compose creates missing bind-mount dirs as root; Jellyfin runs as 1000:1000.
      # media/ may be a host directory or symlink (possibly dangling inside the container).
      mkdir -p "${root}/data/jellyfin/config" "${root}/data/jellyfin/cache"
      if [[ -L "${root}/media" || -d "${root}/media" ]]; then
        :
      elif [[ -e "${root}/media" ]]; then
        echo "warning: ${root}/media exists but is not a directory" >&2
      else
        mkdir -p "${root}/media"
      fi
      # chown is Linux/root-only — on Windows/macOS hosts it is a no-op or can hang.
      if [[ "$(uname -s 2>/dev/null || true)" == Linux ]] && [[ "$(id -u 2>/dev/null || echo 1)" == "0" ]]; then
        chown -R 1000:1000 "${root}/data/jellyfin" 2>/dev/null || true
        if [[ -d "${root}/media" && ! -L "${root}/media" ]]; then
          chown -R 1000:1000 "${root}/media" 2>/dev/null || true
        fi
      fi
      stack_compose jellyfin up -d "$@"
      ;;
    searxng)
      mkdir -p "${root}/data/searxng"
      if [[ ! -f "${root}/searxng/settings.yml.template" ]]; then
        echo "searxng: missing ${root}/searxng/settings.yml.template" >&2
        exit 1
      fi
      # Force re-seed if a previous bad Desktop bind left an empty settings.yml.
      if [[ ! -s "${root}/data/searxng/settings.yml" ]]; then
        rm -f "${root}/data/searxng/settings.yml"
      fi
      stack_compose searxng up -d "$@"
      ;;
    *)
      stack_compose "$name" up -d "$@"
      ;;
  esac
}

name="${1:?Usage: bash scripts/start.sh <stack>|all}"
shift

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
