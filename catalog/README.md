# App recipes

Each subdirectory is a **recipe**: catalog metadata, install form, proxy/DNS, and shared-infra dependencies.

```text
catalog/<id>/recipe.json
```

Hand-edit **`lab.config.json` only** (or use Control Center → Settings → Lab). `python3 scripts/lab.py render-config` generates root `.env`, `postgres/bootstrap.sql`, and edge proxy/DNS.

## Important fields

| Field | Purpose |
|-------|---------|
| `dependsOn` | Other stacks started first if missing (e.g. `["postgres"]`) |
| `preferShared` | Soft deps: use shared stack if already enabled/running (e.g. `["redis"]`), else app-local sidecar |
| `database` | DB name created on the **shared** Postgres (one container, many DBs) |
| `databaseNeedsVector` | Hint that the app needs the vector-capable Postgres image (already the shared image) |
| `installable` / `core` | Library Install vs always-on infra |
| `proxy` / `dns` | LAN hostnames |
| `fields` / `defaults` | Install form + config defaults merged into `lab.config.json` |

## Shared infra rule

- **One** shared Postgres for all apps — apps must not ship their own Postgres.
- **Redis** is optional for most apps. MediaCMS requires the shared stack (`dependsOn`). Immich prefers shared Redis when it is already enabled or running, otherwise a sidecar.
- Declaring `dependsOn` is enough for hard deps; `preferShared` does not auto-enable the shared stack.
