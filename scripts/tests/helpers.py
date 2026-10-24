"""Test helpers: a throwaway lab directory with its own copy of scripts/."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
REPO = SCRIPTS.parent


class TempLab:
    def __init__(self, with_repo_catalog: bool = False) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="modulab-test-")
        self.root = Path(self._tmp.name)
        shutil.copytree(SCRIPTS, self.root / "scripts", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        if with_repo_catalog:
            shutil.copytree(REPO / "catalog", self.root / "catalog")
            for compose in REPO.glob("docker-compose*.yml"):
                shutil.copy2(compose, self.root / compose.name)
        self.config({"lab": {"domain": "network.lan", "hostIp": "192.168.1.50"}, "enabled": ["postgres"]})
        self._old_env = os.environ.get("MODULAB_ROOT")
        os.environ["MODULAB_ROOT"] = str(self.root)

    def close(self) -> None:
        if self._old_env is None:
            os.environ.pop("MODULAB_ROOT", None)
        else:
            os.environ["MODULAB_ROOT"] = self._old_env
        # Drop modules imported from this lab so the next test gets fresh ROOT globals.
        for name in [n for n, m in sys.modules.items() if getattr(m, "__file__", "") and str(self.root) in str(m.__file__)]:
            del sys.modules[name]
        self._tmp.cleanup()

    def config(self, data: dict) -> None:
        (self.root / "lab.config.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    def read_config(self) -> dict:
        return json.loads((self.root / "lab.config.json").read_text(encoding="utf-8"))

    def recipe(self, recipe_id: str, data: dict, local: bool = False, compose: str | None = None) -> Path:
        folder = self.root / ("catalog.local" if local else "catalog") / recipe_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "recipe.json").write_text(json.dumps({"id": recipe_id, **data}), encoding="utf-8")
        if compose is not None:
            target = folder / "docker-compose.yml" if local else self.root / f"docker-compose.{recipe_id}.yml"
            target.write_text(compose, encoding="utf-8")
        return folder

    def module(self, filename: str) -> types.ModuleType:
        """Import scripts/<filename> from this lab (so ROOT points here)."""
        scripts = str(self.root / "scripts")
        if scripts not in sys.path:
            sys.path.insert(0, scripts)
        name = f"lab_{Path(filename).stem.replace('-', '_')}_{id(self)}"
        spec = importlib.util.spec_from_file_location(name, self.root / "scripts" / filename)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        sys.modules[name] = module  # dataclasses look their module up while the class is created
        spec.loader.exec_module(module)
        return module

    def __enter__(self) -> "TempLab":
        return self

    def __exit__(self, *exc: object) -> None:
        scripts = str(self.root / "scripts")
        if scripts in sys.path:
            sys.path.remove(scripts)
        self.close()
