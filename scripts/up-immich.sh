#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ ! -f .env.immich ]]; then
  cp .env.immich.example .env.immich
  echo "Created .env.immich — set DB_PASSWORD before production use."
fi

docker compose --env-file .env.immich -f docker-compose.immich.yml up -d
echo "Immich: http://127.0.0.1:2283"
