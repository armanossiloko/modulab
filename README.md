# Lab — modular homelab stacks

Small, independent [Docker Compose](https://docs.docker.com/compose/) stacks you can run one at a time or together on a single host. Each service lives in its own `docker-compose.<name>.yml` at the repo root (or a wrapper that includes the [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) submodule).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (v2: `docker compose`, or the classic `docker-compose` CLI used by this repo’s VS Code tasks)
- **Odysseus:** after cloning, initialize the submodule:

```bash
git submodule update --init --recursive
cp odysseus/.env.example odysseus/.env   # optional; recommended on first Odysseus run
```

## Quick start

From the repository root:

```bash
docker compose -f docker-compose.<stack>.yml up -d
```

Examples:

```bash
docker compose -f docker-compose.jellyfin.yml up -d
docker compose -f docker-compose.n8n.yml up -d
docker compose -f docker-compose.odysseus.yml up -d --build
```

Stop a stack:

```bash
docker compose -f docker-compose.<stack>.yml down
```

For Odysseus, `down` uses the same `-f docker-compose.odysseus.yml` file.

## Stacks

| Stack | Compose file | Default URL / port | Role |
|--------|----------------|---------------------|------|
| **n8n** | `docker-compose.n8n.yml` | http://127.0.0.1:5678 | Workflow automation ([n8n](https://n8n.io/)); loopback only |
| **Jellyfin** | `docker-compose.jellyfin.yml` | http://localhost:8096 | Media server ([Jellyfin](https://jellyfin.org/)) |
| **Seerr** | `docker-compose.seerr.yml` | http://localhost:5055 | Requests & discovery for Plex/Jellyfin ([Seerr](https://docs.seerr.dev/)) |
| **IT-Tools** | `docker-compose.it-tools.yml` | http://localhost:8083 | Browser-based dev utilities ([it-tools](https://github.com/CorentinTh/it-tools)) |
| **Stirling PDF** | `docker-compose.stirling-pdf.yml` | http://localhost:8082 | PDF toolkit ([Stirling PDF](https://docs.stirlingpdf.com/)) |
| **Postgres** | `docker-compose.postgres.yml` | `127.0.0.1:5432` | Shared PostgreSQL 18 (`modulab-db` network) |
| **Odysseus** | `docker-compose.odysseus.yml` | http://localhost:7000 | Self-hosted AI workspace; git submodule in `odysseus/` |

Host ports **8080**, **8082**, and **8083** are assigned so these stacks can run together: Odysseus SearXNG (8080, loopback), Stirling PDF (8082), IT-Tools (8083).

### Port map (host bindings)

| Port | Stack / service | Compose file |
|------|-----------------|--------------|
| 5055 | Seerr | `docker-compose.seerr.yml` |
| 5678 | n8n (loopback) | `docker-compose.n8n.yml` |
| 7000 | Odysseus UI | `docker-compose.odysseus.yml` → `odysseus/` |
| 8080 | Odysseus SearXNG (loopback) | `odysseus/docker-compose.yml` |
| 8082 | Stirling PDF | `docker-compose.stirling-pdf.yml` |
| 8083 | IT-Tools | `docker-compose.it-tools.yml` |
| 8091 | Odysseus ntfy (loopback) | `odysseus/docker-compose.yml` |
| 8096, 8920 | Jellyfin | `docker-compose.jellyfin.yml` |
| 8100 | Odysseus ChromaDB (loopback) | `odysseus/docker-compose.yml` |
| 5432 | Postgres (loopback) | `docker-compose.postgres.yml` |

### Postgres

```bash
docker compose -f docker-compose.postgres.yml up -d
```

- Host: `127.0.0.1:5432` · in-network hostname: `postgres` on `modulab-db`
- Data: `data/postgres/` (ignored by git)
- Defaults: user/database `modulab` / password `modulab` — override via `.env.postgres` from `.env.postgres.example`
- **First boot:** `postgres/init/<NN>-<app>.sql` (empty data dir only)
- **Every `up`:** idempotent `postgres/bootstrap.sql` via `db-bootstrap` (see `postgres/README.md`)

Other containers join the same database:

```yaml
networks:
  modulab-db:
    external: true
    name: modulab-db
```

**Odysseus + Cookbook:** ChromaDB is published on host **8100**. Cookbook’s diffusion server also defaults to port **8100** when serving on the host—use another port in the serve command if both are active.

### Odysseus (submodule)

Odysseus lives in [`odysseus/`](odysseus/) as a [git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules) pointing at [pewdiepie-archdaemon/odysseus](https://github.com/pewdiepie-archdaemon/odysseus).

`docker-compose.odysseus.yml` at the repo root includes the submodule’s compose file so you can start it like the other stacks. Build context, `.env`, and runtime data stay under `odysseus/`.

```bash
docker compose -f docker-compose.odysseus.yml up -d --build
```

- UI: http://localhost:7000
- First admin password: `docker compose -f docker-compose.odysseus.yml logs odysseus`
- Data: `odysseus/data/` · logs: `odysseus/logs/` (ignored by the submodule’s git, not under lab `data/`)
- Bundled loopback services: SearXNG http://127.0.0.1:8080 · ChromaDB `127.0.0.1:8100` · ntfy http://127.0.0.1:8091

Update the submodule to latest upstream:

```bash
git submodule update --remote odysseus
# commit the updated gitlink in lab when you want to pin a new revision
```

Upstream docs (GPU overlays, macOS native run, etc.): see `odysseus/README.md`.

### Persistence and local data

Git ignores runtime data so it is not committed (see `.gitignore`):

- `data/` — used by n8n, Jellyfin, Seerr (under stack-specific subpaths).
- `media/` — Jellyfin library mount.
- `secrets/` — optional place for sensitive files.
- **Stirling PDF** uses **`.data/stirling-pdf/`** at the repo root for tessdata, configs, logs, and pipeline.
- **Odysseus** uses **`odysseus/data/`** and **`odysseus/logs/`** inside the submodule checkout.

Create directories as needed before first run, or let Docker create them when mounting.

### n8n environment (optional)

`docker-compose.n8n.yml` uses inline defaults (`N8N_HOST`, `WEBHOOK_URL`, `GENERIC_TIMEZONE`, etc.). For a reverse-proxy or custom domain setup, you can set variables in your shell or a `.env` file in the same directory as the compose file.

`.env.n8n` in the repo is an example with placeholders (`DOMAIN_NAME`, `SUBDOMAIN`, `GENERIC_TIMEZONE`, `SSL_EMAIL`) for TLS/domain-oriented deployments; wire it in explicitly if you use it, for example:

```bash
docker compose --env-file .env.n8n -f docker-compose.n8n.yml up -d
```

n8n volumes:

- `./data/n8n` — application data
- `./data/n8n-local-files` — local/binary files mount at `/files` in the container

### Jellyfin notes

The container runs as `1000:1000`. On Linux, align ownership of `./data/jellyfin/*` and `./media` with that UID/GID if you hit permission issues.

## VS Code / Cursor

`.vscode/tasks.json` defines tasks named `docker-compose: <name> up` (for example `docker-compose: jellyfin up` or `docker-compose: odysseus up`). `.vscode/launch.json` provides **Docker** launch configs that run the matching task. Use **Run and Debug** to start a stack from the editor.

When you add a new `docker-compose.*.yml` at the repo root, follow the same pattern: one task + one launch entry per stack (see `.cursor/rules/docker-compose-vscode-launch.mdc`).

## License

MIT — see [LICENSE](LICENSE).
