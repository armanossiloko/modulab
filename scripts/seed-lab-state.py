#!/usr/bin/env python3
"""Seed / update lab state from the baked-in kit (appliance mode).

Env:
  MODULAB_ROOT      Writable state directory (default /lab)
  MODULAB_KIT   Read-only kit directory (default /opt/modulab)
  MODULAB_SEED  auto|true|false (default auto)

auto: seed when MODULAB_KIT exists and MODULAB_ROOT is not a developer checkout
      (.git or control-center/src present).
true: always sync kit → MODULAB_ROOT (still never overwrites user state files)
false: no-op

Upgrade behavior: kit-managed paths (catalog, scripts, compose templates) are
refreshed from the image so new recipes appear after image upgrades. Never
overwrites lab.config.json, .env, data/, secrets/, media/, backups/ or catalog.local/.

Recipes and compose templates that an older kit shipped but this kit no longer does
are removed (tracked in .modulab-kit-manifest.json, so user files are never touched).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Never overwrite these relative paths / globs under MODULAB_ROOT.
PRESERVE_NAMES = frozenset(
    {
        "lab.config.json",
        ".env",
        "data",
        "secrets",
        "media",
        "backups",
        "catalog.local",
        ".git",
        ".modulab-seeded",
    }
)

# Kit-managed top-level directories/files to sync.
KIT_ITEMS = (
    "catalog",
    "scripts",
    "caddy",
    "postgres",
    "pihole",
    "searxng",
    "lab.config.example.json",
)


def env_flag(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip().lower()


def is_dev_checkout(lab: Path) -> bool:
    return (lab / ".git").exists() or (lab / "control-center" / "src").is_dir()


def should_seed(lab: Path, kit: Path) -> bool:
    mode = env_flag("MODULAB_SEED", "auto")
    if mode in ("0", "false", "no", "off"):
        return False
    if not kit.is_dir():
        return False
    if mode in ("1", "true", "yes", "on"):
        return True
    # auto
    if is_dev_checkout(lab):
        print(f"seed: skip (developer checkout at {lab})", flush=True)
        return False
    return True


def copy_file(src: Path, dst: Path, *, overwrite: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and not overwrite:
        return
    shutil.copy2(src, dst)


def sync_tree(src: Path, dst: Path) -> None:
    """Copy kit tree into state, overwriting kit-managed files; skip preserve paths."""
    if not src.is_dir():
        return
    for root, dirs, files in os.walk(src):
        rel_root = Path(root).relative_to(src)
        # Do not descend into preserved names if they appear under kit (unlikely).
        dirs[:] = [d for d in dirs if d not in PRESERVE_NAMES]
        target_dir = dst / rel_root if str(rel_root) != "." else dst
        target_dir.mkdir(parents=True, exist_ok=True)
        for name in files:
            if name in PRESERVE_NAMES:
                continue
            # Generated edge overlays live beside compose files; allow kit to refresh
            # templates but skip user override compose files.
            if name.endswith(".override.yml"):
                continue
            src_file = Path(root) / name
            dst_file = target_dir / name
            shutil.copy2(src_file, dst_file)


def sync_compose_files(kit: Path, lab: Path) -> None:
    for path in sorted(kit.glob("docker-compose*.yml")):
        if path.name.endswith(".override.yml"):
            continue
        # Skip generated DNS/proxy overlays that are created by generate-edge;
        # still copy base templates that ship in the repo.
        shutil.copy2(path, lab / path.name)


MANIFEST = ".modulab-kit-manifest.json"

# Apps removed from Modulab before the manifest existed: (recipe id, compose file).
RETIRED = [("seerr", "docker-compose.seerr.yml")]


def kit_files(kit: Path) -> set[str]:
    """Kit-managed recipe folders and compose templates, relative to the lab root."""
    files = {f"catalog/{p.name}" for p in (kit / "catalog").iterdir() if p.is_dir()} if (kit / "catalog").is_dir() else set()
    files |= {p.name for p in kit.glob("docker-compose*.yml") if not p.name.endswith(".override.yml")}
    return files


def stop_retired_stack(lab: Path, compose: Path) -> None:
    """Best effort: bring a retired stack down while its compose file still exists."""
    if not compose.is_file() or shutil.which("docker") is None:
        return
    args = ["docker", "compose", "--project-directory", str(lab)]
    if (lab / ".env").is_file():
        args += ["--env-file", str(lab / ".env")]
    subprocess.run(args + ["-f", str(compose), "down"], capture_output=True, timeout=120)


def disable_in_config(lab: Path, recipe_id: str) -> None:
    config = lab / "lab.config.json"
    if not config.is_file():
        return
    data = json.loads(config.read_text(encoding="utf-8"))
    enabled = data.get("enabled")
    if isinstance(enabled, list) and recipe_id in enabled:
        data["enabled"] = [x for x in enabled if x != recipe_id]
        config.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"seed: disabled retired app {recipe_id}", flush=True)


def remove_kit_path(lab: Path, rel: str) -> None:
    path = lab / rel
    if rel.startswith("docker-compose."):
        recipe_id = rel.removeprefix("docker-compose.").removesuffix(".yml")
        disable_in_config(lab, recipe_id)
        stop_retired_stack(lab, path)
    elif rel.startswith("catalog/"):
        disable_in_config(lab, rel.removeprefix("catalog/"))
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    else:
        return
    print(f"seed: removed {rel} (no longer shipped)", flush=True)


def prune_stale(lab: Path, kit: Path) -> None:
    current = kit_files(kit)
    manifest = lab / MANIFEST
    previous: set[str] = set()
    if manifest.is_file():
        try:
            previous = set(json.loads(manifest.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            previous = set()
    stale = previous - current
    for recipe_id, compose in RETIRED:
        stale |= {f"catalog/{recipe_id}", compose} - current
    # Compose files first so their stacks can still be brought down.
    for rel in sorted(stale, key=lambda r: not r.startswith("docker-compose.")):
        remove_kit_path(lab, rel)
    manifest.write_text(json.dumps(sorted(current), indent=2) + "\n", encoding="utf-8")


def ensure_config(lab: Path, kit: Path) -> None:
    config = lab / "lab.config.json"
    if config.is_file():
        return
    example = lab / "lab.config.example.json"
    if not example.is_file():
        example = kit / "lab.config.example.json"
    if example.is_file():
        shutil.copy2(example, config)
        print(f"seed: created {config} from example", flush=True)
    else:
        config.write_text(
            '{\n  "lab": {},\n  "enabled": ["control-center", "postgres", "caddy"]\n}\n',
            encoding="utf-8",
        )
        print(f"seed: created minimal {config}", flush=True)


def main() -> int:
    lab = Path(os.environ.get("MODULAB_ROOT") or "/lab").resolve()
    kit = Path(os.environ.get("MODULAB_KIT") or "/opt/modulab").resolve()

    lab.mkdir(parents=True, exist_ok=True)

    if not should_seed(lab, kit):
        ensure_config(lab, kit)
        return 0

    print(f"seed: syncing kit {kit} → {lab}", flush=True)

    for item in KIT_ITEMS:
        src = kit / item
        dst = lab / item
        if src.is_dir():
            sync_tree(src, dst)
        elif src.is_file():
            # Always refresh example; never touch lab.config.json here.
            if item == "lab.config.example.json":
                shutil.copy2(src, dst)
            else:
                copy_file(src, dst, overwrite=True)

    sync_compose_files(kit, lab)
    prune_stale(lab, kit)

    # Optional kit extras (control-center defaults for dashboard seed helpers).
    defaults = kit / "control-center" / "defaults"
    if defaults.is_dir():
        sync_tree(defaults, lab / "control-center" / "defaults")

    ensure_config(lab, kit)

    marker = lab / ".modulab-seeded"
    marker.write_text(f"kit={kit}\n", encoding="utf-8")
    print("seed: done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
