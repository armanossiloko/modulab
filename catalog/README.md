# App recipes

Each subdirectory is a **recipe**: catalog metadata, install form, proxy/DNS, data and backup rules, and shared-infra dependencies.

```text
catalog/<id>/recipe.json            built-in (this repo, shipped in the image)
catalog.local/<id>/recipe.json      your own apps (Library → Add app); lives in the state folder
docker-compose.<id>.yml             built-in compose file at the lab root
catalog.local/<id>/docker-compose.yml   compose file of a local app
```

Hand-edit **`lab.config.json` only** (or use Control Center → Settings → Lab). `python3 scripts/lab.py render-config` generates root `.env`, `postgres/bootstrap.sql`, and edge proxy/DNS.

## Important fields

| Field | Purpose |
|-------|---------|
| `dependsOn` | Other stacks started first if missing (e.g. `["postgres"]`) |
| `preferShared` | Soft deps: use shared stack if already enabled/running (e.g. `["redis"]`), else app-local sidecar |
| `database` | DB name created on the **shared** Postgres (one container, many DBs); dumped by backups, dropped on purge |
| `databaseNeedsVector` | Hint that the app needs the vector-capable Postgres image (already the shared image) |
| `installable` / `core` | Library Install vs always-on infra |
| `proxy` / `dns` | LAN hostnames (`proxy.host` must be unique) |
| `fields` / `defaults` | Install / Configure form + config defaults merged into `lab.config.json` |
| `data` | Folders under `data/` the app owns: backed up, restored, deleted on "uninstall and delete data" |
| `backup.exclude` | Paths inside `data` not worth backing up (caches, transcodes, huge media) |
| `backup.stop` | Stop the app while archiving (SQLite and other files that are unsafe to copy live) |

## Adding a built-in app (contributing)

1. `catalog/<id>/recipe.json` — copy a similar recipe. `id` = folder name, lowercase with dashes.
2. `docker-compose.<id>.yml` at the repo root:
   - `container_name: <id>` (or `<id>-<service>`); Control Center matches containers by it.
   - Publish ports as `"${<ID>_PUBLISH_IP:-${MODULAB_PUBLISH_IP:-0.0.0.0}}:<port>:<container-port>"` (`<ID>` = id in upper snake case) so the login gate can bind it to loopback.
   - Image as `repo/image:${<ID>_TAG:-latest}`, plus a matching `<ID>_TAG` field labelled *Image tag* so users can pin versions.
   - Bind mounts under `${MODULAB_HOST_ROOT:-.}/data/<id>/…`, and list `data/<id>` in the recipe's `data`.
   - A `healthcheck` when the image does not ship one (check that `wget`/`curl` exists in the image).
   - `restart: unless-stopped`.
3. Library icon: `control-center/public/app-icons/<id>.png` (+ attribution in `NOTICE.txt`).
4. `python3 scripts/validate-catalog.py` — CI runs it too.

## Shared infra rule

- **One** shared Postgres for all apps — apps must not ship their own Postgres.
- **Redis** is optional for most apps. MediaCMS requires the shared stack (`dependsOn`). Immich prefers shared Redis when it is already enabled or running, otherwise a sidecar.
- Declaring `dependsOn` is enough for hard deps; `preferShared` does not auto-enable the shared stack.
