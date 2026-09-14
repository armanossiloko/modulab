#!/usr/bin/env bash
# Shared helpers for scripts/setup.sh, scripts/start.sh, and scripts/stop.sh

# Fallback order when lab.config.json has no "enabled" array.
LAB_STACKS=(
  control-center
  postgres
  redis
  jellyfin
  n8n
  seerr
  it-tools
  stirling-pdf
  bentopdf
  picoshare
  futo-notes
  immich
  searxng
)

require_lab_env() {
  if [[ ! -f "${root}/.env" ]]; then
    echo "Missing ${root}/.env. Run: bash scripts/setup.sh  (or: bash scripts/render-config.sh)" >&2
    exit 1
  fi
}

ensure_modulab_network() {
  docker network create modulab >/dev/null 2>&1 || true
}

stack_compose() {
  local name="$1"
  shift
  if [[ "$name" == pihole ]]; then
    pihole_compose "$@"
    return
  fi
  if [[ "$name" == caddy ]]; then
    caddy_compose "$@"
    return
  fi
  docker compose --env-file "${root}/.env" -f "${root}/docker-compose.${name}.yml" "$@"
}

pihole_compose() {
  local files=(-f "${root}/docker-compose.pihole.yml")
  if [[ -f "${root}/docker-compose.pihole.dns.yml" ]]; then
    files+=(-f "${root}/docker-compose.pihole.dns.yml")
  fi
  # LAN proxy: publish DNS on LAB_HOST_IP. Otherwise keep DNS on loopback only.
  if lan_proxy_enabled; then
    files+=(-f "${root}/docker-compose.pihole.lan-ports.yml")
  else
    files+=(-f "${root}/docker-compose.pihole.dns-ports.yml")
  fi
  docker compose --env-file "${root}/.env" "${files[@]}" "$@"
}

caddy_compose() {
  local files=(-f "${root}/docker-compose.caddy.yml")
  if lan_proxy_enabled; then
    files+=(-f "${root}/docker-compose.caddy.proxy-ports.yml")
  fi
  docker compose --env-file "${root}/.env" "${files[@]}" "$@"
}

stack_down() {
  local name="$1"
  shift
  case "$name" in
    caddy) caddy_compose down "$@" ;;
    pihole) pihole_compose down "$@" ;;
    *)
      if [[ -f "${root}/docker-compose.${name}.yml" ]]; then
        docker compose --env-file "${root}/.env" -f "${root}/docker-compose.${name}.yml" down "$@"
      fi
      ;;
  esac
}

# Resolve stacks for `start.sh all` / `stop.sh all` from lab.config.json enabled[].
enabled_stacks() {
  LAB_ROOT="$root" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["LAB_ROOT"])
config_path = root / "lab.config.json"
fallback = [
    "control-center", "postgres", "redis",
]

if not config_path.is_file():
    print("\n".join(fallback))
    raise SystemExit(0)

data = json.loads(config_path.read_text(encoding="utf-8"))
enabled = data.get("enabled")
if not isinstance(enabled, list):
    print("\n".join(fallback))
    raise SystemExit(0)

stacks = [str(x) for x in enabled if isinstance(x, str)]
ordered: list[str] = []
for name in ("control-center", "postgres", "redis"):
    if name in stacks and name not in ordered:
        ordered.append(name)
for name in stacks:
    if name not in ordered:
        ordered.append(name)
print("\n".join(ordered))
PY
}

# Print dependency stack ids for a recipe (recursive, unique, deps before dependents).
recipe_depends() {
  local id="$1"
  LAB_ROOT="$root" RECIPE_ID="$id" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["LAB_ROOT"])
target = os.environ["RECIPE_ID"]
recipes = {}
for path in (root / "catalog").glob("*/recipe.json"):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("id"):
        recipes[data["id"]] = data

ordered: list[str] = []
seen: set[str] = set()

def walk(rid: str) -> None:
    if rid in seen:
        return
    seen.add(rid)
    recipe = recipes.get(rid) or {}
    for dep in recipe.get("dependsOn") or []:
        if isinstance(dep, str):
            walk(dep)
    if rid != target:
        ordered.append(rid)

walk(target)
print("\n".join(ordered))
PY
}

lab_control_center_url() {
  if lan_proxy_enabled; then
    lab_url home
    return 0
  fi
  local port="8888"
  if [[ -f "${root}/.env" ]]; then
    local line
    line="$(grep -E '^HOME_PORT=' "${root}/.env" | head -1 || true)"
    [[ -n "$line" ]] && port="${line#HOME_PORT=}" && port="${port%%$'\r'}"
  fi
  echo "http://127.0.0.1:${port}"
}

# Back-compat name used by older scripts
lab_dashboard_url() {
  lab_control_center_url
}

lan_proxy_enabled() {
  local line
  [[ -f "${root}/.env" ]] || return 1
  line="$(grep -E '^ENABLE_LAN_PROXY=' "${root}/.env" | head -1 || true)"
  [[ "${line#ENABLE_LAN_PROXY=}" == "true" ]]
}

lab_domain() {
  local line
  if [[ -f "${root}/.env" ]]; then
    line="$(grep -E '^PIHOLE_LOCAL_DOMAIN=' "${root}/.env" | head -1 || true)"
    if [[ -n "$line" ]]; then
      echo "${line#PIHOLE_LOCAL_DOMAIN=}" | tr -d '\r'
      return 0
    fi
  fi
  echo "network.lan"
}

lab_url() {
  local label="$1"
  local path="${2:-}"
  echo "http://${label}.$(lab_domain)${path}"
}

print_stack_url() {
  local name="$1"
  local domain
  domain="$(lab_domain)"
  case "$name" in
    jellyfin) echo "Jellyfin: $(lab_url jellyfin)" ;;
    n8n) echo "n8n: $(lab_url n8n)" ;;
    seerr) echo "Seerr: $(lab_url seerr)" ;;
    it-tools) echo "IT-Tools: $(lab_url it-tools)" ;;
    stirling-pdf) echo "Stirling PDF: $(lab_url stirling)" ;;
    bentopdf) echo "BentoPDF: $(lab_url bentopdf)" ;;
    picoshare) echo "PicoShare: $(lab_url picoshare)" ;;
    futo-notes) echo "FUTO Notes: $(lab_url notes) (also http://127.0.0.1:3005)" ;;
    immich) echo "Immich: $(lab_url immich)" ;;
    searxng) echo "SearXNG: $(lab_url searxng) (also http://127.0.0.1:8080)" ;;
    redis) echo "Redis: redis:6379 (Docker network modulab)" ;;
    control-center) echo "Control Center: $(lab_control_center_url)" ;;
    pihole)
      echo "Pi-hole admin: $(lab_url pihole /admin)"
      if lan_proxy_enabled; then
        local host_ip=127.0.0.1
        if [[ -f "${root}/.env" ]]; then
          local line
          line="$(grep -E '^LAB_HOST_IP=' "${root}/.env" | head -1 || true)"
          [[ -n "$line" ]] && host_ip="${line#LAB_HOST_IP=}" && host_ip="${host_ip%%$'\r'}"
        fi
        echo "DNS (LAN): ${host_ip}:53"
      else
        echo "DNS (loopback): 127.0.0.1:53"
      fi
      ;;
    caddy)
      echo "Caddy LAN proxy: $(lan_proxy_enabled && echo enabled || echo disabled)"
      ;;
    postgres) echo "Postgres: postgres.${domain}:5432 (shared; DBs from bootstrap.sql)" ;;
    *) echo "Started ${name}" ;;
  esac
}

wait_for_postgres() {
  local user=modulab db=modulab line
  if [[ -f "${root}/.env" ]]; then
    line="$(grep -E '^POSTGRES_USER=' "${root}/.env" | head -1 || true)"
    [[ -n "${line}" ]] && user="${line#POSTGRES_USER=}"
    user="${user%\"}"
    user="${user#\"}"
    line="$(grep -E '^POSTGRES_DB=' "${root}/.env" | head -1 || true)"
    [[ -n "${line}" ]] && db="${line#POSTGRES_DB=}"
    db="${db%\"}"
    db="${db#\"}"
  fi
  until docker exec postgres pg_isready -U "${user}" -d "${db}" >/dev/null 2>&1; do sleep 1; done
}

wait_for_redis() {
  until docker exec redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 1; done
}
