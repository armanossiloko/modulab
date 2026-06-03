#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ ! -f .env.pihole ]]; then
  cp .env.pihole.example .env.pihole
  echo "Created .env.pihole — set PIHOLE_PASSWORD before use."
fi

docker compose --env-file .env.pihole -f docker-compose.pihole.yml up -d
echo "Pi-hole admin: http://127.0.0.1:5080/admin"
echo "DNS (loopback): 127.0.0.1:53"
