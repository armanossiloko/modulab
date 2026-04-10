# Lab — modular homelab stacks

Small, independent [Docker Compose](https://docs.docker.com/compose/) stacks you can run one at a time or mix on a single host. Each service lives in its own `docker-compose.<name>.yml` file so you only start what you need.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (v2: `docker compose`, or the classic `docker-compose` CLI used by this repo’s VS Code tasks)

## Quick start

From the repository root:

```bash
docker compose -f docker-compose.<stack>.yml up -d
```

Examples:

```bash
docker compose -f docker-compose.jellyfin.yml up -d
docker compose -f docker-compose.n8n.yml up -d
```

Stop a stack:

```bash
docker compose -f docker-compose.<stack>.yml down
```

## Stacks

| Stack | Compose file | Default URL / port | Role |
|--------|----------------|---------------------|------|
| **n8n** | `docker-compose.n8n.yml` | http://127.0.0.1:5678 | Workflow automation ([n8n](https://n8n.io/)); bound to loopback only |
| **Jellyfin** | `docker-compose.jellyfin.yml` | http://localhost:8096 | Media server ([Jellyfin](https://jellyfin.org/)) |
| **Seerr** | `docker-compose.seerr.yml` | http://localhost:5055 | Requests & discovery for Plex/Jellyfin ([Seerr](https://docs.seerr.dev/)) |
| **IT-Tools** | `docker-compose.it-tools.yml` | http://localhost:8081 | Browser-based dev utilities ([it-tools](https://github.com/CorentinTh/it-tools)) |
| **Stirling PDF** | `docker-compose.stirling-pdf.yml` | http://localhost:8080 | PDF toolkit ([Stirling PDF](https://docs.stirlingpdf.com/)) |

Ports **8080** (Stirling PDF) and **8081** (IT-Tools) are split on purpose so both can run together.

### Persistence and local data

Git ignores runtime data so it is not committed (see `.gitignore`):

- `data/` — used by n8n, Jellyfin, Seerr (under stack-specific subpaths).
- `media/` — Jellyfin library mount.
- `secrets/` — optional place for sensitive files.
- **Stirling PDF** uses a **`.data/`** directory at the repo root (note the leading dot) for tessdata, configs, logs, and pipeline — different from the `data/` folder other stacks use.

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

`.vscode/tasks.json` defines tasks named `docker-compose: <name> up` (for example `docker-compose: jellyfin up`), and `.vscode/launch.json` provides **Docker** launch configs (for example “Jellyfin up”) that run the matching task then attach to the compose project. Use **Run and Debug** to start a stack from the editor.

When you add a new `docker-compose.*.yml` at the repo root, follow the same pattern: one task + one launch entry per stack (see `.cursor/rules/docker-compose-vscode-launch.mdc`).

## License

MIT — see [LICENSE](LICENSE).
