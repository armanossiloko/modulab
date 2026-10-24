#!/usr/bin/env python3
"""Generate Caddy LAN proxy + Pi-hole DNS overlays from catalog recipes.

Reads catalog/ and catalog.local/ (see lab_catalog.py) plus lab.config.json:
  lab.domain           hostnames are <label>.<domain>
  lab.enableLanHttps   also serve https://<label>.<domain> from Caddy's internal CA
  lab.protectedApps    put the Control Center login (forward_auth) in front of these apps
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_catalog  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
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

# Caddy asks Control Center whether the visitor is signed in; non-2xx responses
# (a redirect to the login page) are passed straight back to the browser.
AUTH_SNIPPET = """\
(modulab_auth) {
\tforward_auth {$UPSTREAM_HOST:127.0.0.1}:{$HOME_PORT:8888} {
\t\turi /api/auth/verify
\t\tcopy_headers X-Modulab-User
\t}
}

"""

DNS_HEADER = """\
# GENERATED from catalog/*/recipe.json — do not edit by hand.
# Regenerate: bash scripts/render-config.sh
# FQDN: <label>.<PIHOLE_LOCAL_DOMAIN>  ·  IP: MODULAB_HOST_IP in .env

"""


@dataclass(frozen=True)
class EdgeSettings:
    domain: str = "network.lan"
    host_ip: str = "127.0.0.1"
    https: bool = False
    protected: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ProxyTarget:
    host: str
    port: int
    recipe_id: str


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_recipes() -> list[dict[str, Any]]:
    return lab_catalog.load_recipes(ROOT)


def edge_settings() -> EdgeSettings:
    if not CONFIG_PATH.is_file():
        return EdgeSettings()
    config = load_json(CONFIG_PATH)
    if not isinstance(config, dict):
        return EdgeSettings()
    lab = config.get("lab") if isinstance(config.get("lab"), dict) else {}
    caddy = config.get("caddy") if isinstance(config.get("caddy"), dict) else {}
    lan_proxy = caddy.get("ENABLE_LAN_PROXY") is True or str(caddy.get("ENABLE_LAN_PROXY")).lower() == "true"
    protected = lab.get("protectedApps") or []
    return EdgeSettings(
        domain=str(lab.get("domain") or "network.lan"),
        host_ip=str(lab.get("hostIp") or "127.0.0.1"),
        https=lan_proxy and lab.get("enableLanHttps") is True,
        protected=frozenset(x for x in protected if isinstance(x, str)),
    )


def collect_proxy_targets(recipes: list[dict[str, Any]]) -> list[ProxyTarget]:
    targets: list[ProxyTarget] = []
    seen: set[str] = set()

    def add(host: str, port: int, recipe_id: str) -> None:
        if host in seen:
            return
        seen.add(host)
        targets.append(ProxyTarget(host, port, recipe_id))

    for recipe in recipes:
        proxy = recipe.get("proxy")
        if isinstance(proxy, dict):
            host = proxy.get("host")
            port = proxy.get("port")
            if isinstance(host, str) and isinstance(port, int):
                add(host, port, recipe["id"])
        for extra in recipe.get("extraServices") or []:
            if not isinstance(extra, dict):
                continue
            proxy = extra.get("proxy")
            if isinstance(proxy, dict):
                host = proxy.get("host")
                port = proxy.get("port")
                if isinstance(host, str) and isinstance(port, int):
                    add(host, port, recipe["id"])
            elif isinstance(extra.get("label"), str) and isinstance(extra.get("port"), int):
                add(extra["label"], extra["port"], recipe["id"])
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


def render_proxy(targets: list[ProxyTarget], settings: EdgeSettings) -> str:
    blocks: list[str] = [PROXY_HEADER]
    if any(t.recipe_id in settings.protected and t.recipe_id != "control-center" for t in targets):
        blocks.append(AUTH_SNIPPET)
    for target in targets:
        # http:// prefix keeps routes on :80 (LAN). https:// is added when LAN HTTPS is on.
        addresses = [f"http://{target.host}.{{$LOCAL_DOMAIN}}"]
        if settings.https:
            addresses.append(f"https://{target.host}.{{$LOCAL_DOMAIN}}")
        body = []
        if target.recipe_id in settings.protected and target.recipe_id != "control-center":
            body.append("\timport modulab_auth")
        body.append(f"\treverse_proxy {{$UPSTREAM_HOST:127.0.0.1}}:{target.port}")
        blocks.append(f"{', '.join(addresses)} {{\n" + "\n".join(body) + "\n}\n")
    return "\n".join(blocks).rstrip() + "\n"


def write_proxy(targets: list[ProxyTarget], settings: EdgeSettings) -> None:
    PROXY_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROXY_PATH.write_text(render_proxy(targets, settings), encoding="utf-8", newline="\n")


def write_dns_hosts(labels: list[str]) -> None:
    DNS_HOSTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(labels) + ("\n" if labels else "")
    DNS_HOSTS_PATH.write_text(DNS_HEADER + body, encoding="utf-8", newline="\n")


def write_pihole_override(labels: list[str]) -> None:
    # Use Compose env interpolation so this file is not machine-specific.
    lines = [
        f"        ${{MODULAB_HOST_IP}} {label}.${{PIHOLE_LOCAL_DOMAIN}}" for label in labels
    ]
    hosts_block = (
        "\n".join(lines)
        if lines
        else "        ${MODULAB_HOST_IP} pihole.${PIHOLE_LOCAL_DOMAIN}"
    )
    content = (
        "# GENERATED from catalog/*/recipe.json — do not edit by hand.\n"
        "# Regenerate: bash scripts/render-config.sh\n"
        "# MODULAB_HOST_IP / PIHOLE_LOCAL_DOMAIN come from generated .env.\n"
        "# Merged when starting Pi-hole (see scripts/common.sh).\n"
        "services:\n"
        "  pihole:\n"
        "    environment:\n"
        "      FTLCONF_dns_hosts: |-\n"
        f"{hosts_block}\n"
    )
    PIHOLE_DNS_OVERRIDE.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    recipes = load_recipes()
    if not recipes:
        print("No catalog recipes found.", file=sys.stderr)
        return 1

    settings = edge_settings()
    targets = collect_proxy_targets(recipes)
    labels = collect_dns_labels(recipes)

    write_proxy(targets, settings)
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
