#!/usr/bin/env bash
# Install (enable + start) an app from catalog: bash scripts/install.sh jellyfin
# Optional JSON config: bash scripts/install.sh immich '{"UPLOAD_LOCATION":"./data/immich/library"}'
# Enables dependsOn stacks automatically.

set -euo pipefail
_scripts="$(cd "$(dirname "$0")" && pwd)"
root="${MODULAB_ROOT:-$(cd "${_scripts}/.." && pwd)}"
_scripts="${MODULAB_SCRIPTS:-${_scripts}}"
cd "$root"
# shellcheck source=common.sh
source "${_scripts}/common.sh"

id="${1:?Usage: bash scripts/install.sh <recipe-id> [json-config]}"
config_json="${2:-{}}"
recipe="${root}/catalog/${id}/recipe.json"

if [[ ! -f "$recipe" ]]; then
  echo "Unknown recipe '${id}'. Expected ${recipe}" >&2
  exit 1
fi

MODULAB_ROOT="$root" RECIPE_ID="$id" CONFIG_JSON="$config_json" python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["MODULAB_ROOT"])
recipe_id = os.environ["RECIPE_ID"]
config_path = root / "lab.config.json"
example = root / "lab.config.example.json"
recipes = {}
for path in (root / "catalog").glob("*/recipe.json"):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and data.get("id"):
        recipes[data["id"]] = data

recipe = recipes.get(recipe_id)
if not recipe:
    raise SystemExit(f"Unknown recipe {recipe_id}")

if not config_path.is_file():
    config_path.write_text(
        example.read_text(encoding="utf-8") if example.is_file() else '{"lab":{},"enabled":[]}\n',
        encoding="utf-8",
    )

data = json.loads(config_path.read_text(encoding="utf-8"))
enabled = data.setdefault("enabled", [])
if not isinstance(enabled, list):
    raise SystemExit("lab.config.json: enabled must be an array")

def enable(rid: str) -> None:
    if rid not in enabled:
        enabled.append(rid)

seen: set[str] = set()

def walk(rid: str) -> None:
    if rid in seen:
        return
    seen.add(rid)
    dep_recipe = recipes.get(rid) or {}
    for dep in dep_recipe.get("dependsOn") or []:
        if isinstance(dep, str):
            walk(dep)
    enable(rid)

walk(recipe_id)

# Soft Redis for Immich: use shared if present, else sidecar (do not enable redis stack).
section = data.get(recipe_id)
if not isinstance(section, dict):
    section = {}

prefer = recipe.get("preferShared") or []
if recipe_id == "immich" or (isinstance(prefer, list) and "redis" in prefer):
    redis_ok = "redis" in enabled
    if not redis_ok:
        # Container may exist without being in enabled[]
        import subprocess
        try:
            out = subprocess.check_output(
                ["docker", "ps", "--format", "{{.Names}}"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            redis_ok = any(line.strip() == "redis" for line in out.splitlines())
        except Exception:
            redis_ok = False
    if redis_ok:
        section["REDIS_HOSTNAME"] = "redis"
        section["useSidecarRedis"] = False
    else:
        section["REDIS_HOSTNAME"] = "immich-redis"
        section["useSidecarRedis"] = True

for key, value in (recipe.get("defaults") or {}).items():
    section.setdefault(key, value)

lab = data.get("lab") if isinstance(data.get("lab"), dict) else {}
for field in recipe.get("fields") or []:
    key = field.get("key")
    if not isinstance(key, str):
        continue
    from_lab = field.get("fromLab")
    if from_lab and from_lab in lab and key not in section:
        section[key] = lab[from_lab]
    elif "default" in field and key not in section:
        section[key] = field["default"]

overrides = json.loads(os.environ["CONFIG_JSON"] or "{}")
if not isinstance(overrides, dict):
    raise SystemExit("config must be a JSON object")
section.update(overrides)
# Re-apply redis decision after overrides unless caller forced REDIS_HOSTNAME
if recipe_id == "immich" or (isinstance(prefer, list) and "redis" in prefer):
    if overrides.get("REDIS_HOSTNAME"):
        section["REDIS_HOSTNAME"] = overrides["REDIS_HOSTNAME"]
        section["useSidecarRedis"] = section["REDIS_HOSTNAME"] == "immich-redis"
    elif section.get("useSidecarRedis") is True:
        section["REDIS_HOSTNAME"] = "immich-redis"
    elif "redis" in enabled or section.get("REDIS_HOSTNAME") == "redis":
        section["REDIS_HOSTNAME"] = "redis"
        section["useSidecarRedis"] = False

data[recipe_id] = section
config_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"enabled {', '.join(enabled)}", flush=True)
PY

bash "${_scripts}/render-config.sh"
bash "${_scripts}/start.sh" "$id"
bash "${_scripts}/refresh-edge.sh"
