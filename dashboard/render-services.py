#!/usr/bin/env python3
"""Generate dashboard/services.json from compose files and services.manifest.json."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "dashboard" / "services.manifest.json"
OUTPUT_PATH = ROOT / "dashboard" / "services.json"

SKIP_COMPOSE = {
    "docker-compose.caddy.yml",
    "docker-compose.caddy.proxy-ports.yml",
    "docker-compose.postgres.yml",
    "docker-compose.odysseus.yml",
}

NON_HTTP_PORTS = {53, 5432, 8100, 8920}

PORT_LINE = re.compile(
    r"""^\s*-\s*"""
    r"""["']?"""
    r"""(?:[^"']*:)?"""
    r"""(\d+)"""
    r""":"""
    r"""(\d+)"""
    r"""(?:/tcp)?"""
    r"""["']?\s*$"""
)

ENV_DEFAULT_PORT = re.compile(r"\$\{[A-Z0-9_]+:-(\d+)\}")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def title_case_label(label: str) -> str:
    return label.replace("-", " ").replace("_", " ").title()


def extract_host_ports(compose_path: Path) -> list[int]:
    if not compose_path.is_file():
        return []

    ports: list[int] = []
    for line in compose_path.read_text(encoding="utf-8").splitlines():
        match = PORT_LINE.match(line)
        if match:
            host_port = int(match.group(1))
            if host_port not in NON_HTTP_PORTS:
                ports.append(host_port)
            continue

        env_match = ENV_DEFAULT_PORT.search(line)
        if env_match and ":-" in line and line.strip().startswith("-"):
            host_port = int(env_match.group(1))
            if host_port not in NON_HTTP_PORTS:
                ports.append(host_port)
    return ports


def stack_name_from_compose(path: Path) -> str:
    name = path.name
    if name == "docker-compose.yml":
        return path.parent.name
    if name.startswith("docker-compose.") and name.endswith(".yml"):
        return name.removeprefix("docker-compose.").removesuffix(".yml")
    return path.stem


def pick_port(compose_path: Path, preferred: int | None, *, shared_compose: bool = False) -> int | None:
    ports = extract_host_ports(compose_path)
    if preferred is not None and (shared_compose or not ports or preferred in ports):
        return preferred
    if not ports:
        return preferred
    return ports[0]


def discover_compose_files() -> dict[str, Path]:
    discovered: dict[str, Path] = {}
    for path in sorted(ROOT.glob("docker-compose.*.yml")):
        if path.name in SKIP_COMPOSE:
            continue
        discovered[stack_name_from_compose(path)] = path

    odysseus_compose = ROOT / "odysseus" / "docker-compose.yml"
    if odysseus_compose.is_file():
        discovered["odysseus"] = odysseus_compose
    return discovered


def default_entry(label: str, compose_path: Path) -> dict[str, Any]:
    port = pick_port(compose_path, None)
    return {
        "label": label,
        "name": title_case_label(label),
        "description": f"{title_case_label(label)} stack",
        "category": "other",
        "compose": str(compose_path.relative_to(ROOT)).replace("\\", "/"),
        "port": port,
    }


def normalize_entry(entry: dict[str, Any], compose_files: dict[str, Path]) -> dict[str, Any] | None:
    label = entry.get("label")
    if not isinstance(label, str) or not label:
        return None

    compose_rel = entry.get("compose")
    compose_path = ROOT / compose_rel if isinstance(compose_rel, str) else None
    if compose_path is None or not compose_path.is_file():
        compose_path = compose_files.get(label)
    if compose_path is None or not compose_path.is_file():
        return None

    preferred = entry.get("port")
    preferred_port = int(preferred) if isinstance(preferred, int) else None
    shared_compose = compose_path.name == "docker-compose.yml" and compose_path.parent.name == "odysseus"
    port = pick_port(compose_path, preferred_port, shared_compose=shared_compose)
    if port is None:
        return None

    normalized: dict[str, Any] = {
        "label": label,
        "name": str(entry.get("name") or title_case_label(label)),
        "description": str(entry.get("description") or f"{title_case_label(label)} stack"),
        "category": str(entry.get("category") or "other"),
        "port": port,
    }

    path = entry.get("path")
    if isinstance(path, str) and path:
        normalized["path"] = path

    host = entry.get("host")
    if isinstance(host, str) and host:
        normalized["host"] = host

    return normalized


def render() -> list[dict[str, Any]]:
    manifest: list[dict[str, Any]] = []
    if MANIFEST_PATH.is_file():
        raw = load_json(MANIFEST_PATH)
        if isinstance(raw, list):
            manifest = [item for item in raw if isinstance(item, dict)]

    compose_files = discover_compose_files()
    by_label: dict[str, dict[str, Any]] = {}

    for entry in manifest:
        normalized = normalize_entry(entry, compose_files)
        if normalized is not None:
            by_label[normalized["label"]] = normalized

    for label, compose_path in compose_files.items():
        if label in by_label:
            continue
        normalized = normalize_entry(default_entry(label, compose_path), compose_files)
        if normalized is not None:
            by_label[label] = normalized

    services = sorted(by_label.values(), key=lambda item: (item.get("category", ""), item["name"]))
    return services


def main() -> int:
    services = render()
    OUTPUT_PATH.write_text(json.dumps(services, indent=2) + "\n", encoding="utf-8")
    print(f"Rendered {len(services)} service(s) to {OUTPUT_PATH.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
