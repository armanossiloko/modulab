#!/usr/bin/env bash
# Shared helpers for scripts/setup.sh, scripts/start.sh, and scripts/stop.sh

# Stable project name so Control Center (cwd /lab) and host checkouts share containers.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-modulab}"
# Each stack is its own compose file under the same project name — siblings look like
# "orphans" to Compose. Ignore that noise so install/start errors stay actionable.
export COMPOSE_IGNORE_ORPHANS="${COMPOSE_IGNORE_ORPHANS:-true}"

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

# True when LAB_HOST_ROOT is a usable absolute host path for Compose binds.
# Rejects container-only /lab and corrupted Desktop values like D:Developmentmodulab
# (slashes stripped — Compose then joins onto /lab → "too many colons").
lab_host_root_usable() {
  local p="${1:-}"
  p="${p//\\//}"
  [[ -n "$p" ]] || return 1
  [[ "$p" == "/lab" || "$p" == "/lab/" || "$p" == "." ]] && return 1
  # Windows: D:/... (slash after drive is required)
  [[ "$p" =~ ^[A-Za-z]:/ ]] && return 0
  # Unix absolute (not the Control Center bind target alone)
  [[ "$p" == /* && "$p" != "/lab" && "$p" != "/lab/" ]] && return 0
  return 1
}

# Host path of the lab checkout for Compose volume binds / build context.
# Control Center runs with $root=/lab; the Docker daemon needs the real host path
# (Windows Docker Desktop: D:\..., Linux: /home/..., never the container-only /lab).
compose_root() {
  if lab_host_root_usable "${LAB_HOST_ROOT:-}"; then
    printf '%s\n' "${LAB_HOST_ROOT//\\//}"
    return 0
  fi

  if [[ "${root}" == "/lab" || "${root}" == "/lab/" ]]; then
    local host_path=""

    # Most reliable: ask the daemon how /lab was bind-mounted into this container.
    if command -v docker >/dev/null 2>&1; then
      host_path="$(
        docker inspect "$(hostname)" \
          --format '{{range .Mounts}}{{if eq .Destination "/lab"}}{{.Source}}{{end}}{{end}}' \
          2>/dev/null || true
      )"
    fi

    # Fallback: parse mountinfo (Linux bind mounts). On Docker Desktop this often
    # yields a drive-relative path like /Development/modulab — not usable as context.
    if [[ -z "$host_path" && -r /proc/self/mountinfo ]]; then
      host_path="$(awk '$5 == "/lab" { print $4; exit }' /proc/self/mountinfo)"
      host_path="${host_path//\\040/ }"
      # Reject Docker Desktop / WSL-style relative paths (no drive letter, not absolute host).
      if [[ "$host_path" == /* && "$host_path" != /home/* && "$host_path" != /Users/* && "$host_path" != /mnt/* ]]; then
        # Try to recover Windows drive from 9p options (path=D:\ …).
        local opts drive
        opts="$(awk '$5 == "/lab" { print $0; exit }' /proc/self/mountinfo)"
        drive="$(printf '%s\n' "$opts" | sed -n 's/.*path=\([A-Za-z]\):.*/\1/p' | head -1)"
        if [[ -n "$drive" ]]; then
          host_path="${drive}:$(printf '%s' "$host_path" | tr '/' '\\')"
        else
          host_path=""
        fi
      fi
    fi

    if lab_host_root_usable "$host_path"; then
      # Docker Desktop returns Windows paths with backslashes. Inside the Linux
      # container those look *relative*, so Compose joins them onto /lab and breaks
      # build context. Normalize to forward slashes (D:/...).
      host_path="${host_path//\\//}"
      printf '%s\n' "$host_path"
      return 0
    fi
  fi

  printf '%s\n' "$root"
}

# True when the Docker engine is Docker Desktop (Windows/macOS) — host networking is not Linux-like.
docker_desktop() {
  local os
  os="$(docker info --format '{{.OperatingSystem}}' 2>/dev/null || true)"
  [[ "$os" == "Docker Desktop" ]]
}


# Append optional per-stack override if present (explicit -f; Compose will not auto-merge).
append_stack_override() {
  local name="$1"
  local -n files_ref=$2
  local override="${root}/docker-compose.${name}.override.yml"
  if [[ -f "$override" ]]; then
    files_ref+=(-f "$override")
  fi
}

# Ensure .env has LAB_HOST_ROOT (absolute host path). Required when Compose runs
# from inside Control Center on Docker Desktop — relative binds would otherwise
# resolve to container paths the daemon cannot use.
ensure_lab_host_root() {
  local host_path envf cur
  envf="${root}/.env"
  [[ -f "$envf" ]] || return 0
  cur="$(grep -E '^LAB_HOST_ROOT=' "$envf" 2>/dev/null | head -1 || true)"
  cur="${cur#LAB_HOST_ROOT=}"
  if lab_host_root_usable "$cur"; then
    return 0
  fi
  # Avoid compose_root short-circuiting on a bad/container LAB_HOST_ROOT in the env.
  host_path="$(LAB_HOST_ROOT= compose_root)"
  host_path="${host_path//\\//}"
  if ! lab_host_root_usable "$host_path"; then
    return 0
  fi
  LAB_ROOT="$root" NEW_ROOT="$host_path" python3 - <<'PY2'
import os
from pathlib import Path
path = Path(os.environ["LAB_ROOT"]) / ".env"
new = os.environ["NEW_ROOT"]
lines = []
found = False
for line in path.read_text(encoding="utf-8").splitlines():
    if line.startswith("LAB_HOST_ROOT="):
        lines.append(f"LAB_HOST_ROOT={new}")
        found = True
    else:
        lines.append(line)
if not found:
    lines.append(f"LAB_HOST_ROOT={new}")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY2
}

docker_compose() {
  # Use $root as project-directory so the CLI can read YAML and upload build
  # contexts from the bind mount. Absolute host binds use LAB_HOST_ROOT in .env.
  ensure_lab_host_root
  docker compose --project-directory "${root}" --env-file "${root}/.env" "$@"
}
ensure_modulab_network() {
  # Shared bridge used by Immich/n8n/etc. Must be external in compose files —
  # creating it via `docker network create` (no compose labels) is intentional.
  if ! docker network inspect modulab >/dev/null 2>&1; then
    docker network create modulab >/dev/null
  fi
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
  local files=(-f "${root}/docker-compose.${name}.yml")
  append_stack_override "$name" files
  docker_compose "${files[@]}" "$@"
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
  append_stack_override pihole files
  docker_compose "${files[@]}" "$@"
}

caddy_compose() {
  local files=(-f "${root}/docker-compose.caddy.yml")
  if lan_proxy_enabled; then
    # Linux: host networking + 127.0.0.1 upstreams.
    # Docker Desktop (Windows/macOS): publish :80 and reach apps via host.docker.internal.
    if docker_desktop; then
      files+=(-f "${root}/docker-compose.caddy.proxy-ports.desktop.yml")
    else
      files+=(-f "${root}/docker-compose.caddy.proxy-ports.yml")
    fi
  fi
  append_stack_override caddy files
  docker_compose "${files[@]}" "$@"
}

# True if id is listed in lab.config.json enabled[].
stack_is_enabled() {
  local id="$1"
  LAB_ROOT="$root" STACK_ID="$id" python3 - <<'PY'
import json, os
from pathlib import Path
root = Path(os.environ["LAB_ROOT"])
want = os.environ["STACK_ID"]
path = root / "lab.config.json"
if not path.is_file():
    raise SystemExit(1)
data = json.loads(path.read_text(encoding="utf-8"))
enabled = data.get("enabled") or []
raise SystemExit(0 if want in enabled else 1)
PY
}

container_exists() {
  local name="$1"
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"
}

# After install/uninstall/render: recreate Pi-hole + Caddy when LAN proxy is on
# and those stacks are enabled or already present, so DNS/proxy pick up new recipes.
refresh_edge_stacks() {
  if ! lan_proxy_enabled; then
    echo "LAN proxy disabled — skip edge refresh" >&2
    return 0
  fi

  python3 "${root}/scripts/generate-edge.py" >/dev/null 2>&1 || true

  if stack_is_enabled pihole || container_exists pihole; then
    echo "Refreshing Pi-hole (LAN DNS)..." >&2
    pihole_compose up -d --force-recreate || echo "warning: Pi-hole refresh failed" >&2
  fi
  if stack_is_enabled caddy || container_exists caddy; then
    echo "Refreshing Caddy (LAN proxy)..." >&2
    caddy_compose up -d --force-recreate || echo "warning: Caddy refresh failed" >&2
  fi
}

stack_down() {
  local name="$1"
  shift
  case "$name" in
    caddy) caddy_compose down "$@" ;;
    pihole) pihole_compose down "$@" ;;
    *)
      if [[ -f "${root}/docker-compose.${name}.yml" ]]; then
        local files=(-f "${root}/docker-compose.${name}.yml")
        append_stack_override "$name" files
        docker_compose "${files[@]}" down "$@"
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
  local line val
  [[ -f "${root}/.env" ]] || return 1
  line="$(grep -E '^ENABLE_LAN_PROXY=' "${root}/.env" | head -1 || true)"
  val="${line#ENABLE_LAN_PROXY=}"
  val="${val%%$'\r'}"
  [[ "$val" == "true" ]]
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
