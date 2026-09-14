#!/usr/bin/env bash
# Verify host dependencies required to run Modulab (not for developing Control Center UI).
set -euo pipefail

missing=0

need() {
  local bin="$1"
  local hint="$2"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing: ${bin} — ${hint}" >&2
    missing=1
  fi
}

need bash "required to run scripts/"
need python3 "required for render-config / install / edge generation"
need docker "install Docker Engine: https://docs.docker.com/engine/install/"

if command -v docker >/dev/null 2>&1; then
  if ! docker compose version >/dev/null 2>&1; then
    echo "Missing: docker compose (v2 plugin) — https://docs.docker.com/compose/install/" >&2
    missing=1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not usable (daemon down, or user not in 'docker' group)." >&2
    echo "  Try: sudo usermod -aG docker \"\$USER\"  then log out/in" >&2
    missing=1
  fi
  if ! docker buildx version >/dev/null 2>&1; then
    echo "Warning: docker buildx not found — Control Center image updates may fail." >&2
  fi
fi

if [[ "$missing" -ne 0 ]]; then
  echo "" >&2
  echo "Fix the issues above, then re-run: bash scripts/setup.sh" >&2
  exit 1
fi

echo "Dependencies OK (bash, python3, docker compose)." >&2
