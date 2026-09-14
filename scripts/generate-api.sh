#!/usr/bin/env bash
# Regenerate OpenAPI from the .NET API, then the Angular HTTP client.
set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
ROOT="${LAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$ROOT"

echo "==> OpenAPI (dotnet build)"
dotnet build "$ROOT/control-center/src-backend/Modulab.ControlCenter/Modulab.ControlCenter.csproj" -c Debug --nologo

OPENAPI="$ROOT/control-center/openapi/openapi.json"
if [[ ! -f "$OPENAPI" ]]; then
  echo "Missing $OPENAPI after build" >&2
  exit 1
fi

echo "==> Angular client (@hey-api/openapi-ts)"
cd "$ROOT/control-center"
npm run generate:api

echo "Done: $OPENAPI → control-center/src/app/api/generated/"
