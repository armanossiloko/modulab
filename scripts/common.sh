#!/usr/bin/env bash
# Shared helpers for scripts/setup.sh and scripts/start.sh

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

require_odysseus_env() {
  if [[ ! -f "${root}/odysseus/.env" ]]; then
    echo "Missing odysseus/.env. Run: bash scripts/setup.sh" >&2
    exit 1
  fi
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
Lab URLs (Pi-hole + Caddy on port 80, domain ${domain}):
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
    caddy) print_lab_urls ;;
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
