#!/usr/bin/env python3
"""Render stack .env files from lab.config.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "lab.config.json"
SECRETS_DIR = ROOT / "secrets"
GENERATED_HEADER = (
    "# Generated from lab.config.json — edit that file, then run:\n"
    "#   bash scripts/render-config.sh\n\n"
)

# Maps lab.config.json service keys to .env.<name> filenames.
SERVICE_ENV_FILES: dict[str, str] = {
    "caddy": ".env.caddy",
    "postgres": ".env.postgres",
    "pihole": ".env.pihole",
    "n8n": ".env.n8n",
    "jellyfin": ".env.jellyfin",
    "seerr": ".env.seerr",
    "it-tools": ".env.it-tools",
    "stirling-pdf": ".env.stirling-pdf",
    "bentopdf": ".env.bentopdf",
    "picoshare": ".env.picoshare",
    "immich": ".env.immich",
    "odysseus": "odysseus/.env",
}


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"{path}: root must be a JSON object")
    return data


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


def stringify(value: Any) -> str:
    value = resolve_value(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def merge_lab_defaults(lab: dict[str, Any], service: str, values: dict[str, Any]) -> dict[str, Any]:
    merged = dict(values)
    domain = lab.get("domain", "network.lan")
    timezone = lab.get("timezone", "UTC")

    if service == "caddy":
        merged.setdefault("PIHOLE_LOCAL_DOMAIN", domain)

    elif service == "pihole":
        merged.setdefault("PIHOLE_LOCAL_DOMAIN", domain)
        merged.setdefault("LAB_HOST_IP", lab.get("hostIp", "127.0.0.1"))
        merged.setdefault("TZ", timezone)
        merged.setdefault("PIHOLE_PASSWORD", lab.get("piholePassword", "change-me"))

    elif service == "postgres":
        merged.setdefault("POSTGRES_USER", lab.get("postgresUser", "modulab"))
        merged.setdefault("POSTGRES_PASSWORD", lab.get("postgresPassword", "modulab"))
        merged.setdefault("POSTGRES_DB", lab.get("postgresDb", "modulab"))

    elif service == "n8n":
        merged.setdefault("N8N_HOST", f"n8n.{domain}")
        merged.setdefault("WEBHOOK_URL", f"http://n8n.{domain}/")
        merged.setdefault("GENERIC_TIMEZONE", timezone)
        merged.setdefault("TZ", timezone)

    elif service == "jellyfin":
        merged.setdefault("TZ", timezone)

    elif service == "seerr":
        merged.setdefault("TZ", timezone)

    elif service == "it-tools":
        merged.setdefault("TZ", timezone)

    elif service == "immich":
        merged.setdefault("DB_PASSWORD", lab.get("immichDbPassword", "immich"))
        merged.setdefault("TZ", timezone)

    elif service == "picoshare":
        merged.setdefault("PS_SHARED_SECRET", lab.get("picoshareAdminSecret", "change-me"))
        if lab.get("enableLanProxy") is True:
            merged.setdefault("PS_BEHIND_PROXY", True)

    elif service == "odysseus":
        merged.setdefault("GENERIC_TIMEZONE", timezone)

    return merged


def render_env_file(values: dict[str, Any]) -> str:
    lines: list[str] = []
    for key in sorted(values):
        value = values[key]
        if value is None:
            continue
        if isinstance(value, str) and value == "":
            continue
        lines.append(f"{key}={stringify(value)}")
    return GENERATED_HEADER + "\n".join(lines) + ("\n" if lines else "")


def ensure_odysseus_base(target: Path) -> None:
    if target.is_file():
        return
    example = ROOT / "odysseus" / ".env.example"
    if example.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")


def patch_env_file_inplace(path: Path, overrides: dict[str, Any]) -> None:
    """Update keys in an existing env file without removing comments or other keys."""
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_env_file(overrides), encoding="utf-8")
        return

    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)
    seen: set[str] = set()
    output: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(line if line.endswith("\n") else line + "\n")
            continue

        key = stripped.split("=", 1)[0]
        if key in overrides:
            value = overrides[key]
            if value is None or (isinstance(value, str) and value == ""):
                continue
            output.append(f"{key}={stringify(value)}\n")
            seen.add(key)
        else:
            output.append(line if line.endswith("\n") else line + "\n")

    for key in sorted(overrides):
        if key in seen:
            continue
        value = overrides[key]
        if value is None or (isinstance(value, str) and value == ""):
            continue
        if output and not output[-1].endswith("\n\n"):
            output.append("\n")
        output.append(f"# From lab.config.json\n")
        output.append(f"{key}={stringify(value)}\n")

    path.write_text("".join(output), encoding="utf-8")


def write_env_file(path: Path, values: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_env_file(values), encoding="utf-8")


def render(config_path: Path) -> list[str]:
    config = load_config(config_path)
    lab = config.get("lab", {})
    if not isinstance(lab, dict):
        raise SystemExit("lab.config.json: 'lab' must be an object")

    written: list[str] = []

    for service, rel_path in SERVICE_ENV_FILES.items():
        service_values = config.get(service, {})
        if service_values is None:
            service_values = {}
        if not isinstance(service_values, dict):
            raise SystemExit(f"lab.config.json: '{service}' must be an object")

        if service == "odysseus" and not (ROOT / "odysseus" / ".env.example").is_file():
            continue

        if service == "odysseus" and service not in config:
            continue

        merged = merge_lab_defaults(lab, service, service_values)
        target = ROOT / rel_path

        if service == "odysseus":
            ensure_odysseus_base(target)
            patch_env_file_inplace(target, merged)
        else:
            write_env_file(target, merged)
        written.append(rel_path)

    return written


def main() -> int:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else CONFIG_PATH
    if not config_path.is_file():
        example = ROOT / "lab.config.example.json"
        print(f"Missing {config_path.relative_to(ROOT)}", file=sys.stderr)
        if example.is_file():
            print(f"Copy {example.relative_to(ROOT)} to lab.config.json and edit it.", file=sys.stderr)
        return 1

    written = render(config_path)
    print(f"Rendered {len(written)} env file(s) from {config_path.relative_to(ROOT)}:", file=sys.stderr)
    for path in written:
        print(f"  {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
