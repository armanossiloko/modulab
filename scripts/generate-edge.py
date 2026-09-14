#!/usr/bin/env python3
"""Generate Caddy LAN proxy + Pi-hole DNS overlays from catalog recipes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
CONFIG_PATH = ROOT / "lab.config.json"
PROXY_PATH = ROOT / "caddy" / "proxy.caddy"
DNS_HOSTS_PATH = ROOT / "pihole" / "dns-hosts.conf"
PIHOLE_DNS_OVERRIDE = ROOT / "docker-compose.pihole.dns.yml"

PROXY_HEADER = """\
# GENERATED from catalog/*/recipe.json — do not edit by hand.
# Regenerate: bash scripts/render-config.sh
# Included when ENABLE_LAN_PROXY=true — port 80, host-based routing.
# With docker-compose.caddy.proxy-ports.yml, Caddy uses host networking and
# UPSTREAM_HOST=127.0.0.1 so loopback-published app ports work on Linux.

"""

DNS_HEADER = """\
# GENERATED from catalog/*/recipe.json — do not edit by hand.
# Regenerate: bash scripts/render-config.sh
# FQDN: <label>.<PIHOLE_LOCAL_DOMAIN>  ·  IP: LAB_HOST_IP in .env.pihole

"""


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_recipes() -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    if not CATALOG.is_dir():
        return recipes
    for path in sorted(CATALOG.glob("*/recipe.json")):
        data = load_json(path)
        if isinstance(data, dict) and data.get("id"):
            recipes.append(data)
    return recipes


def lab_settings() -> tuple[str, str]:
    domain = "network.lan"
    host_ip = "127.0.0.1"
    if CONFIG_PATH.is_file():
        config = load_json(CONFIG_PATH)
        lab = config.get("lab") if isinstance(config, dict) else None
        if isinstance(lab, dict):
            domain = str(lab.get("domain") or domain)
            host_ip = str(lab.get("hostIp") or host_ip)
    return domain, host_ip


def collect_proxy_targets(recipes: list[dict[str, Any]]) -> list[tuple[str, int]]:
    targets: list[tuple[str, int]] = []
    seen: set[str] = set()

    def add(host: str, port: int) -> None:
        if host in seen:
            return
        seen.add(host)
        targets.append((host, port))

    for recipe in recipes:
        proxy = recipe.get("proxy")
        if isinstance(proxy, dict):
            host = proxy.get("host")
            port = proxy.get("port")
            if isinstance(host, str) and isinstance(port, int):
                add(host, port)
        for extra in recipe.get("extraServices") or []:
            if not isinstance(extra, dict):
                continue
            proxy = extra.get("proxy")
            if isinstance(proxy, dict):
                host = proxy.get("host")
                port = proxy.get("port")
                if isinstance(host, str) and isinstance(port, int):
                    add(host, port)
            elif isinstance(extra.get("label"), str) and isinstance(extra.get("port"), int):
                add(extra["label"], extra["port"])
    return targets


def collect_dns_labels(recipes: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for recipe in recipes:
        for label in recipe.get("dns") or []:
            if isinstance(label, str) and label and label not in seen:
                seen.add(label)
                labels.append(label)
        proxy = recipe.get("proxy")
        if isinstance(proxy, dict):
            host = proxy.get("host")
            if isinstance(host, str) and host and host not in seen:
                seen.add(host)
                labels.append(host)
    return labels


def write_proxy(targets: list[tuple[str, int]]) -> None:
    blocks: list[str] = [PROXY_HEADER]
    for host, port in targets:
        # http:// prefix keeps routes on :80 (LAN). Bare hostnames default to :443.
        blocks.append(
            f"http://{host}.{{$LOCAL_DOMAIN}} {{\n"
            f"\treverse_proxy {{$UPSTREAM_HOST:127.0.0.1}}:{port}\n"
            f"}}\n"
        )
    PROXY_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROXY_PATH.write_text("\n".join(blocks).rstrip() + "\n", encoding="utf-8")


def write_dns_hosts(labels: list[str]) -> None:
    DNS_HOSTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(labels) + ("\n" if labels else "")
    DNS_HOSTS_PATH.write_text(DNS_HEADER + body, encoding="utf-8")


def write_pihole_override(labels: list[str]) -> None:
    # Use Compose env interpolation so this file is not machine-specific.
    lines = [
        f"        ${{LAB_HOST_IP}} {label}.${{PIHOLE_LOCAL_DOMAIN}}" for label in labels
    ]
    hosts_block = (
        "\n".join(lines)
        if lines
        else "        ${LAB_HOST_IP} pihole.${PIHOLE_LOCAL_DOMAIN}"
    )
    content = (
        "# GENERATED from catalog/*/recipe.json — do not edit by hand.\n"
        "# Regenerate: bash scripts/render-config.sh\n"
        "# LAB_HOST_IP / PIHOLE_LOCAL_DOMAIN come from generated .env.\n"
        "# Merged when starting Pi-hole (see scripts/common.sh).\n"
        "services:\n"
        "  pihole:\n"
        "    environment:\n"
        "      FTLCONF_dns_hosts: |-\n"
        f"{hosts_block}\n"
    )
    PIHOLE_DNS_OVERRIDE.write_text(content, encoding="utf-8")


def main() -> int:
    recipes = load_recipes()
    if not recipes:
        print("No catalog recipes found.", file=sys.stderr)
        return 1

    _domain, _host_ip = lab_settings()
    targets = collect_proxy_targets(recipes)
    labels = collect_dns_labels(recipes)

    write_proxy(targets)
    write_dns_hosts(labels)
    write_pihole_override(labels)

    print(
        f"Generated edge config from {len(recipes)} recipe(s): "
        f"{PROXY_PATH.relative_to(ROOT)}, {DNS_HOSTS_PATH.relative_to(ROOT)}, "
        f"{PIHOLE_DNS_OVERRIDE.relative_to(ROOT)}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
