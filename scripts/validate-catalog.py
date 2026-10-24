#!/usr/bin/env python3
"""Check catalog/ and catalog.local/ recipes for mistakes before they reach users.

  python3 scripts/validate-catalog.py            # exit 1 when anything is wrong
  python3 scripts/validate-catalog.py --quiet    # print problems only

Checks: required fields, id = folder name, compose file present, unique ports / hostnames,
known dependencies, data paths under data/, env-safe field keys, container names that
Control Center can match to the recipe, and (in a repo checkout) a Library icon.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_catalog  # noqa: E402

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,39}$")
HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
CATEGORIES = {"media", "productivity", "tools", "infrastructure", "other"}
FIELD_TYPES = {"string", "password", "boolean", "number"}
CONTAINER_RE = re.compile(r"^\s*container_name:\s*['\"]?([^'\"\s#]+)", re.M)


def matches_recipe(container: str, recipe_id: str) -> bool:
    """Same rule as Control Center's DockerCli.MatchesRecipe."""
    c, r = container.lower(), recipe_id.lower()
    return (
        c == r
        or c.startswith(r + "-") or c.startswith(r + "_")
        or f"-{r}-" in c or f"_{r}_" in c
        or c.endswith("-" + r) or c.endswith("_" + r)
    )


def validate(root: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    recipes = lab_catalog.load_recipes(root)
    ids = {r["id"] for r in recipes}
    ports: dict[int, str] = {}
    hosts: dict[str, str] = {}
    dns_owner: dict[str, str] = {}
    icons = root / "control-center" / "public" / "app-icons"

    for recipe in recipes:
        rid = recipe["id"]
        where = f"{'catalog.local' if recipe.get('_custom') else 'catalog'}/{rid}"

        def err(msg: str) -> None:
            errors.append(f"{where}: {msg}")

        if not ID_RE.match(rid):
            err("id must be 2–40 chars of lowercase letters, digits and dashes")
        if Path(recipe["_dir"]).name != rid:
            err(f"folder name must equal the id ('{Path(recipe['_dir']).name}' != '{rid}')")
        if not str(recipe.get("name") or "").strip():
            err("name is required")
        if recipe.get("category", "other") not in CATEGORIES:
            err(f"category must be one of {sorted(CATEGORIES)}")

        compose = lab_catalog.compose_file(rid, root)
        if compose is None:
            err("compose file not found")
        else:
            names = CONTAINER_RE.findall(compose.read_text(encoding="utf-8"))
            if not any(matches_recipe(n, rid) for n in names):
                err(f"no container_name matches '{rid}' (use '{rid}' or '{rid}-<service>') — status tracking needs it")

        port = recipe.get("port")
        if port is not None:
            if not isinstance(port, int) or not 1 <= port <= 65535:
                err("port must be an integer 1–65535")
            elif port in ports:
                err(f"port {port} is also used by {ports[port]}")
            else:
                ports[port] = rid

        proxy = recipe.get("proxy")
        if isinstance(proxy, dict):
            if not isinstance(proxy.get("port"), int):
                err("proxy.port must be an integer")
            host = proxy.get("host")
            if not isinstance(host, str) or not HOST_RE.match(host):
                err(f"proxy.host '{host}' is not a valid hostname label")
            elif host in hosts:
                err(f"proxy hostname '{host}' is also used by {hosts[host]}")
            else:
                hosts[host] = rid
        for label in recipe.get("dns") or []:
            if not isinstance(label, str) or not HOST_RE.match(label):
                err(f"dns label '{label}' is not valid")
            elif dns_owner.setdefault(label, rid) != rid:
                warnings.append(f"{where}: dns label '{label}' is also declared by {dns_owner[label]}")

        for dep in recipe.get("dependsOn") or []:
            if dep not in ids:
                err(f"dependsOn '{dep}' is not a known recipe")

        for rel in recipe.get("data") or []:
            norm = str(rel).replace("\\", "/").rstrip("/")
            if not norm.startswith("data/") or ".." in norm or norm == "data/control-center":
                err(f"data path '{rel}' must be a folder under data/")
        backup = recipe.get("backup") or {}
        for rel in backup.get("exclude") or []:
            if not any(str(rel).startswith(str(d).rstrip("/") + "/") for d in recipe.get("data") or []):
                warnings.append(f"{where}: backup.exclude '{rel}' is not inside any data path")

        for field in recipe.get("fields") or []:
            key = field.get("key") if isinstance(field, dict) else None
            if not isinstance(key, str) or not ENV_RE.match(key):
                err(f"field key '{key}' must be a valid environment variable name")
            elif field.get("type", "string") not in FIELD_TYPES:
                err(f"field '{key}' type must be one of {sorted(FIELD_TYPES)}")

        if not recipe.get("_custom") and icons.is_dir() and recipe.get("installable", True) is not False:
            if not (icons / f"{rid}.png").is_file():
                warnings.append(f"{where}: no Library icon at control-center/public/app-icons/{rid}.png")

    return errors, warnings


def main(argv: list[str]) -> int:
    quiet = "--quiet" in argv
    root = lab_catalog.lab_root()
    errors, warnings = validate(root)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    if not quiet:
        count = len(lab_catalog.load_recipes(root))
        print(f"{count} recipe(s), {len(errors)} error(s), {len(warnings)} warning(s)", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
