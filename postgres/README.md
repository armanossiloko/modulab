# Shared Postgres

One Postgres container for the whole lab (`container_name: postgres` on Docker network `modulab`).

Uses Immich's **vector/pgvectors** image so Immich and other apps share the same instance with **separate databases** (never a second Postgres).

| Mechanism | When it runs | Use for |
|-----------|----------------|---------|
| `init/*.sql` | First start only (empty data dir) | Rare one-time seeds |
| `bootstrap.sql` | Every `start.sh postgres` (generated) | `CREATE DATABASE` per recipe (`database` field) |

Configure only via **`lab.config.json`** (`lab.postgresUser` / `postgresPassword` / `postgresDb`).

```bash
bash scripts/render-config.sh   # regenerates .env + postgres/bootstrap.sql
bash scripts/start.sh postgres
```

Apps declare a DB in their recipe, e.g. `"database": "immich"`. Install/start pulls in Postgres via `dependsOn`. Redis is separate (shared optional stack or Immich sidecar).
