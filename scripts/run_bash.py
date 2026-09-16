#!/usr/bin/env python3
"""Run a Modulab bash script with LF-normalized copies (Windows-safe).

Host checkouts on Windows often store *.sh with CRLF. Bash inside the Control
Center Linux container (and some Git Bash setups) then fails with:
  $'\\r': command not found

This runner copies every scripts/*.sh into a temp dir with Unix newlines and
executes from there. MODULAB_ROOT still points at the real lab checkout so compose
files, .env, and catalog stay correct.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def lab_root_from_env_or_here() -> Path:
    here = Path(__file__).resolve().parent
    override = os.environ.get("MODULAB_ROOT", "").strip()
    if override:
        return Path(override).resolve()
    return here.parent.resolve()


def materialize_lf_scripts(scripts_src: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted(scripts_src.glob("*.sh")):
        text = src.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        dest = dest_dir / src.name
        dest.write_bytes(text)
        try:
            dest.chmod(0o755)
        except OSError:
            pass


def run_bash_script(script_name: str, script_args: list[str], lab_root: Path | None = None) -> int:
    if not script_name.endswith(".sh"):
        script_name = f"{script_name}.sh"

    root = (lab_root or lab_root_from_env_or_here()).resolve()
    scripts_src = root / "scripts"
    if not scripts_src.is_dir():
        print(f"Missing scripts directory: {scripts_src}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="modulab-scripts-") as tmp:
        tmp_scripts = Path(tmp) / "scripts"
        materialize_lf_scripts(scripts_src, tmp_scripts)
        target = tmp_scripts / script_name
        if not target.is_file():
            print(f"Unknown script '{script_name}' in {scripts_src}", file=sys.stderr)
            return 1

        env = os.environ.copy()
        env["MODULAB_ROOT"] = str(root)
        env["MODULAB_SCRIPTS"] = str(tmp_scripts)

        return subprocess.call(
            ["bash", str(target), *script_args],
            cwd=str(root),
            env=env,
        )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(
            "Usage: python3 scripts/run_bash.py <script.sh> [args...]\n"
            "Example: python3 scripts/run_bash.py start.sh it-tools",
            file=sys.stderr,
        )
        return 2
    return run_bash_script(args[0], args[1:])


if __name__ == "__main__":
    raise SystemExit(main())
