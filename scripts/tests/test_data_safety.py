"""backup.py / restore.py file handling, rollback tags, and kit seeding."""

from __future__ import annotations

import io
import json
import os
import re
import tarfile
import unittest
from pathlib import Path

from helpers import TempLab


class BackupArchiveTests(unittest.TestCase):
    def test_tar_respects_excludes_and_round_trips_through_restore(self) -> None:
        with TempLab() as lab:
            (lab.root / "data/jellyfin/config").mkdir(parents=True)
            (lab.root / "data/jellyfin/cache").mkdir(parents=True)
            (lab.root / "data/jellyfin/config/library.db").write_text("db", encoding="utf-8")
            (lab.root / "data/jellyfin/cache/big.bin").write_text("cache", encoding="utf-8")
            backup = lab.module("backup.py")

            archive = lab.root / "j.tar.gz"
            count = backup.write_tar(archive, ["data/jellyfin"], ["data/jellyfin/cache"])
            self.assertEqual(count, 1)
            with tarfile.open(archive) as tar:
                names = tar.getnames()
            self.assertIn("data/jellyfin/config/library.db", names)
            self.assertFalse(any("cache" in n for n in names))

    def test_config_archive_and_restore_keep_the_replaced_files(self) -> None:
        with TempLab() as lab:
            (lab.root / "secrets").mkdir()
            (lab.root / "secrets/token").write_text("old", encoding="utf-8")
            backup = lab.module("backup.py")
            dest = lab.root / "backups/20260101-000000"
            dest.mkdir(parents=True)
            self.assertTrue(backup.backup_config(dest))

            # Change things after the backup.
            (lab.root / "secrets/token").write_text("new", encoding="utf-8")
            lab.config({"lab": {"domain": "changed.lan"}})

            restore = lab.module("restore.py")
            restore.run_lab_script = lambda *args: None  # no bash/docker in unit tests
            safety = lab.root / "data/.pre-restore/x"
            restore.restore_config(dest, safety)

            self.assertEqual((lab.root / "secrets/token").read_text(encoding="utf-8"), "old")
            self.assertEqual(lab.read_config()["lab"]["domain"], "network.lan")
            self.assertEqual((safety / "secrets/token").read_text(encoding="utf-8"), "new")
            self.assertEqual(json.loads((safety / "lab.config.json").read_text(encoding="utf-8"))["lab"]["domain"], "changed.lan")

    def test_restore_refuses_path_traversal(self) -> None:
        with TempLab() as lab:
            restore = lab.module("restore.py")
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as tar:
                info = tarfile.TarInfo("data/app/../../../etc/passwd")
                info.size = 1
                tar.addfile(info, io.BytesIO(b"x"))
            buf.seek(0)
            with tarfile.open(fileobj=buf, mode="r:gz") as tar:
                with self.assertRaises(RuntimeError):
                    restore.safe_members(tar, ["data/app"])

    def test_restore_skips_symlinks_out_of_the_tree(self) -> None:
        with TempLab() as lab:
            restore = lab.module("restore.py")
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:gz") as tar:
                link = tarfile.TarInfo("data/app/evil")
                link.type = tarfile.SYMTYPE
                link.linkname = "/etc/shadow"
                tar.addfile(link)
                ok = tarfile.TarInfo("data/app/ok.txt")
                ok.size = 2
                tar.addfile(ok, io.BytesIO(b"ok"))
            buf.seek(0)
            with tarfile.open(fileobj=buf, mode="r:gz") as tar:
                names = [m.name for m in restore.safe_members(tar, ["data/app"])]
            self.assertEqual(names, ["data/app/ok.txt"])

    def test_retention_keeps_newest_and_clears_partials(self) -> None:
        with TempLab() as lab:
            backup = lab.module("backup.py")
            for name in ("20260101-000000", "20260102-000000", "20260103-000000", ".20260104-000000.partial", "notes"):
                (lab.root / "backups" / name).mkdir(parents=True)
            backup.prune(2)
            left = sorted(p.name for p in (lab.root / "backups").iterdir())
            self.assertEqual(left, ["20260102-000000", "20260103-000000", "notes"])

    def test_local_repository_detection(self) -> None:
        with TempLab() as lab:
            backup = lab.module("backup.py")
            self.assertTrue(backup.is_local_repo("/mnt/usb/restic"))
            self.assertTrue(backup.is_local_repo("D:/restic"))
            self.assertFalse(backup.is_local_repo("s3:s3.amazonaws.com/bucket"))
            self.assertFalse(backup.is_local_repo("sftp:user@nas:/backups"))


class RollbackTagTests(unittest.TestCase):
    def test_tags_are_valid_docker_references(self) -> None:
        with TempLab() as lab:
            rollback = lab.module("rollback_images.py")
            tag = rollback.rollback_tag("ghcr.io/Immich-App/immich-server:v3", "sha256:0123456789abcdef0123")
            self.assertEqual(tag, "modulab-rollback/ghcr-io-immich-app-immich-server-v3:0123456789ab")
            self.assertRegex(tag, r"^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_.-]{1,128}$")


class SeedTests(unittest.TestCase):
    def _kit(self, lab: TempLab, recipes: list[str]) -> Path:
        # Inside the temp lab so it is cleaned up with it; seeding never scans this folder.
        kit = lab.root / ".kit"
        for rid in recipes:
            (kit / "catalog" / rid).mkdir(parents=True, exist_ok=True)
            (kit / "catalog" / rid / "recipe.json").write_text(json.dumps({"id": rid}), encoding="utf-8")
            (kit / f"docker-compose.{rid}.yml").write_text("services: {}\n", encoding="utf-8")
        return kit

    def test_prunes_only_what_an_older_kit_shipped(self) -> None:
        with TempLab() as lab:
            seed = lab.module("seed-lab-state.py")
            old_kit = self._kit(lab, ["jellyfin", "oldapp"])
            seed.sync_tree(old_kit / "catalog", lab.root / "catalog")
            seed.sync_compose_files(old_kit, lab.root)
            seed.prune_stale(lab.root, old_kit)

            # User files that no kit ever shipped.
            (lab.root / "docker-compose.mine.yml").write_text("services: {}\n", encoding="utf-8")
            (lab.root / "docker-compose.jellyfin.override.yml").write_text("services: {}\n", encoding="utf-8")
            (lab.root / "catalog.local/mine").mkdir(parents=True)
            lab.config({"lab": {}, "enabled": ["jellyfin", "oldapp"]})

            new_kit = self._kit(lab, ["jellyfin"])
            for path in (new_kit / "catalog" / "oldapp", new_kit / "docker-compose.oldapp.yml"):
                if path.is_dir():
                    import shutil
                    shutil.rmtree(path)
                elif path.exists():
                    path.unlink()
            seed.prune_stale(lab.root, new_kit)

            self.assertFalse((lab.root / "catalog/oldapp").exists())
            self.assertFalse((lab.root / "docker-compose.oldapp.yml").exists())
            self.assertTrue((lab.root / "catalog/jellyfin").exists())
            self.assertTrue((lab.root / "docker-compose.mine.yml").exists())
            self.assertTrue((lab.root / "docker-compose.jellyfin.override.yml").exists())
            self.assertTrue((lab.root / "catalog.local/mine").exists())
            self.assertEqual(lab.read_config()["enabled"], ["jellyfin"])

    def test_retired_seerr_is_removed_even_without_a_manifest(self) -> None:
        with TempLab() as lab:
            seed = lab.module("seed-lab-state.py")
            seed.stop_retired_stack = lambda *args: None
            (lab.root / "catalog/seerr").mkdir(parents=True)
            (lab.root / "docker-compose.seerr.yml").write_text("services: {}\n", encoding="utf-8")
            lab.config({"lab": {}, "enabled": ["postgres", "seerr"]})
            seed.prune_stale(lab.root, self._kit(lab, ["postgres"]))
            self.assertFalse((lab.root / "catalog/seerr").exists())
            self.assertFalse((lab.root / "docker-compose.seerr.yml").exists())
            self.assertEqual(lab.read_config()["enabled"], ["postgres"])


if __name__ == "__main__":
    unittest.main()
