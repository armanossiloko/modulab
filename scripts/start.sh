#!/usr/bin/env bash
# Start one lab stack. Requires setup first: bash scripts/setup.sh

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

name="${1:?Usage: bash scripts/start.sh <stack>}"
shift

compose="${root}/docker-compose.${name}.yml"
if [[ ! -f "$compose" ]]; then
  echo "Unknown stack '${name}'. No ${compose}" >&2
  echo "Stacks: jellyfin n8n seerr it-tools stirling-pdf postgres immich pihole odysseus" >&2
  exit 1
fi

case "$name" in
  odysseus)
    require_odysseus_env
    docker compose -f "$compose" up -d --build "$@"
    ;;
  postgres)
    require_stack_env postgres
    stack_compose postgres up -d "$@"
    wait_for_postgres
    ;;
  *)
    require_stack_env "$name"
    stack_compose "$name" up -d "$@"
    ;;
esac

print_stack_url "$name"
