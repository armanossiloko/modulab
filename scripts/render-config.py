#!/usr/bin/env python3
"""Render a single .env + postgres/bootstrap.sql from lab.config.json + catalog recipes.

Hand-edit lab.config.json only. Do not edit generated .env.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "lab.config.json"
CATALOG = ROOT / "catalog"
SECRETS_DIR = ROOT / "secrets"
ENV_PATH = ROOT / ".env"
BOOTSTRAP_PATH = ROOT / "postgres" / "bootstrap.sql"

# Keys that must be absolute host paths for Docker Desktop bind mounts.
HOST_PATH_KEYS = (
    "MODULAB_HOST_ROOT",
    "UPLOAD_LOCATION",
    "FUTO_NOTES_DATA_DIR",
)

GENERATED_HEADER = (
    "# GENERATED from lab.config.json — do not edit.\n"
    "#   bash scripts/render-config.sh\n\n"
)

BOOTSTRAP_HEADER = """\
-- GENERATED from lab.config.json + catalog recipes — do not edit.
-- Regenerate: bash scripts/render-config.sh
-- Idempotent: safe to re-run on every postgres up.

"""


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def resolve_secret(name: str) -> str:
    candidates = [
        SECRETS_DIR / name,
        SECRETS_DIR / f"{name}.txt",
        SECRETS_DIR / f"{name}.secret",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8").strip()
    raise SystemExit(
        f"Missing secret file for '{name}'. Create one of:\n"
        + "\n".join(f"  - {path.relative_to(ROOT)}" for path in candidates)
    )


def resolve_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith("$secret:"):
        return resolve_secret(value.removeprefix("$secret:"))
    return value


def normalize_host_path(path: str) -> str:
    return path.replace("\\", "/").rstrip("/")


def is_usable_host_root(path: str) -> bool:
    """Reject container-only /lab and corrupted Desktop values (D:Developmentmodulab)."""
    p = normalize_host_path(path)
    if not p or p in (".", "/lab"):
        return False
    if re.match(r"^[A-Za-z]:/", p):
        return True
    return p.startswith("/") and p != "/lab"


def read_env_lab_host_root() -> str | None:
    if not ENV_PATH.is_file():
        return None
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("MODULAB_HOST_ROOT="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            return value or None
    return None


def detect_lab_host_root_from_docker() -> str | None:
    """When render runs inside Control Center (/lab), ask the daemon for the bind source."""
    try:
        hostname = subprocess.check_output(["hostname"], text=True, stderr=subprocess.DEVNULL).strip()
        out = subprocess.check_output(
            [
                "docker",
                "inspect",
                hostname,
                "--format",
                '{{range .Mounts}}{{if eq .Destination "/lab"}}{{.Source}}{{end}}{{end}}',
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    if not out:
        return None
    candidate = normalize_host_path(out)
    return candidate if is_usable_host_root(candidate) else None


def resolve_lab_host_root() -> str:
    """Absolute host checkout path for Compose volume binds (never container-only /lab)."""
    for candidate in (
        os.environ.get("MODULAB_HOST_ROOT", "").strip(),
        read_env_lab_host_root() or "",
    ):
        if candidate and is_usable_host_root(candidate):
            return normalize_host_path(candidate)

    root_s = normalize_host_path(str(ROOT))
    if root_s in ("/lab",):
        detected = detect_lab_host_root_from_docker()
        if detected:
            return detected

    if is_usable_host_root(root_s):
        return root_s
    return root_s


def absolutize_host_path(value: Any, host_root: str) -> Any:
    """Turn relative checkout paths into absolute host binds."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text.startswith("$"):
        return value
    norm = normalize_host_path(text)
    if is_usable_host_root(norm):
        return norm
    # Relative to lab root (./data/... or data/...)
    if norm.startswith("./"):
        norm = norm[2:]
    elif norm.startswith(".\\"):
        norm = norm[2:]
    return normalize_host_path(f"{host_root}/{norm}")


def stringify(value: Any) -> str:
    value = resolve_value(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    # Quote when bash `source .env` would misparse (e.g. PIHOLE_UPSTREAM_DNS=1.1.1.1;1.0.0.1)
    if any(ch in text for ch in ' \t\n#"\'\\$`;&|<>()'):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def load_recipes() -> dict[str, dict[str, Any]]:
    recipes: dict[str, dict[str, Any]] = {}
    if not CATALOG.is_dir():
        return recipes
    for path in sorted(CATALOG.glob("*/recipe.json")):
        data = load_json(path)
        if isinstance(data, dict) and data.get("id"):
            recipes[str(data["id"])] = data
    return recipes


def flat_env(config: dict[str, Any], recipes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    lab = config.get("lab")
    if not isinstance(lab, dict):
        raise SystemExit("lab.config.json: 'lab' must be an object")

    domain = str(lab.get("domain", "network.lan"))
    timezone = str(lab.get("timezone", "UTC"))
    pg_user = str(lab.get("postgresUser", "modulab"))
    pg_pass = str(lab.get("postgresPassword", "modulab"))
    pg_db = str(lab.get("postgresDb", "modulab"))

    host_root = resolve_lab_host_root()

    env: dict[str, Any] = {
        "TZ": timezone,
        "POSTGRES_USER": pg_user,
        "POSTGRES_PASSWORD": pg_pass,
        "POSTGRES_DB": pg_db,
        "PIHOLE_LOCAL_DOMAIN": domain,
        "MODULAB_HOST_IP": lab.get("hostIp", "127.0.0.1"),
        # Absolute host checkout path for Compose bind mounts (set again below).
        "MODULAB_HOST_ROOT": host_root,
        "PIHOLE_PASSWORD": lab.get("piholePassword", "modulab"),
        "PS_SHARED_SECRET": lab.get("picoshareAdminSecret", "modulab"),
        "SEARXNG_SECRET": lab.get("searxngSecret", "modulab"),
        "SEARXNG_PORT": 8080,
        "SEARXNG_BASE_URL": "http://localhost:8080/",
        "FUTO_NOTES_PASSWORD": lab.get("futoNotesPassword", "modulab"),
        "FUTO_NOTES_PORT": 3005,
        "FUTO_NOTES_IMAGE": "futotech/notes-server:stable",
        "FUTO_NOTES_COOKIE_SECURE": False,
        "FUTO_NOTES_BLOB_GC_ENABLED": True,
        "FUTO_NOTES_DATA_DIR": f"{host_root}/data/futo-notes",
        "MODULAB_ROOT": "/lab",
        "HOME_PORT": 8888,
        "ASPNETCORE_URLS": "http://0.0.0.0:8888",
        "DOTNET_gcServer": "0",
        "DOTNET_EnableDiagnostics": "0",
        "ENABLE_LAN_PROXY": False,
        # Publish HTTP apps on all interfaces so http://<MODULAB_HOST_IP>:<port> works on the LAN.
        # Postgres stays on loopback. Caddy still proxies via 127.0.0.1.
        "MODULAB_PUBLISH_IP": "0.0.0.0",
        "UPSTREAM_HOST": "127.0.0.1",
        "CADDY_TAG": "2-alpine",
        "N8N_HOST": f"n8n.{domain}",
        "WEBHOOK_URL": f"http://n8n.{domain}/",
        "N8N_PROTOCOL": "http",
        "N8N_SECURE_COOKIE": False,
        "N8N_DB_NAME": "n8n",
        "IMMICH_DB_NAME": "immich",
        "IMMICH_VERSION": "v3",
        "UPLOAD_LOCATION": f"{host_root}/data/immich/library",
        "PIHOLE_UPSTREAM_DNS": "1.1.1.1;1.0.0.1",
        "PIHOLE_TAG": "2025.03.0",
        "PORT": 4001,
        "PS_BEHIND_PROXY": bool(lab.get("enableLanProxy") is True),
        "SECURITY_ENABLELOGIN": False,
        "LANGS": "en_GB",
        "DISABLE_IPV6": False,
        "LOG_LEVEL": "info",
    }

    # Recipe defaults (non-install form) then per-stack config overrides
    for recipe_id, recipe in recipes.items():
        defaults = recipe.get("defaults")
        if isinstance(defaults, dict):
            for key, value in defaults.items():
                env.setdefault(key, value)
        db_name = recipe.get("database")
        if isinstance(db_name, str) and db_name:
            env.setdefault(f"{recipe_id.upper().replace('-', '_')}_DB_NAME", db_name)

    for key, section in config.items():
        if key in ("lab", "enabled", "_comment") or not isinstance(section, dict):
            continue
        for sk, sv in section.items():
            env[sk] = sv

    # Lab-level aliases win for shared infra
    env["TZ"] = timezone
    env["POSTGRES_USER"] = pg_user
    env["POSTGRES_PASSWORD"] = pg_pass
    env["POSTGRES_DB"] = pg_db
    env["PIHOLE_LOCAL_DOMAIN"] = domain
    env["MODULAB_HOST_IP"] = lab.get("hostIp", "127.0.0.1")
    env["MODULAB_HOST_ROOT"] = host_root
    env["GENERIC_TIMEZONE"] = timezone

    # Relative path overrides from lab.config / recipes must become host binds.
    for key in HOST_PATH_KEYS:
        if key in env:
            env[key] = absolutize_host_path(env[key], host_root)
    env["MODULAB_HOST_ROOT"] = host_root

    # When LAN proxy is on, prefer *.domain URLs for apps that advertise a public base URL.
    lan = env.get("ENABLE_LAN_PROXY")
    lan_on = lan is True or str(lan).lower() == "true"
    if lan_on:
        env["PS_BEHIND_PROXY"] = True
        if env.get("SEARXNG_BASE_URL") in ("http://localhost:8080/", "http://127.0.0.1:8080/"):
            env["SEARXNG_BASE_URL"] = f"http://searxng.{domain}/"

    return env


def write_env(env: dict[str, Any]) -> None:
    lines = [GENERATED_HEADER.rstrip(), ""]
    for key in sorted(env):
        value = env[key]
        if value is None:
            continue
        if isinstance(value, str) and value == "":
            continue
        lines.append(f"{key}={stringify(value)}")
    # Force LF so Linux containers never see ENABLE_LAN_PROXY=true\\r
    with ENV_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


def databases_to_create(config: dict[str, Any], recipes: dict[str, dict[str, Any]]) -> list[tuple[str, bool]]:
    """Return (db_name, needs_vector) declared by recipes."""
    dbs: list[tuple[str, bool]] = []
    seen: set[str] = set()
    lab = config.get("lab") if isinstance(config.get("lab"), dict) else {}
    default_db = str(lab.get("postgresDb", "modulab"))

    for recipe in recipes.values():
        db = recipe.get("database")
        if not isinstance(db, str) or not db or db == default_db:
            continue
        if db in seen:
            continue
        seen.add(db)
        dbs.append((db, bool(recipe.get("databaseNeedsVector"))))
    return dbs


def write_bootstrap(dbs: list[tuple[str, bool]], pg_user: str) -> None:
    # CREATE DATABASE cannot run inside DO $$ / a transaction block.
    # \gexec runs the SELECT result as SQL only when a row is returned.
    parts = [BOOTSTRAP_HEADER]
    for name, needs_vector in dbs:
        parts.append(
            f"SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', '{name}', '{pg_user}', 'UTF8')\n"
            f"WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '{name}')\\gexec\n"
        )
        if needs_vector:
            parts.append(
                f"\\c {name}\n"
                f"CREATE EXTENSION IF NOT EXISTS vector;\n"
                f"CREATE EXTENSION IF NOT EXISTS vectors;\n"
            )
    BOOTSTRAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    with BOOTSTRAP_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(parts).rstrip() + "\n")


def render(config_path: Path) -> None:
    config = load_json(config_path)
    if not isinstance(config, dict):
        raise SystemExit("lab.config.json: root must be an object")

    recipes = load_recipes()
    env = flat_env(config, recipes)
    write_env(env)

    lab = config.get("lab") if isinstance(config.get("lab"), dict) else {}
    pg_user = str(lab.get("postgresUser", "modulab"))
    write_bootstrap(databases_to_create(config, recipes), pg_user)


def main() -> int:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CONFIG_PATH
    if not config_path.is_file():
        example = ROOT / "lab.config.example.json"
        print(f"Missing {config_path}", file=sys.stderr)
        if example.is_file():
            print(f"Copy {example.name} to lab.config.json and edit it.", file=sys.stderr)
        return 1

    render(config_path)
    print(f"Rendered {ENV_PATH.relative_to(ROOT)} and {BOOTSTRAP_PATH.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
