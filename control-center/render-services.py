"""Generate control-center/wwwroot/services.json from catalog recipes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
CONFIG_PATH = ROOT / "lab.config.json"
OUTPUT_PATH = ROOT / "control-center" / "wwwroot" / "services.json"


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_enabled() -> set[str] | None:
    if not CONFIG_PATH.is_file():
        return None
    config = load_json(CONFIG_PATH)
    if not isinstance(config, dict) or "enabled" not in config:
        return None
    enabled = config.get("enabled")
    if not isinstance(enabled, list):
        return None
    return {str(item) for item in enabled if isinstance(item, str)}


def load_recipes() -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    if not CATALOG.is_dir():
        return recipes
    for path in sorted(CATALOG.glob("*/recipe.json")):
        data = load_json(path)
        if isinstance(data, dict) and data.get("id"):
            recipes.append(data)
    return recipes


def entry_from_recipe(recipe: dict[str, Any]) -> dict[str, Any] | None:
    port = recipe.get("port")
    if not isinstance(port, int):
        return None
    entry: dict[str, Any] = {
        "label": recipe["id"],
        "name": str(recipe.get("name") or recipe["id"]),
        "description": str(recipe.get("description") or ""),
        "category": str(recipe.get("category") or "other"),
        "port": port,
        "compose": str(recipe.get("compose") or f"docker-compose.{recipe['id']}.yml"),
        "installable": bool(recipe.get("installable", True)),
        "core": bool(recipe.get("core", False)),
    }
    path = recipe.get("path")
    if isinstance(path, str) and path:
        entry["path"] = path
    return entry


def extra_entries(recipe: dict[str, Any]) -> list[dict[str, Any]]:
    extras: list[dict[str, Any]] = []
    for extra in recipe.get("extraServices") or []:
        if not isinstance(extra, dict):
            continue
        label = extra.get("label")
        port = extra.get("port")
        if not isinstance(label, str) or not isinstance(port, int):
            continue
        extras.append(
            {
                "label": label,
                "name": str(extra.get("name") or label),
                "description": str(extra.get("description") or ""),
                "category": str(extra.get("category") or recipe.get("category") or "other"),
                "port": port,
                "compose": str(recipe.get("compose") or ""),
                "parent": recipe["id"],
                "installable": False,
                "core": False,
            }
        )
    return extras


def render() -> list[dict[str, Any]]:
    recipes = load_recipes()
    enabled = load_enabled()
    by_label: dict[str, dict[str, Any]] = {}

    for recipe in recipes:
        entry = entry_from_recipe(recipe)
        if entry is not None:
            rid = entry["label"]
            if enabled is not None:
                entry["enabled"] = rid in enabled or bool(recipe.get("core"))
            by_label[rid] = entry
        for extra in extra_entries(recipe):
            parent = extra.get("parent")
            if enabled is not None and isinstance(parent, str):
                extra["enabled"] = parent in enabled
            by_label[extra["label"]] = extra

    return sorted(by_label.values(), key=lambda item: (item.get("category", ""), item["name"]))


def main() -> int:
    services = render()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(services, indent=2) + "\n", encoding="utf-8")
    print(f"Rendered {len(services)} service(s) to {OUTPUT_PATH.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
