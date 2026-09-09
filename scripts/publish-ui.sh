#!/usr/bin/env bash
# Build Angular UI and publish into control-center/wwwroot (keeps *.json config).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI="$ROOT/control-center/ui"
WWW="$ROOT/control-center/wwwroot"
DIST="$UI/dist/control-center/browser"

cd "$UI"
npm ci --prefer-offline
npm run build

mkdir -p "$WWW"
# Preserve JSON configs written by the API / user
shopt -s nullglob
tmp="$(mktemp -d)"
for f in "$WWW"/*.json; do
  cp -a "$f" "$tmp/"
done

# Replace SPA assets
find "$WWW" -mindepth 1 -maxdepth 1 ! -name '*.json' -exec rm -rf {} +
cp -a "$DIST"/. "$WWW"/

for f in "$tmp"/*.json; do
  cp -a "$f" "$WWW/"
done
rm -rf "$tmp"

echo "Published Angular UI → $WWW"
