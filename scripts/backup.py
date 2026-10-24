#!/usr/bin/env python3
"""Back up the lab into backups/<YYYYmmdd-HHMMSS>/.

  postgres/<db>.dump    pg_dump -Fc of every database on the shared Postgres (+ globals.sql)
  apps/<id>.tar.gz      each enabled app's recipe "data" folders (minus backup.exclude)
  config.tar.gz         lab.config.json, secrets/, dashboard, Control Center auth/settings,
                        catalog.local/, docker-compose.*.override.yml
  manifest.json         what is inside (read by Control Center → Settings → Backups)

Media libraries (media/, photo libraries) are not copied locally — too big. Add them to
the restic "extra paths" instead: restic deduplicates and only uploads changes.

Optional offsite copy with restic when RESTIC_REPOSITORY / RESTIC_PASSWORD are set
(Control Center passes them from Settings → Backups).

Usage: python3 scripts/backup.py [--trigger manual|scheduled] [--keep 7]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_catalog  # noqa: E402

ROOT = lab_catalog.lab_root()
BACKUPS = ROOT / "backups"
ID_RE = re.compile(r"^\d{8}-\d{6}$")
DEFAULT_RESTIC_IMAGE = "restic/restic:0.18.0"

# Paths (relative to the lab root) that make up "config".
CONFIG_PATHS = [
    "lab.config.json",
    "secrets",
    "control-center/wwwroot/dashboard.json",
    "data/control-center/auth.json",
    "data/control-center/settings.json",
    "catalog.local",
]


def log(message: str) -> None:
    print(message, flush=True)


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        env[key.strip()] = value
    return env


def load_config() -> dict[str, Any]:
    path = ROOT / "lab.config.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def docker(*args: str, **kwargs: Any) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], **kwargs)


def container_running(name: str) -> bool:
    out = docker("ps", "--format", "{{.Names}}", capture_output=True, text=True)
    return out.returncode == 0 and name in out.stdout.split()


def run_lab_script(script: str, *args: str) -> None:
    """Start/stop stacks through the same scripts Control Center uses (overlays, overrides)."""
    runner = ROOT / "scripts" / "run_bash.py"
    result = subprocess.run([sys.executable, str(runner), script, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{script} {' '.join(args)} failed: {result.stderr.strip() or result.stdout.strip()}")


# ── Postgres ────────────────────────────────────────────────────────────────


def dump_postgres(dest: Path, env: dict[str, str]) -> list[str]:
    if not container_running("postgres"):
        log("postgres: not running — skipping database dumps")
        return []
    user = env.get("POSTGRES_USER", "modulab")
    default_db = env.get("POSTGRES_DB", "modulab")
    listing = docker(
        "exec", "postgres", "psql", "-U", user, "-d", default_db, "-Atc",
        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1",
        capture_output=True, text=True,
    )
    if listing.returncode != 0:
        raise RuntimeError(f"postgres: could not list databases: {listing.stderr.strip()}")
    databases = [d.strip() for d in listing.stdout.splitlines() if d.strip() and d.strip() != "postgres"]

    folder = dest / "postgres"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "globals.sql").open("wb") as handle:
        result = docker("exec", "postgres", "pg_dumpall", "-U", user, "--globals-only", stdout=handle, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"postgres: pg_dumpall --globals-only failed: {result.stderr.decode(errors='replace').strip()}")

    for db in databases:
        log(f"postgres: dumping {db}")
        with (folder / f"{db}.dump").open("wb") as handle:
            result = docker("exec", "postgres", "pg_dump", "-U", user, "-Fc", "-d", db, stdout=handle, stderr=subprocess.PIPE)
        if result.returncode != 0:
            raise RuntimeError(f"postgres: pg_dump {db} failed: {result.stderr.decode(errors='replace').strip()}")
    return databases


# ── Files ───────────────────────────────────────────────────────────────────


def _is_excluded(rel: str, excludes: Iterable[str]) -> bool:
    rel = rel.replace("\\", "/")
    for ex in excludes:
        ex = ex.replace("\\", "/").rstrip("/")
        if rel == ex or rel.startswith(ex + "/"):
            return True
    return False


def write_tar(archive: Path, paths: list[str], excludes: list[str] | None = None) -> int:
    """tar.gz of lab-relative paths. Returns the number of files written; skips unreadable entries."""
    excludes = excludes or []
    count = 0

    def keep(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
        if _is_excluded(info.name, excludes):
            return None
        if not (info.isfile() or info.isdir() or info.issym()):
            return None  # sockets, fifos, devices
        return info

    with tarfile.open(archive, "w:gz", compresslevel=6) as tar:
        for rel in paths:
            full = ROOT / rel
            if not full.exists():
                continue
            if full.is_file():
                if keep(tar.gettarinfo(str(full), arcname=rel)) is not None:
                    tar.add(str(full), arcname=rel, recursive=False)
                    count += 1
                continue
            for dirpath, dirnames, filenames in os.walk(full):
                rel_dir = Path(dirpath).relative_to(ROOT).as_posix()
                dirnames[:] = [d for d in dirnames if not _is_excluded(f"{rel_dir}/{d}", excludes)]
                for name in filenames:
                    file_rel = f"{rel_dir}/{name}"
                    try:
                        tar.add(os.path.join(dirpath, name), arcname=file_rel, recursive=False, filter=keep)
                        count += 1
                    except (PermissionError, FileNotFoundError) as exc:
                        log(f"warning: skipped {file_rel}: {exc}")
    return count


def backup_config(dest: Path) -> bool:
    paths = list(CONFIG_PATHS)
    paths += sorted(p.name for p in ROOT.glob("docker-compose.*.override.yml"))
    count = write_tar(dest / "config.tar.gz", paths)
    log(f"config: {count} file(s)")
    return count > 0


def backup_apps(dest: Path, config: dict[str, Any]) -> list[str]:
    enabled = set(config.get("enabled") or [])
    done: list[str] = []
    folder = dest / "apps"
    for recipe in lab_catalog.load_recipes(ROOT):
        rid = recipe["id"]
        data = [p for p in recipe.get("data") or [] if isinstance(p, str) and p.startswith("data/")]
        if rid not in enabled or not data:
            continue
        if not any((ROOT / p).exists() for p in data):
            continue
        backup = recipe.get("backup") if isinstance(recipe.get("backup"), dict) else {}
        excludes = [e for e in backup.get("exclude") or [] if isinstance(e, str)]
        stop = backup.get("stop") is True and any(
            name == rid or name.startswith(rid + "-") or name.startswith(rid + "_")
            for name in running_containers()
        )
        folder.mkdir(parents=True, exist_ok=True)
        if stop:
            log(f"{rid}: stopping for a consistent copy")
            run_lab_script("stop.sh", rid)
        try:
            count = write_tar(folder / f"{rid}.tar.gz", data, excludes)
            log(f"{rid}: {count} file(s)")
            done.append(rid)
        finally:
            if stop:
                log(f"{rid}: starting again")
                run_lab_script("start.sh", rid)
    return done


def running_containers() -> list[str]:
    out = docker("ps", "--format", "{{.Names}}", capture_output=True, text=True)
    return out.stdout.split() if out.returncode == 0 else []


def folder_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def prune(keep: int) -> None:
    if not BACKUPS.is_dir():
        return
    existing = sorted((p for p in BACKUPS.iterdir() if p.is_dir() and ID_RE.match(p.name)), reverse=True)
    for old in existing[keep:]:
        log(f"retention: removing {old.name}")
        shutil.rmtree(old, ignore_errors=True)
    # Leftovers from interrupted runs.
    for partial in BACKUPS.glob(".*.partial"):
        shutil.rmtree(partial, ignore_errors=True)


# ── restic ──────────────────────────────────────────────────────────────────


def is_local_repo(repo: str) -> bool:
    return repo.startswith("/") or bool(re.match(r"^[A-Za-z]:[\\/]", repo))


def mount_name(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", path.strip("/\\")) or "root"


def restic(backup_id: str, env: dict[str, str]) -> None:
    repo = os.environ.get("RESTIC_REPOSITORY", "").strip()
    if not repo:
        return
    host_root = env.get("MODULAB_HOST_ROOT", "").replace("\\", "/").rstrip("/")
    if not host_root:
        raise RuntimeError("restic: MODULAB_HOST_ROOT is not set in .env")

    image = os.environ.get("RESTIC_IMAGE", DEFAULT_RESTIC_IMAGE)
    child_env = dict(os.environ)
    # Stable mount point for the newest backup, so restic finds the parent snapshot.
    mounts = ["-v", f"{host_root}/backups/{backup_id}:/backup/latest:ro"]
    targets = ["/backup/latest"]
    if is_local_repo(repo):
        mounts += ["-v", f"{repo}:/repo"]
        child_env["RESTIC_REPOSITORY"] = "/repo"

    for raw in os.environ.get("MODULAB_RESTIC_EXTRA_PATHS", "").splitlines():
        extra = raw.strip()
        if not extra:
            continue
        host_path = extra if is_local_repo(extra) else f"{host_root}/{extra.lstrip('./')}"
        target = f"/extra/{mount_name(extra)}"
        mounts += ["-v", f"{host_path}:{target}:ro"]
        targets.append(target)

    env_keys = ["RESTIC_REPOSITORY", "RESTIC_PASSWORD"] + [
        k for k in os.environ.get("MODULAB_RESTIC_ENV_KEYS", "").split(",") if k
    ]
    env_args: list[str] = []
    for key in env_keys:
        env_args += ["-e", key]  # value comes from child_env, never from argv

    def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
        cmd = ["docker", "run", "--rm", "--hostname", "modulab", *env_args, *mounts, image, *args]
        result = subprocess.run(cmd, env=child_env, capture_output=True, text=True)
        for line in (result.stdout + result.stderr).splitlines():
            if line.strip():
                log(f"restic: {line.strip()}")
        if check and result.returncode != 0:
            raise RuntimeError(f"restic {args[0]} failed ({result.returncode})")
        return result

    if run("cat", "config", check=False).returncode != 0:
        log("restic: initialising repository")
        run("init")
    log("restic: uploading")
    run("backup", "--host", "modulab", "--tag", "modulab", *targets)
    keep_daily = os.environ.get("MODULAB_RESTIC_KEEP_DAILY", "7")
    keep_weekly = os.environ.get("MODULAB_RESTIC_KEEP_WEEKLY", "4")
    run("forget", "--host", "modulab", "--tag", "modulab",
        "--keep-daily", keep_daily, "--keep-weekly", keep_weekly, "--prune")


# ── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--trigger", default="manual", choices=["manual", "scheduled"])
    parser.add_argument("--keep", type=int, default=7)
    args = parser.parse_args()

    env = read_env()
    config = load_config()
    now = datetime.now(timezone.utc)
    backup_id = now.strftime("%Y%m%d-%H%M%S")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    work = BACKUPS / f".{backup_id}.partial"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()

    try:
        databases = dump_postgres(work, env)
        apps = backup_apps(work, config)
        has_config = backup_config(work)
        manifest = {
            "id": backup_id,
            "createdAt": now.isoformat(),
            "trigger": args.trigger,
            "databases": databases,
            "apps": apps,
            "hasConfig": has_config,
            "sizeBytes": folder_size(work),
        }
        (work / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        final = BACKUPS / backup_id
        work.rename(final)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise

    size_mb = manifest["sizeBytes"] / 1_000_000
    log(f"backup {backup_id}: {len(databases)} database(s), {len(apps)} app(s), {size_mb:.1f} MB")
    prune(max(1, args.keep))
    restic(backup_id, env)
    log(f"done: {backup_id}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
