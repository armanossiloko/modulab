# Postgres init scripts (first boot only)

SQL files here are mounted to `/docker-entrypoint-initdb.d` and run **once**, when `data/postgres/` is empty.

Use for non-idempotent setup if you prefer, or mirror what you put in `postgres/bootstrap.sql`.

Example `10-myapp.sql`:

```sql
CREATE USER myapp WITH PASSWORD 'myapp';
CREATE DATABASE myapp OWNER myapp ENCODING 'UTF8';
```

Use numeric prefixes (`10-`, `20-`, …) for ordering.

**Every restart / every `compose up`:** put idempotent SQL in `postgres/bootstrap.sql` instead (see `postgres/README.md`).
