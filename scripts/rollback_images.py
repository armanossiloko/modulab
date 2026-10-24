#!/usr/bin/env python3
"""Remember and restore the images a stack ran before an update.

  rollback_images.py record <app> <container-id>...   before pulling (writes a pending record)
  rollback_images.py finalize <app>                   after `up -d`: keep the record only if an image changed
  rollback_images.py restore <app>                    re-point image tags to the recorded images

Each previous image gets a tag like modulab-rollback/<image>:<short-id> so `docker image prune`
does not delete it. Records live in data/control-center/rollback/<app>.json; Control Center shows
"Roll back" while one exists.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_catalog  # noqa: E402

DIR = lab_catalog.lab_root() / "data" / "control-center" / "rollback"


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.PIPE)


def rollback_tag(ref: str, image_id: str) -> str:
    repo = re.sub(r"[^a-z0-9]+", "-", ref.lower()).strip("-")[:100] or "image"
    short = image_id.split(":")[-1][:12]
    return f"modulab-rollback/{repo}:{short}"


def record(app: str, container_ids: list[str]) -> None:
    images = []
    for cid in container_ids:
        info = json.loads(docker("inspect", cid))[0]
        ref = info["Config"]["Image"]
        image_id = info["Image"]
        tag = rollback_tag(ref, image_id)
        docker("tag", image_id, tag)
        images.append({"container": info["Name"].lstrip("/"), "ref": ref, "imageId": image_id, "tag": tag})
    DIR.mkdir(parents=True, exist_ok=True)
    pending = {"app": app, "recordedAt": datetime.now(timezone.utc).isoformat(), "images": images}
    (DIR / f"{app}.pending.json").write_text(json.dumps(pending, indent=2) + "\n", encoding="utf-8")


def finalize(app: str) -> None:
    pending_path = DIR / f"{app}.pending.json"
    if not pending_path.is_file():
        return
    pending = json.loads(pending_path.read_text(encoding="utf-8"))
    changed = False
    for entry in pending["images"]:
        try:
            current = json.loads(docker("inspect", entry["container"]))[0]["Image"]
        except subprocess.CalledProcessError:
            changed = True  # container renamed/removed by the update — treat as changed
            continue
        if current != entry["imageId"]:
            changed = True
    final_path = DIR / f"{app}.json"
    if changed:
        old_tags = set()
        if final_path.is_file():
            old_tags = {e["tag"] for e in json.loads(final_path.read_text(encoding="utf-8"))["images"]}
        pending_path.replace(final_path)
        keep = {e["tag"] for e in pending["images"]}
        for tag in old_tags - keep:
            subprocess.run(["docker", "rmi", tag], capture_output=True)
        print(f"rollback point saved for {app}", flush=True)
    else:
        # Nothing changed: keep the previous rollback point (and its tags) as it was.
        new_tags = {e["tag"] for e in pending["images"]}
        old_tags = set()
        if final_path.is_file():
            old_tags = {e["tag"] for e in json.loads(final_path.read_text(encoding="utf-8"))["images"]}
        for tag in new_tags - old_tags:
            subprocess.run(["docker", "rmi", tag], capture_output=True)
        pending_path.unlink()
        print(f"{app} was already up to date", flush=True)


def restore(app: str) -> None:
    final_path = DIR / f"{app}.json"
    if not final_path.is_file():
        raise SystemExit(f"no rollback point for {app}")
    data = json.loads(final_path.read_text(encoding="utf-8"))
    for entry in data["images"]:
        docker("tag", entry["tag"], entry["ref"])
        print(f"{entry['ref']} -> {entry['imageId'][:19]}", flush=True)


def done(app: str) -> None:
    """After a successful rollback: drop the record and the extra tags."""
    final_path = DIR / f"{app}.json"
    if not final_path.is_file():
        return
    for entry in json.loads(final_path.read_text(encoding="utf-8"))["images"]:
        subprocess.run(["docker", "rmi", entry["tag"]], capture_output=True)
    final_path.unlink()


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == "record":
        record(argv[2], argv[3:])
    elif len(argv) == 3 and argv[1] == "finalize":
        finalize(argv[2])
    elif len(argv) == 3 and argv[1] == "restore":
        restore(argv[2])
    elif len(argv) == 3 and argv[1] == "done":
        done(argv[2])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
