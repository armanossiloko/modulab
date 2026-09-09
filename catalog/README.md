# App recipes

Each subdirectory is a **recipe**: catalog metadata, install form, proxy/DNS, and shared-infra dependencies.

```text
catalog/<id>/recipe.json
```

Hand-edit **`lab.config.json` only**. `bash scripts/render-config.sh` generates root `.env`, `postgres/bootstrap.sql`, edge proxy/DNS, and `control-center/wwwroot/services.json`.

## Important fields

| Field | Purpose |
|-------|---------|
| `dependsOn` | Other stacks started first if missing (e.g. `["postgres","redis"]`) |
| `database` | DB name created on the **shared** Postgres (one container, many DBs) |
| `databaseNeedsVector` | Hint that the app needs the vector-capable Postgres image (already the shared image) |
| `installable` / `core` | Library Install vs always-on infra |
| `proxy` / `dns` | LAN hostnames |
| `fields` / `defaults` | Install form + config defaults merged into `lab.config.json` |

## Shared infra rule

- **One** Postgres, **one** Redis.
- Apps that need a DB get a database on shared Postgres — they must not ship their own Postgres.
- Apps that need cache use shared Redis.
- Declaring `dependsOn` is enough; install/start will enable and run dependencies.
