#!/usr/bin/env bash
# Copy .env.<stack>.example → .env.<stack> (never overwrites existing files).
# Run once after clone, edit the .env files, then start stacks with scripts/start.sh

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=common.sh
source "${root}/scripts/common.sh"

echo "Lab setup: creating local env files from examples..." >&2

for example in "${root}"/.env.*.example; do
  [[ -f "$example" ]] || continue
  base="$(basename "$example")"
  name="${base#.env.}"
  name="${name%.example}"
  copy_stack_env "$name"
done

if [[ -f odysseus/.env.example ]]; then
  if [[ -f odysseus/.env ]]; then
    echo "keep odysseus/.env (already exists)" >&2
  else
    cp odysseus/.env.example odysseus/.env
    echo "created odysseus/.env from odysseus/.env.example" >&2
  fi
else
  echo "skip odysseus: submodule not initialized (git submodule update --init odysseus)" >&2
fi

cat <<'EOF'

Setup finished.

Next:
  1. Edit .env.* at the repo root (passwords, timezone, paths).
  2. Edit odysseus/.env if you use Odysseus.
  3. Start a stack: bash scripts/start.sh <stack>
     or use Run and Debug → "<Stack> up" in VS Code.

Stacks: jellyfin n8n seerr it-tools stirling-pdf postgres immich pihole odysseus
EOF
