#!/usr/bin/env python3
"""Cross-platform Modulab CLI (Linux / macOS / Windows).

Prefer this over calling bash scripts directly — it LF-normalizes shell scripts
before running them, so Windows CRLF checkouts work inside Docker/Linux bash.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# Allow `python3 scripts/lab.py` without installing a package.
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from run_bash import run_bash_script  # noqa: E402


COMMANDS = {
    "setup": ("setup.sh", []),
    "render-config": ("render-config.sh", []),
    "refresh-edge": ("refresh-edge.sh", []),
    "check-deps": ("check-deps.sh", []),
    "start": ("start.sh", None),  # remaining argv
    "stop": ("stop.sh", None),
    "install": ("install.sh", None),
    "update": ("update.sh", None),
    "rollback": ("rollback.sh", None),
}

# Python entry points (no bash needed).
PY_COMMANDS = {
    "backup": "backup.py",
    "restore": "restore.py",
    "validate-catalog": "validate-catalog.py",
}


def usage() -> None:
    print(
        """Usage: python3 scripts/lab.py <command> [args...]

Commands:
  setup
  check-deps
  render-config
  refresh-edge
  start <stack>|all
  stop <stack>|all
  install <recipe-id> [json-config]
  update <stack>|all
  rollback <stack>              back to the images from before the last update
  backup [--keep N]             databases + app data + config → backups/
  restore <backup-id> [--config] [--app <id>]...
  validate-catalog              check catalog/ and catalog.local/ recipes

Examples:
  python3 scripts/lab.py setup
  python3 scripts/lab.py start all
  python3 scripts/lab.py install jellyfin
  python3 scripts/lab.py backup
  python3 scripts/lab.py restore 20260101-033000 --app jellyfin
""",
        file=sys.stderr,
    )


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        usage()
        return 2 if len(sys.argv) < 2 else 0

    cmd = sys.argv[1]
    if cmd in PY_COMMANDS:
        return subprocess.call([sys.executable, str(SCRIPTS / PY_COMMANDS[cmd]), *sys.argv[2:]])
    if cmd not in COMMANDS:
        print(f"Unknown command '{cmd}'", file=sys.stderr)
        usage()
        return 2

    script, fixed = COMMANDS[cmd]
    args = list(sys.argv[2:]) if fixed is None else list(fixed) + list(sys.argv[2:])
    if cmd in ("start", "stop", "update", "install", "rollback") and not args:
        print(f"Usage: python3 scripts/lab.py {cmd} <stack>|all", file=sys.stderr)
        return 2
    return run_bash_script(script, args)


if __name__ == "__main__":
    raise SystemExit(main())
