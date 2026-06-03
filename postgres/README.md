# Shared Postgres

| Mechanism | When it runs | Use for |
|-----------|----------------|---------|
| `init/*.sql` | First start only (empty `data/postgres/`) | One-time `CREATE USER` / `CREATE DATABASE` |
| `bootstrap.sql` | Every `docker compose -f docker-compose.postgres.yml up` | Idempotent grants/users/DBs (duplicate-safe) |

Superuser defaults: `modulab` / `modulab` / database `modulab` (`.env.postgres.example`).

Manual apply on a running cluster:

```bash
docker exec -i postgres psql -U modulab < postgres/bootstrap.sql
```
