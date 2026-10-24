#!/usr/bin/env python3
"""Shared recipe loading for Modulab scripts.

Recipes live in two places:
  catalog/<id>/recipe.json        built-in, refreshed from the image on every start
  catalog.local/<id>/recipe.json  user-defined (Control Center → Library → Add app), never overwritten

A local recipe may not reuse a built-in id. Customise built-ins with
docker-compose.<id>.override.yml instead.

CLI (used by the bash scripts):
  python3 scripts/lab_catalog.py compose-file <id>   absolute compose path, or nothing
  python3 scripts/lab_catalog.py depends <id>        hard dependencies, deps first
  python3 scripts/lab_catalog.py ids                 every recipe id
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


def lab_root() -> Path:
    override = os.environ.get("MODULAB_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parent.parent


def _load_dir(directory: Path, custom: bool) -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    if not directory.is_dir():
        return recipes
    for path in sorted(directory.glob("*/recipe.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"warning: skipping {path}: {exc}", file=sys.stderr)
            continue
        if isinstance(data, dict) and isinstance(data.get("id"), str) and data["id"]:
            data["_custom"] = custom
            data["_dir"] = str(path.parent)
            recipes.append(data)
    return recipes


def load_recipes(root: Path | None = None) -> list[dict[str, Any]]:
    """Built-in recipes first, then local ones whose id is not taken."""
    root = root or lab_root()
    builtin = _load_dir(root / "catalog", custom=False)
    taken = {r["id"] for r in builtin}
    result = list(builtin)
    for recipe in _load_dir(root / "catalog.local", custom=True):
        if recipe["id"] in taken:
            print(
                f"warning: catalog.local/{recipe['id']} ignored: id is used by a built-in app",
                file=sys.stderr,
            )
            continue
        taken.add(recipe["id"])
        result.append(recipe)
    return result


def recipes_by_id(root: Path | None = None) -> dict[str, dict[str, Any]]:
    return {r["id"]: r for r in load_recipes(root)}


def compose_file(recipe_id: str, root: Path | None = None) -> Path | None:
    """docker-compose.<id>.yml at the lab root, else the recipe's compose (catalog.local)."""
    root = root or lab_root()
    builtin = root / f"docker-compose.{recipe_id}.yml"
    if builtin.is_file():
        return builtin
    recipe = recipes_by_id(root).get(recipe_id)
    if not recipe:
        return None
    rel = recipe.get("compose")
    candidates = []
    if isinstance(rel, str) and rel:
        candidates.append(root / rel)
    if recipe.get("_custom"):
        candidates.append(Path(recipe["_dir"]) / "docker-compose.yml")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def depends(recipe_id: str, root: Path | None = None) -> list[str]:
    """Hard dependencies (dependsOn, recursive), dependencies before dependents, excluding recipe_id."""
    recipes = recipes_by_id(root)
    ordered: list[str] = []
    seen: set[str] = set()

    def walk(rid: str) -> None:
        if rid in seen:
            return
        seen.add(rid)
        for dep in (recipes.get(rid) or {}).get("dependsOn") or []:
            if isinstance(dep, str):
                walk(dep)
        if rid != recipe_id:
            ordered.append(rid)

    walk(recipe_id)
    return ordered


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "compose-file" and len(argv) == 3:
        path = compose_file(argv[2])
        if path:
            print(path)
        return 0
    if cmd == "depends" and len(argv) == 3:
        print("\n".join(depends(argv[2])))
        return 0
    if cmd == "ids":
        print("\n".join(r["id"] for r in load_recipes()))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
