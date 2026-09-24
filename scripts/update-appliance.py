#!/usr/bin/env python3
"""Update an appliance install from inside Control Center.

launch  Runs in the Control Center container. Starts a helper container that
        survives Control Center being recreated, then follows its log.
apply   Runs in that helper. Downloads compose.yaml for the configured image
        tag, pulls kit compose files from that image, updates enabled core
        stacks (Postgres and Caddy), then recreates Control Center.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "armanossiloko/modulab"
UPDATER_NAME = "modulab-updater"
STATUS_NAME = ".modulab-self-update.json"
LOG_NAME = ".modulab-self-update.log"
SOURCE_NAME = ".modulab-compose-source.json"
CORE_STACKS = ("postgres", "caddy")
HELPER_STATE = "/work/state"
HELPER_COMPOSE = "/work/compose"


def lab_root() -> Path:
    env = os.environ.get("MODULAB_ROOT", "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent


def normalize(path: str) -> str:
    return path.replace("\\", "/").rstrip("/")


def usable_host_path(path: str) -> bool:
    p = normalize(path)
    if not p or p in ("/lab", ".", "/work/state", "/work/compose"):
        return False
    if re.match(r"^[A-Za-z]:/", p):
        return True
    return p.startswith("/")


def is_windows_path(path: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:/", normalize(path)))


def is_unix_path(path: str) -> bool:
    p = normalize(path)
    return p.startswith("/") and usable_host_path(p)


def tag_of(image: str) -> str:
    name = image.split("@", 1)[0]
    leaf = name.rsplit("/", 1)[-1]
    if ":" in leaf:
        tag = leaf.split(":", 1)[1]
        return tag or "latest"
    return "latest"


def git_ref_for_tag(tag: str) -> str:
    tag = (tag or "latest").strip()
    if tag in ("", "latest", "local") or tag.startswith("sha-"):
        return "master"
    if re.fullmatch(r"\d+\.\d+\.\d+", tag):
        return f"v{tag}"
    if re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        return tag
    return "master"


def split_config_files(raw: str) -> list[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def pick_compose_file(config_files: str, working_dir: str) -> tuple[str, str] | None:
    paths = split_config_files(config_files)
    preferred = [
        path
        for path in paths
        if normalize(path).endswith(("compose.yaml", "compose.yml"))
    ]
    chosen = (preferred or paths)[:1]
    if not chosen:
        directory = normalize(working_dir)
        if directory:
            return directory, "compose.yaml"
        return None
    path = normalize(chosen[0])
    if not path.startswith("/") and not re.match(r"^[A-Za-z]:/", path):
        base = normalize(working_dir)
        path = f"{base}/{path}" if base else path
    directory, _, name = path.rpartition("/")
    if not directory or not name:
        return None
    return directory, name


def within(parent: str, child: str) -> bool:
    parent_n = normalize(parent).lower() if is_windows_path(parent) else normalize(parent)
    child_n = normalize(child).lower() if is_windows_path(child) else normalize(child)
    return child_n == parent_n or child_n.startswith(parent_n + "/")


def relative_to(parent: str, child: str) -> str:
    parent_n = normalize(parent)
    child_n = normalize(child)
    if is_windows_path(parent):
        rel = child_n[len(parent_n) :].lstrip("/")
    else:
        rel = child_n[len(parent_n) :].lstrip("/")
    return rel


def windows_desktop_path(path: str) -> str | None:
    match = re.match(r"^([A-Za-z]):/(.*)$", normalize(path))
    if not match:
        return None
    rest = match.group(2)
    return f"/run/desktop/mnt/host/{match.group(1).lower()}/{rest}"


def translate_like_state(path: str, state_env: str, state_source: str) -> str | None:
    host = normalize(path)
    env = normalize(state_env)
    source = normalize(state_source)
    if not env or not source or not within(env, host):
        return None
    return f"{source}/{relative_to(env, host)}".rstrip("/")


def write_status(root: Path, status: str, detail: str = "") -> None:
    path = root / STATUS_NAME
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"status": status, "detail": detail}, ensure_ascii=True),
        encoding="utf-8",
    )
    tmp.replace(path)


def log_line(root: Path, message: str) -> None:
    token = os.environ.get("CLOUDFLARE_TUNNEL_TOKEN", "")
    text = message.replace("\r", "").rstrip("\n")
    if token and len(token) > 4:
        text = text.replace(token, "***")
    if not text:
        return
    with (root / LOG_NAME).open("a", encoding="utf-8") as handle:
        handle.write(text + "\n")
    print(text, flush=True)


def run_logged(root: Path, cmd: list[str], env: dict[str, str] | None = None, cwd: str | None = None) -> None:
    shown = " ".join(cmd)
    token = (env or os.environ).get("CLOUDFLARE_TUNNEL_TOKEN", "")
    if token and len(token) > 4:
        shown = shown.replace(token, "***")
    log_line(root, f"+ {shown}")
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        log_line(root, line)
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"Command failed ({code}): {cmd[0]} {cmd[1] if len(cmd) > 1 else ''}".strip())


def docker_inspect(name: str) -> dict | None:
    proc = subprocess.run(
        ["docker", "inspect", name],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    data = json.loads(proc.stdout)
    if not data:
        return None
    return data[0]


def read_status(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def remember_source(lab: Path, volume_source: str, filename: str) -> None:
    payload = {"volumeSource": volume_source, "filename": filename}
    (lab / SOURCE_NAME).write_text(json.dumps(payload), encoding="utf-8")


def load_source(lab: Path) -> tuple[str, str] | None:
    path = lab / SOURCE_NAME
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    source = str(data.get("volumeSource") or "")
    filename = str(data.get("filename") or "compose.yaml")
    if not source:
        return None
    return source, filename


def publish_ip(info: dict) -> str:
    bindings = (info.get("HostConfig") or {}).get("PortBindings") or {}
    for ports in bindings.values():
        if not ports:
            continue
        host_ip = str((ports[0] or {}).get("HostIp") or "")
        if host_ip:
            return host_ip
    return "0.0.0.0"


def cloudflared_token() -> tuple[bool, str]:
    info = docker_inspect("cloudflared")
    if info is None:
        return False, ""
    state = (info.get("State") or {}).get("Running")
    if not state:
        return False, ""
    cmd = list((info.get("Config") or {}).get("Cmd") or [])
    token = ""
    if "--token" in cmd:
        index = cmd.index("--token")
        if index + 1 < len(cmd):
            token = cmd[index + 1]
    if not token:
        for item in (info.get("Config") or {}).get("Env") or []:
            if str(item).startswith("CLOUDFLARE_TUNNEL_TOKEN="):
                token = str(item).split("=", 1)[1]
                break
    return True, token


def probe_file(image: str, source: str, dest: str, filename: str) -> bool:
    target = f"{dest.rstrip('/')}/{filename}"
    proc = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--entrypoint",
            "python3",
            "-v",
            f"{source}:{dest}:ro",
            "-e",
            f"MODULAB_PROBE_FILE={target}",
            image,
            "-c",
            "import os,sys; sys.exit(0 if os.path.isfile(os.environ['MODULAB_PROBE_FILE']) else 1)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0


def compose_mount(image: str, directory: str, filename: str, state_env: str, state_source: str) -> tuple[str, str] | None:
    """Return (volume source, project dir inside the helper) for compose.yaml."""
    directory = normalize(directory)
    candidates: list[tuple[str, str]] = []
    if is_unix_path(directory):
        candidates.append((directory, directory))
    translated = translate_like_state(directory, state_env, state_source)
    desktop = windows_desktop_path(directory)
    for source in (directory, translated, desktop):
        if not source:
            continue
        source = normalize(source)
        dest = source if is_unix_path(source) else HELPER_COMPOSE
        pair = (source, dest)
        if pair not in candidates:
            candidates.append(pair)
    seen: set[tuple[str, str]] = set()
    for source, dest in candidates:
        if (source, dest) in seen:
            continue
        seen.add((source, dest))
        if probe_file(image, source, dest, filename):
            return source, dest
    return None


def state_mount_source(info: dict, state_env: str) -> str:
    for mount in info.get("Mounts") or []:
        if mount.get("Destination") == "/lab" and mount.get("Source"):
            return normalize(str(mount["Source"]))
    return normalize(state_env)


def dev_checkout(lab: Path) -> bool:
    return (lab / ".git").exists() or (lab / "control-center" / "src").is_dir()


def helper_env(state_env: str, tag: str, host_port: str, publish_ip: str, token: str, profile: str) -> dict[str, str]:
    env = os.environ.copy()
    env["MODULAB_HOST_ROOT"] = state_env
    env["MODULAB_ROOT"] = HELPER_STATE
    env["MODULAB_TAG"] = tag
    env["HOME_PORT"] = host_port or "8888"
    env["MODULAB_PUBLISH_IP"] = publish_ip or "0.0.0.0"
    env["COMPOSE_PROJECT_NAME"] = "modulab"
    env["COMPOSE_IGNORE_ORPHANS"] = "true"
    env["MODULAB_UPDATE_PROFILE"] = profile
    if token:
        env["CLOUDFLARE_TUNNEL_TOKEN"] = token
    else:
        env.pop("CLOUDFLARE_TUNNEL_TOKEN", None)
    return env


def launch() -> int:
    lab = lab_root()
    if dev_checkout(lab):
        print(
            "This directory is a development checkout. Update it with: python3 scripts/lab.py update <stack>",
            file=sys.stderr,
        )
        return 1

    info = docker_inspect("control-center")
    if info is None:
        print("Container control-center is not running. Start it with compose.yaml first.", file=sys.stderr)
        return 1

    labels = (info.get("Config") or {}).get("Labels") or {}
    config_files = str(labels.get("com.docker.compose.project.config_files") or "")
    working_dir = str(labels.get("com.docker.compose.project.working_dir") or "")
    image = str((info.get("Config") or {}).get("Image") or "")
    if not image:
        print("Could not read the Control Center image name.", file=sys.stderr)
        return 1
    tag = tag_of(image)
    if "ghcr.io/" not in image or tag == "local":
        print(
            "Control Center is not running the published image. This button updates ghcr.io/armanossiloko/modulab.",
            file=sys.stderr,
        )
        return 1

    state_env = normalize(os.environ.get("MODULAB_HOST_ROOT", ""))
    if not usable_host_path(state_env):
        state_env = state_mount_source(info, state_env)
    if not usable_host_path(state_env):
        print("MODULAB_HOST_ROOT is not set to a host path, so Compose cannot recreate Control Center.", file=sys.stderr)
        return 1
    state_source = state_mount_source(info, state_env) or state_env

    picked = pick_compose_file(config_files, working_dir)
    saved = load_source(lab)
    filename = "compose.yaml"
    mount: tuple[str, str] | None = None
    if picked and usable_host_path(picked[0]):
        filename = picked[1]
        mount = compose_mount(image, picked[0], filename, state_env, state_source)
    if mount is None and saved:
        filename = saved[1]
        mount = compose_mount(image, saved[0], filename, state_env, state_source)
    if mount is None and within(state_env, (picked or ("", filename))[0] if picked else ""):
        filename = picked[1] if picked else filename
        rel = relative_to(state_env, picked[0]) if picked else ""
        dest = f"{HELPER_STATE}/{rel}".rstrip("/") if rel else HELPER_STATE
        if probe_file(image, state_source, HELPER_STATE, f"{rel}/{filename}".lstrip("/") if rel else filename):
            mount = (state_source, dest)
    if mount is None:
        print(
            "Could not read the host compose.yaml used to start Control Center. "
            "From that folder run: docker compose pull && docker compose up -d",
            file=sys.stderr,
        )
        return 1

    volume_source, project_dir = mount
    remembered = picked[0] if picked and usable_host_path(picked[0]) else volume_source
    remember_source(lab, normalize(remembered), filename)

    host_port = os.environ.get("HOME_PORT", "8888")
    ip = publish_ip(info)
    profile_on, token = cloudflared_token()
    profile = "cloudflare" if profile_on and token else ""
    if profile_on and not token:
        print("Cloudflare tunnel is running but its token could not be read. It will be left as-is.")

    for name in (LOG_NAME, STATUS_NAME):
        path = lab / name
        if path.exists():
            path.unlink()
    write_status(lab, "running", "starting")

    env = helper_env(state_env, tag, host_port, ip, token, profile)
    env["MODULAB_COMPOSE_PROJECT_DIR"] = project_dir
    env["MODULAB_COMPOSE_FILENAME"] = filename

    subprocess.run(["docker", "rm", "-f", UPDATER_NAME], capture_output=True, text=True, check=False)
    mounts = ["-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", f"{state_source}:{HELPER_STATE}"]
    if normalize(volume_source) != normalize(state_source) or project_dir != HELPER_STATE:
        if not (within(HELPER_STATE, project_dir) or project_dir == HELPER_STATE):
            mounts += ["-v", f"{volume_source}:{project_dir}"]
    cmd = [
        "docker",
        "run",
        "-d",
        "--name",
        UPDATER_NAME,
        "--rm",
        "--entrypoint",
        "python3",
        *mounts,
        "-e",
        "MODULAB_HOST_ROOT",
        "-e",
        "MODULAB_ROOT",
        "-e",
        "MODULAB_TAG",
        "-e",
        "HOME_PORT",
        "-e",
        "MODULAB_PUBLISH_IP",
        "-e",
        "COMPOSE_PROJECT_NAME",
        "-e",
        "COMPOSE_IGNORE_ORPHANS",
        "-e",
        "MODULAB_UPDATE_PROFILE",
        "-e",
        "MODULAB_COMPOSE_PROJECT_DIR",
        "-e",
        "MODULAB_COMPOSE_FILENAME",
        image,
        f"{HELPER_STATE}/scripts/update-appliance.py",
        "apply",
    ]
    if token:
        cmd[cmd.index(image) : cmd.index(image)] = ["-e", "CLOUDFLARE_TUNNEL_TOKEN"]

    print(f"Updating Control Center ({image}) and enabled core stacks…")
    proc = subprocess.run(cmd, env=env, text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "could not start updater").strip()
        print(detail, file=sys.stderr)
        write_status(lab, "error", detail[-400:])
        return 1
    return follow(lab)


def follow(lab: Path) -> int:
    log_path = lab / LOG_NAME
    status_path = lab / STATUS_NAME
    seen = 0
    deadline = time.time() + 30 * 60
    while time.time() < deadline:
        if log_path.is_file():
            data = log_path.read_bytes()
            if len(data) > seen:
                sys.stdout.write(data[seen:].decode("utf-8", "replace"))
                sys.stdout.flush()
                seen = len(data)
        status = read_status(status_path)
        running = docker_inspect(UPDATER_NAME) is not None
        if not running:
            status = read_status(status_path)
            if status.get("status") == "error":
                detail = str(status.get("detail") or "update failed")
                print(detail, file=sys.stderr)
                return 1
            if status.get("status") in ("ok", "restarting"):
                print("Control Center is restarting.")
                return 0
            print("Updater stopped before finishing.", file=sys.stderr)
            return 1
        if status.get("status") == "error":
            print(str(status.get("detail") or "update failed"), file=sys.stderr)
            return 1
        time.sleep(1)
    print("Update timed out.", file=sys.stderr)
    return 1


def download_compose(dest: Path, tag: str, root: Path) -> None:
    refs: list[str] = []
    primary = git_ref_for_tag(tag)
    for ref in (primary, "master", "main"):
        if ref not in refs:
            refs.append(ref)
    last_error = "download failed"
    for ref in refs:
        url = f"https://raw.githubusercontent.com/{REPO}/{ref}/compose.yaml"
        log_line(root, f"Fetching {url}")
        request = urllib.request.Request(url, headers={"User-Agent": "modulab-updater"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code} for {ref}"
            continue
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not download compose.yaml: {exc.reason}") from exc
        if b"control-center:" not in data or b"services:" not in data:
            last_error = f"{ref} did not return a Modulab compose file"
            continue
        if dest.exists():
            shutil.copy2(dest, dest.with_name(dest.name + ".bak"))
        dest.write_bytes(data)
        log_line(root, f"Wrote {dest.name} from {ref}")
        return
    raise RuntimeError(f"Could not download compose.yaml ({last_error})")


def import_kit_compose(root: Path, image: str) -> None:
    log_line(root, f"Reading compose templates from {image}")
    proc = subprocess.run(["docker", "create", "--entrypoint", "true", image], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        log_line(root, "Could not read compose templates from the new image. Keeping the current ones.")
        return
    cid = proc.stdout.strip()
    staging = root / ".modulab-kit-import"
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    try:
        copied = subprocess.run(
            ["docker", "cp", f"{cid}:/opt/modulab/.", str(staging)],
            capture_output=True,
            text=True,
            check=False,
        )
        if copied.returncode != 0 or not staging.is_dir():
            log_line(root, "Image has no /opt/modulab kit. Keeping the current compose templates.")
            return
        count = 0
        for path in sorted(staging.glob("docker-compose*.yml")):
            if path.name.endswith(".override.yml"):
                continue
            shutil.copy2(path, root / path.name)
            count += 1
        for name in ("postgres", "caddy", "scripts"):
            src = staging / name
            if not src.is_dir():
                continue
            dest = root / name
            for path in src.rglob("*"):
                if not path.is_file() or path.name.endswith(".override.yml"):
                    continue
                target = dest / path.relative_to(src)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                count += 1
        log_line(root, f"Updated {count} kit file(s) from the image")
    finally:
        subprocess.run(["docker", "rm", cid], capture_output=True, text=True, check=False)
        shutil.rmtree(staging, ignore_errors=True)


def enabled_ids(root: Path) -> set[str]:
    path = root / "lab.config.json"
    if not path.is_file():
        return {"control-center", "postgres", "caddy"}
    data = json.loads(path.read_text(encoding="utf-8"))
    enabled = data.get("enabled") or []
    return {str(item) for item in enabled}


def compose_cmd(project_dir: str, filename: str, profile: str, args: list[str]) -> list[str]:
    cmd = ["docker", "compose", "--project-directory", project_dir, "-f", str(Path(project_dir) / filename)]
    if profile:
        cmd.extend(["--profile", profile])
    cmd.extend(args)
    return cmd


def apply() -> int:
    root = Path(os.environ.get("MODULAB_ROOT") or HELPER_STATE)
    project_dir = os.environ.get("MODULAB_COMPOSE_PROJECT_DIR") or HELPER_COMPOSE
    filename = os.environ.get("MODULAB_COMPOSE_FILENAME") or "compose.yaml"
    tag = os.environ.get("MODULAB_TAG") or "latest"
    profile = os.environ.get("MODULAB_UPDATE_PROFILE") or ""
    image = f"ghcr.io/armanossiloko/modulab:{tag}"
    try:
        write_status(root, "running", "compose.yaml")
        log_line(root, f"Configured image tag: {tag}")
        download_compose(Path(project_dir) / filename, tag, root)
        write_status(root, "running", "pull")
        log_line(root, "Pulling Control Center image")
        env = os.environ.copy()
        run_logged(root, compose_cmd(project_dir, filename, profile, ["pull"]), env=env, cwd=project_dir)
        import_kit_compose(root, image)
        enabled = enabled_ids(root)
        for stack in CORE_STACKS:
            if stack not in enabled:
                log_line(root, f"Skipping {stack} (not enabled)")
                continue
            if not (root / f"docker-compose.{stack}.yml").is_file():
                log_line(root, f"Skipping {stack} (compose file missing)")
                continue
            write_status(root, "running", stack)
            log_line(root, f"Updating {stack}")
            stack_env = os.environ.copy()
            stack_env["MODULAB_ROOT"] = str(root)
            run_logged(
                root,
                ["python3", str(root / "scripts" / "run_bash.py"), "update.sh", stack],
                env=stack_env,
                cwd=str(root),
            )
        write_status(root, "restarting", "control-center")
        log_line(root, "Recreating Control Center")
        run_logged(root, compose_cmd(project_dir, filename, profile, ["up", "-d"]), env=env, cwd=project_dir)
        write_status(root, "ok", "done")
        log_line(root, "Control Center recreated")
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure to the status file
        message = str(exc).strip() or "update failed"
        log_line(root, message)
        write_status(root, "error", message[-400:])
        return 1


def self_check() -> None:
    assert tag_of("ghcr.io/armanossiloko/modulab:latest") == "latest"
    assert tag_of("ghcr.io/armanossiloko/modulab:1.2.3") == "1.2.3"
    assert tag_of("ghcr.io/armanossiloko/modulab@sha256:abc") == "latest"
    assert git_ref_for_tag("latest") == "master"
    assert git_ref_for_tag("1.2.3") == "v1.2.3"
    assert git_ref_for_tag("v1.2.3") == "v1.2.3"
    assert git_ref_for_tag("sha-abc") == "master"
    picked = pick_compose_file(r"D:\lab\compose.yaml", r"D:\lab")
    assert picked == ("D:/lab", "compose.yaml")
    picked = pick_compose_file("/home/user/modulab/compose.yml", "/home/user/modulab")
    assert picked == ("/home/user/modulab", "compose.yml")
    assert within("D:/data", "D:/data/compose")
    assert relative_to("D:/data", "D:/data/compose") == "compose"
    assert windows_desktop_path("D:/modulab/compose") == "/run/desktop/mnt/host/d/modulab/compose"
    print("ok")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print("Usage: python3 scripts/update-appliance.py launch|apply|--self-check", file=sys.stderr)
        return 2 if not args else 0
    command = args[0]
    if command == "--self-check":
        self_check()
        return 0
    if command == "launch":
        return launch()
    if command == "apply":
        return apply()
    print(f"Unknown command '{command}'", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
