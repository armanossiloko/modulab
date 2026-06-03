#!/usr/bin/env bash
# Shared helpers for scripts/setup.sh, scripts/start.sh, and scripts/stop.sh

# Default stack order for start.sh all (Pi-hole + Caddy are separate optional stacks).
LAB_STACKS=(
  caddy
  postgres
  jellyfin
  n8n
  seerr
  it-tools
  stirling-pdf
  immich
  odysseus
)

copy_stack_env() {
  local name="$1"
  local example="${root}/.env.${name}.example"
  local envfile="${root}/.env.${name}"

  if [[ ! -f "$example" ]]; then
    echo "skip ${name}: no ${example}" >&2
    return 0
  fi

  if [[ -f "$envfile" ]]; then
    echo "keep .env.${name} (already exists)" >&2
    return 0
  fi

  cp "$example" "$envfile"
  echo "created .env.${name} from .env.${name}.example" >&2
}

require_stack_env() {
  local name="$1"
  local envfile="${root}/.env.${name}"

  if [[ ! -f "$envfile" ]]; then
    echo "Missing ${envfile}. Run: bash scripts/setup.sh" >&2
    exit 1
  fi
}

stack_compose() {
  local name="$1"
  shift
  docker compose --env-file "${root}/.env.${name}" -f "${root}/docker-compose.${name}.yml" "$@"
}

caddy_compose() {
  local files=(-f "${root}/docker-compose.caddy.yml")
  if lan_proxy_enabled; then
    files+=(-f "${root}/docker-compose.caddy.proxy-ports.yml")
  fi
  docker compose --env-file "${root}/.env.caddy" "${files[@]}" "$@"
}

stack_down() {
  local name="$1"
  shift
  if [[ "$name" == caddy ]]; then
    caddy_compose down "$@"
    return
  fi

  local compose="${root}/docker-compose.${name}.yml"
  local envfile="${root}/.env.${name}"

  if [[ -f "$envfile" ]]; then
    stack_compose "$name" down "$@"
  else
    docker compose -f "$compose" down "$@"
  fi
}

require_odysseus_env() {
  if [[ ! -f "${root}/odysseus/.env" ]]; then
    echo "Missing odysseus/.env. Run: bash scripts/setup.sh" >&2
    exit 1
  fi
}

lab_dashboard_url() {
  local port="8888"
  if [[ -f "${root}/.env.caddy" ]]; then
    local line
    line="$(grep -E '^HOME_PORT=' "${root}/.env.caddy" | head -1 || true)"
    [[ -n "$line" ]] && port="${line#HOME_PORT=}" && port="${port%%$'\r'}"
  fi
  echo "http://127.0.0.1:${port}"
}

lan_proxy_enabled() {
  local line
  [[ -f "${root}/.env.caddy" ]] || return 1
  line="$(grep -E '^ENABLE_LAN_PROXY=' "${root}/.env.caddy" | head -1 || true)"
  [[ "${line#ENABLE_LAN_PROXY=}" == "true" ]]
}

lab_domain() {
  local f key line
  for f in "${root}/.env.caddy" "${root}/.env.pihole"; do
    [[ -f "$f" ]] || continue
    line="$(grep -E '^PIHOLE_LOCAL_DOMAIN=' "$f" | head -1 || true)"
    if [[ -n "$line" ]]; then
      echo "${line#PIHOLE_LOCAL_DOMAIN=}" | tr -d '\r'
      return 0
    fi
  done
  echo "network.lan"
}

lab_url() {
  local label="$1"
  local path="${2:-}"
  echo "http://${label}.$(lab_domain)${path}"
}

print_lab_urls() {
  local domain
  domain="$(lab_domain)"
  cat <<EOF
Dashboard: $(lab_dashboard_url)

Optional network.lan URLs (requires Pi-hole + Caddy, domain ${domain}):
  $(lab_url jellyfin)
  $(lab_url n8n)
  $(lab_url seerr)
  $(lab_url it-tools)
  $(lab_url stirling)
  $(lab_url immich)
  $(lab_url odysseus)
  $(lab_url searxng)
  $(lab_url ntfy)
  $(lab_url pihole /admin)
  postgres.${domain}:5432
EOF
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
    immich) echo "Immich: $(lab_url immich)" ;;
    pihole)
      echo "Pi-hole admin: $(lab_url pihole /admin)"
      echo "DNS (loopback): 127.0.0.1:53"
      ;;
    caddy)
      echo "Dashboard: $(lab_dashboard_url)"
      if lan_proxy_enabled; then
        echo "network.lan proxy: enabled (port 80 — use with Pi-hole DNS)"
      else
        echo "network.lan proxy: disabled (set ENABLE_LAN_PROXY=true in .env.caddy to enable)"
      fi
      ;;
    postgres) echo "Postgres: postgres.${domain}:5432" ;;
    odysseus)
      echo "Odysseus: $(lab_url odysseus)"
      echo "SearXNG: $(lab_url searxng)"
      echo "ntfy: $(lab_url ntfy)"
      ;;
    *) echo "Started ${name}" ;;
  esac
}

wait_for_postgres() {
  set -a && source "${root}/.env.postgres" && set +a
  local user="${POSTGRES_USER:-modulab}"
  local db="${POSTGRES_DB:-modulab}"
  until docker exec postgres pg_isready -U "${user}" -d "${db}" >/dev/null 2>&1; do sleep 1; done
}
