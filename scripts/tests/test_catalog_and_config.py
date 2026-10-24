"""lab_catalog, render-config, generate-edge and validate-catalog."""

from __future__ import annotations

import json
import unittest

from helpers import TempLab

JELLYFIN = {"name": "Jellyfin", "port": 8096, "proxy": {"host": "jellyfin", "port": 8096}}
COMPOSE = "services:\n  {id}:\n    image: x\n    container_name: {id}\n"


class LabCatalogTests(unittest.TestCase):
    def test_local_recipes_load_and_cannot_shadow_builtins(self) -> None:
        with TempLab() as lab:
            lab.recipe("jellyfin", JELLYFIN, compose=COMPOSE.format(id="jellyfin"))
            lab.recipe("jellyfin", {"name": "Twin"}, local=True)
            lab.recipe("whoami", {"name": "Whoami", "dependsOn": ["postgres"]}, local=True, compose=COMPOSE.format(id="whoami"))
            lab.recipe("postgres", {"name": "Postgres"})
            catalog = lab.module("lab_catalog.py")

            by_id = catalog.recipes_by_id(lab.root)
            self.assertEqual(by_id["jellyfin"]["name"], "Jellyfin")
            self.assertTrue(by_id["whoami"]["_custom"])
            self.assertEqual(catalog.compose_file("whoami", lab.root), lab.root / "catalog.local" / "whoami" / "docker-compose.yml")
            self.assertEqual(catalog.compose_file("jellyfin", lab.root), lab.root / "docker-compose.jellyfin.yml")
            self.assertIsNone(catalog.compose_file("nope", lab.root))
            self.assertEqual(catalog.depends("whoami", lab.root), ["postgres"])


class RenderConfigTests(unittest.TestCase):
    def test_generate_placeholders_become_persistent_random_secrets(self) -> None:
        with TempLab() as lab:
            lab.config({"lab": {"hostIp": "192.168.1.50", "postgresPassword": "$generate", "piholePassword": "$generate"}, "enabled": []})
            render = lab.module("render-config.py")
            render.render(lab.root / "lab.config.json")

            secret = lab.read_config()["lab"]["postgresPassword"]
            self.assertNotEqual(secret, "$generate")
            self.assertGreaterEqual(len(secret), 20)
            self.assertNotEqual(secret, lab.read_config()["lab"]["piholePassword"])
            env = (lab.root / ".env").read_text(encoding="utf-8")
            self.assertIn(f"POSTGRES_PASSWORD={secret}\n", env)

            render.render(lab.root / "lab.config.json")
            self.assertEqual(lab.read_config()["lab"]["postgresPassword"], secret)

    def test_https_and_protected_apps(self) -> None:
        with TempLab() as lab:
            lab.config({
                "lab": {"hostIp": "192.168.1.50", "domain": "home.arpa", "enableLanHttps": True, "protectedApps": ["it-tools"]},
                "caddy": {"ENABLE_LAN_PROXY": True},
                "enabled": [],
            })
            render = lab.module("render-config.py")
            render.docker_desktop = lambda: False
            render.render(lab.root / "lab.config.json")
            env = (lab.root / ".env").read_text(encoding="utf-8")
            self.assertIn("ENABLE_LAN_HTTPS=true", env)
            self.assertIn("CADDY_AUTO_HTTPS=disable_redirects", env)
            self.assertIn("IT_TOOLS_PUBLISH_IP=127.0.0.1", env)
            self.assertIn("WEBHOOK_URL=https://n8n.home.arpa/", env)

    def test_protected_apps_stay_on_the_lan_on_docker_desktop_and_https_needs_the_proxy(self) -> None:
        with TempLab() as lab:
            lab.config({"lab": {"hostIp": "1.2.3.4", "enableLanHttps": True, "protectedApps": ["it-tools"]}, "caddy": {"ENABLE_LAN_PROXY": False}})
            render = lab.module("render-config.py")
            render.docker_desktop = lambda: True
            render.render(lab.root / "lab.config.json")
            env = (lab.root / ".env").read_text(encoding="utf-8")
            self.assertIn("ENABLE_LAN_HTTPS=false", env)
            self.assertIn("CADDY_AUTO_HTTPS=off", env)
            self.assertNotIn("IT_TOOLS_PUBLISH_IP", env)

    def test_legacy_mediacms_secret_is_replaced_by_the_lab_secret(self) -> None:
        with TempLab() as lab:
            lab.config({
                "lab": {"hostIp": "1.2.3.4", "mediacmsSecretKey": "fresh"},
                "mediacms": {"MEDIACMS_SECRET_KEY": "modulab-mediacms-secret-key"},
            })
            render = lab.module("render-config.py")
            render.render(lab.root / "lab.config.json")
            self.assertIn("MEDIACMS_SECRET_KEY=fresh\n", (lab.root / ".env").read_text(encoding="utf-8"))


class GenerateEdgeTests(unittest.TestCase):
    def test_proxy_routes_https_and_forward_auth(self) -> None:
        with TempLab() as lab:
            lab.recipe("jellyfin", JELLYFIN)
            lab.recipe("it-tools", {"name": "IT", "proxy": {"host": "it-tools", "port": 8083}})
            lab.recipe("control-center", {"name": "CC", "proxy": {"host": "home", "port": 8888}})
            edge = lab.module("generate-edge.py")
            targets = edge.collect_proxy_targets(edge.load_recipes())

            plain = edge.render_proxy(targets, edge.EdgeSettings())
            self.assertIn("http://jellyfin.{$LOCAL_DOMAIN} {", plain)
            self.assertNotIn("https://", plain)
            self.assertNotIn("forward_auth", plain)

            secured = edge.render_proxy(targets, edge.EdgeSettings(https=True, protected=frozenset({"it-tools", "control-center"})))
            self.assertIn("http://it-tools.{$LOCAL_DOMAIN}, https://it-tools.{$LOCAL_DOMAIN} {\n\timport modulab_auth\n", secured)
            self.assertIn("(modulab_auth) {", secured)
            self.assertIn("uri /api/auth/verify", secured)
            # Control Center has its own login; never gate it behind itself.
            home = secured.split("home.{$LOCAL_DOMAIN}")[1].split("}\n")[0]
            self.assertNotIn("modulab_auth", home)

    def test_settings_read_from_config(self) -> None:
        with TempLab() as lab:
            lab.config({"lab": {"domain": "x.lan", "enableLanHttps": True, "protectedApps": ["a"]}, "caddy": {"ENABLE_LAN_PROXY": True}})
            edge = lab.module("generate-edge.py")
            settings = edge.edge_settings()
            self.assertEqual(settings.domain, "x.lan")
            self.assertTrue(settings.https)
            self.assertEqual(settings.protected, frozenset({"a"}))


class ValidateCatalogTests(unittest.TestCase):
    def test_repository_catalog_is_valid(self) -> None:
        with TempLab(with_repo_catalog=True) as lab:
            errors, _warnings = lab.module("validate-catalog.py").validate(lab.root)
            self.assertEqual(errors, [])

    def test_common_mistakes_are_reported(self) -> None:
        with TempLab() as lab:
            lab.recipe("good", {"name": "Good", "port": 9000, "proxy": {"host": "good", "port": 9000}}, compose=COMPOSE.format(id="good"))
            lab.recipe("bad", {
                "name": "",
                "port": 9000,
                "proxy": {"host": "good", "port": 1},
                "dependsOn": ["missing"],
                "data": ["media"],
                "fields": [{"key": "not valid"}],
            }, compose="services:\n  bad:\n    image: x\n    container_name: other\n")
            errors, _ = lab.module("validate-catalog.py").validate(lab.root)
            text = "\n".join(errors)
            for fragment in ("name is required", "port 9000", "proxy hostname 'good'", "dependsOn 'missing'",
                             "data path 'media'", "field key 'not valid'", "no container_name matches 'bad'"):
                self.assertIn(fragment, text)


if __name__ == "__main__":
    unittest.main()
