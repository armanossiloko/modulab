#!/usr/bin/env python3
"""Restore config and/or apps from backups/<id>/ (written by backup.py).

  python3 scripts/restore.py 20260101-033000 --config
  python3 scripts/restore.py 20260101-033000 --app jellyfin --app immich

For each app: stop it, move its current data folders to data/.pre-restore/<timestamp>/,
unpack the archived folders, recreate its database from the dump, then start it again.
Restoring config does the same for lab.config.json, secrets/, the dashboard and
Control Center's login, then re-renders .env.

Nothing is deleted: everything replaced is kept under data/.pre-restore/.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_catalog  # noqa: E402
from backup import ID_RE, ROOT, container_running, log, read_env, run_lab_script  # noqa: E402

BACKUPS = ROOT / "backups"


def safe_members(tar: tarfile.TarFile, prefixes: list[str]) -> list[tarfile.TarInfo]:
    """Members under one of `prefixes`, refusing absolute paths, '..', links out of the tree and devices."""
    chosen = []
    for member in tar.getmembers():
        name = PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts:
            raise RuntimeError(f"unsafe path in archive: {member.name}")
        if not (member.isfile() or member.isdir() or member.issym()):
            continue
        if member.issym():
            target = PurePosixPath(member.linkname)
            if target.is_absolute() or ".." in (name.parent / target).parts:
                log(f"warning: skipped symlink {member.name} -> {member.linkname}")
                continue
        rel = name.as_posix()
        if any(rel == p or rel.startswith(p.rstrip("/") + "/") for p in prefixes):
            chosen.append(member)
    return chosen


def extract(tar: tarfile.TarFile, members: list[tarfile.TarInfo]) -> None:
    # The 'tar' filter (Python 3.12+, backported to some 3.11 builds) adds a second safety net
    # on top of safe_members(); older interpreters fall back to the checks above alone.
    if hasattr(tarfile, "tar_filter"):
        tar.extractall(ROOT, members=members, filter="tar")
    else:
        tar.extractall(ROOT, members=members)


def stash(rel: str, safety: Path) -> None:
    """Move ROOT/rel into the safety folder (keeps the same relative layout)."""
    src = ROOT / rel
    if not src.exists() and not src.is_symlink():
        return
    dst = safety / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def restore_config(backup: Path, safety: Path) -> None:
    archive = backup / "config.tar.gz"
    if not archive.is_file():
        raise RuntimeError("this backup has no config archive")
    # Folders restored as a whole; everything else is restored file by file.
    tree_roots = {"secrets", "catalog.local"}
    with tarfile.open(archive, "r:gz") as tar:
        members = safe_members(tar, [m.name for m in tar.getmembers()])
        targets: set[str] = set()
        for member in members:
            top = member.name.split("/")[0]
            if top in tree_roots:
                targets.add(top)
            elif member.isfile():
                targets.add(member.name)
        for rel in sorted(targets):
            stash(rel, safety)
        extract(tar, members)
    log(f"config: restored {len(targets)} item(s)")
    run_lab_script("render-config.sh")


def recreate_database(db: str, dump: Path, env: dict[str, str]) -> None:
    if not container_running("postgres"):
        raise RuntimeError("postgres is not running; start it before restoring databases")
    user = env.get("POSTGRES_USER", "modulab")
    default_db = env.get("POSTGRES_DB", "modulab")
    ident = '"' + db.replace('"', '""') + '"'
    owner = '"' + user.replace('"', '""') + '"'
    for sql in (f"DROP DATABASE IF EXISTS {ident} WITH (FORCE)", f"CREATE DATABASE {ident} OWNER {owner}"):
        result = subprocess.run(
            ["docker", "exec", "postgres", "psql", "-U", user, "-d", default_db, "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"postgres: {sql}: {result.stderr.strip()}")
    with dump.open("rb") as handle:
        result = subprocess.run(
            ["docker", "exec", "-i", "postgres", "pg_restore", "-U", user, "-d", db, "--no-owner", f"--role={user}"],
            stdin=handle, capture_output=True,
        )
    # pg_restore exits 1 on warnings (e.g. existing extensions); surface errors without failing on noise.
    stderr = result.stderr.decode(errors="replace")
    errors = [line for line in stderr.splitlines() if "error:" in line.lower() and "already exists" not in line]
    if result.returncode != 0 and errors:
        raise RuntimeError(f"pg_restore {db}: {errors[-1]}")
    log(f"postgres: restored {db}")


def enable(recipe_id: str) -> None:
    path = ROOT / "lab.config.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    enabled = data.setdefault("enabled", [])
    if recipe_id not in enabled:
        enabled.append(recipe_id)
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def restore_app(backup: Path, recipe: dict[str, Any], safety: Path, env: dict[str, str]) -> None:
    rid = recipe["id"]
    data = [p for p in recipe.get("data") or [] if isinstance(p, str) and p.startswith("data/")]
    archive = backup / "apps" / f"{rid}.tar.gz"
    db = recipe.get("database") if isinstance(recipe.get("database"), str) else None
    dump = backup / "postgres" / f"{db}.dump" if db else None
    has_files = archive.is_file() and bool(data)
    has_db = dump is not None and dump.is_file()
    if not has_files and not has_db:
        raise RuntimeError(f"{rid}: nothing to restore in this backup")

    log(f"{rid}: stopping")
    run_lab_script("stop.sh", rid)
    if has_files:
        for rel in data:
            stash(rel, safety)
        with tarfile.open(archive, "r:gz") as tar:
            members = safe_members(tar, data)
            extract(tar, members)
        log(f"{rid}: restored {sum(1 for m in members if m.isfile())} file(s)")
    if has_db:
        recreate_database(db, dump, env)
    enable(rid)
    run_lab_script("render-config.sh")
    log(f"{rid}: starting")
    run_lab_script("start.sh", rid)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("backup_id")
    parser.add_argument("--config", action="store_true", help="restore lab config, secrets, dashboard and login")
    parser.add_argument("--app", action="append", default=[], help="restore one app (repeatable)")
    args = parser.parse_args()

    if not ID_RE.match(args.backup_id):
        raise RuntimeError(f"invalid backup id '{args.backup_id}'")
    backup = BACKUPS / args.backup_id
    if not (backup / "manifest.json").is_file():
        raise RuntimeError(f"backup {args.backup_id} not found")
    if not args.config and not args.app:
        raise RuntimeError("nothing selected: pass --config and/or --app <id>")

    recipes = lab_catalog.recipes_by_id(ROOT)
    unknown = [a for a in args.app if a not in recipes]
    if unknown:
        raise RuntimeError(f"unknown app(s): {', '.join(unknown)}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safety = ROOT / "data" / ".pre-restore" / stamp
    safety.mkdir(parents=True, exist_ok=True)
    log(f"current files are kept in {safety.relative_to(ROOT)}")

    env = read_env()
    if args.config:
        restore_config(backup, safety)
        env = read_env()
    for rid in args.app:
        restore_app(backup, recipes[rid], safety, env)

    if not any(safety.iterdir()):
        safety.rmdir()
    log("restore finished")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
