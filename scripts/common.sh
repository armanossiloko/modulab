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

print_stack_url() {
  local name="$1"
  case "$name" in
    jellyfin) echo "Jellyfin: http://localhost:8096" ;;
    n8n) echo "n8n: http://127.0.0.1:5678" ;;
    seerr) echo "Seerr: http://localhost:5055" ;;
    it-tools) echo "IT-Tools: http://localhost:8083" ;;
    stirling-pdf) echo "Stirling PDF: http://localhost:8082" ;;
    immich) echo "Immich: http://127.0.0.1:2283" ;;
    pihole)
      echo "Pi-hole admin: http://127.0.0.1:5080/admin"
      echo "DNS (loopback): 127.0.0.1:53"
      ;;
    postgres) echo "Postgres: 127.0.0.1:5432 (modulab-db / hostname postgres)" ;;
    odysseus) echo "Odysseus: http://localhost:7000" ;;
    *) echo "Started ${name}" ;;
  esac
}

wait_for_postgres() {
  set -a && source "${root}/.env.postgres" && set +a
  local user="${POSTGRES_USER:-modulab}"
  local db="${POSTGRES_DB:-modulab}"
  until docker exec postgres pg_isready -U "${user}" -d "${db}" >/dev/null 2>&1; do sleep 1; done
}
