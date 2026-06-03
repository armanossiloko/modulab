# Lab — modular homelab stacks

Small, independent [Docker Compose](https://docs.docker.com/compose/) stacks you can run one at a time or together on a single host. Each service lives in its own `docker-compose.<name>.yml` at the repo root (or a wrapper that includes the [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) submodule).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (v2: `docker compose`, or the classic `docker-compose` CLI used by this repo’s VS Code tasks)
- **Odysseus:** after cloning, initialize the submodule: `git submodule update --init --recursive`

## Setup (once)

Copy example env files to local `.env.*` (never overwrites files you already have):

```bash
bash scripts/setup.sh
```

Edit the generated files — at minimum set passwords in `.env.immich`, `.env.pihole`, and `.env.postgres`. Set **`LAB_HOST_IP`** and **`PIHOLE_LOCAL_DOMAIN`** in `.env.pihole` (same domain in `.env.caddy`). Odysseus config lives in `odysseus/.env`.

VS Code: run task **lab: setup**.

## Local URLs (all stacks)

After setup, start **Pi-hole** and **Caddy** once (DNS + reverse proxy on port 80):

```bash
bash scripts/start.sh pihole
bash scripts/start.sh caddy
```

Then start whichever stacks you need. Every web UI is **`http://<label>.<domain>`** with no port (domain defaults to `network.lan`):

| URL | Stack |
|-----|-------|
| http://jellyfin.network.lan | Jellyfin |
| http://n8n.network.lan | n8n |
| http://seerr.network.lan | Seerr |
| http://it-tools.network.lan | IT-Tools |
| http://stirling.network.lan | Stirling PDF |
| http://immich.network.lan | Immich |
| http://odysseus.network.lan | Odysseus |
| http://searxng.network.lan | SearXNG (Odysseus) |
| http://ntfy.network.lan | ntfy (Odysseus) |
| http://pihole.network.lan/admin | Pi-hole admin |
| `postgres.network.lan:5432` | Shared Postgres (TCP, not HTTP) |

Details: [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md) · routes: [caddy/Caddyfile](caddy/Caddyfile)

## Quick start

Start one stack (after setup):

```bash
bash scripts/start.sh jellyfin
bash scripts/start.sh n8n
bash scripts/start.sh odysseus
```

Or use **Run and Debug** → **&lt;Stack&gt; up** in VS Code.

Stop a stack:

```bash
docker compose -f docker-compose.<stack>.yml down
```

For Odysseus, `down` uses the same `-f docker-compose.odysseus.yml` file.

## Stacks

| Stack | Compose file | URL (Pi-hole + Caddy) | Role |
|--------|----------------|------------------------|------|
| **n8n** | `docker-compose.n8n.yml` | http://n8n.network.lan | Workflow automation ([n8n](https://n8n.io/)) |
| **Jellyfin** | `docker-compose.jellyfin.yml` | http://jellyfin.network.lan | Media server ([Jellyfin](https://jellyfin.org/)) |
| **Seerr** | `docker-compose.seerr.yml` | http://seerr.network.lan | Requests & discovery ([Seerr](https://docs.seerr.dev/)) |
| **IT-Tools** | `docker-compose.it-tools.yml` | http://it-tools.network.lan | Dev utilities ([it-tools](https://github.com/CorentinTh/it-tools)) |
| **Stirling PDF** | `docker-compose.stirling-pdf.yml` | http://stirling.network.lan | PDF toolkit ([Stirling PDF](https://docs.stirlingpdf.com/)) |
| **Postgres** | `docker-compose.postgres.yml` | `postgres.network.lan:5432` | Shared PostgreSQL 18 |
| **Immich** | `docker-compose.immich.yml` | http://immich.network.lan | Photo/video backup ([Immich](https://immich.app/)) |
| **Pi-hole** | `docker-compose.pihole.yml` | http://pihole.network.lan/admin | DNS ([Pi-hole](https://pi-hole.net/)) |
| **Caddy** | `docker-compose.caddy.yml` | port **80** (all rows above) | Reverse proxy ([Caddy](https://caddyserver.com/)) |
| **Odysseus** | `docker-compose.odysseus.yml` | http://odysseus.network.lan | AI workspace; submodule in `odysseus/` |

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
| 2283 | Immich (loopback) | `docker-compose.immich.yml` |
| 5080 | Pi-hole admin (loopback) | `docker-compose.pihole.yml` |
| 53 | Pi-hole DNS (loopback tcp/udp) | `docker-compose.pihole.yml` |
| 80 | Caddy reverse proxy (host network) | `docker-compose.caddy.yml` |
| 5432 | Postgres (loopback) | `docker-compose.postgres.yml` |

### Postgres

```bash
bash scripts/start.sh postgres
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

### Immich

```bash
bash scripts/setup.sh   # once — creates .env.immich from example
bash scripts/start.sh immich
```

- UI: http://immich.network.lan (first visit creates the admin user)
- Data: `data/immich/library/` (uploads), `data/immich/postgres/` (Immich DB)
- Machine learning container is **commented out** by default (backup/gallery only). Uncomment `immich-machine-learning` in `docker-compose.immich.yml` for smart search and facial recognition; turn off unused ML jobs in **Admin → Machine Learning** if the service is not running
- Bundled Postgres 14 (vector extensions) and Valkey
- Pin versions via `IMMICH_VERSION` in `.env.immich` ([releases](https://github.com/immich-app/immich/releases))
- Hardware transcoding: uncomment `extends` on `immich-server` and add upstream `hwaccel.*.yml` from the [Immich docker folder](https://github.com/immich-app/immich/tree/main/docker) if needed

### Pi-hole

```bash
bash scripts/setup.sh   # once — creates .env.pihole from example
bash scripts/start.sh pihole
```

- Admin: http://pihole.network.lan/admin
- DNS: `127.0.0.1:53` on the host (tcp + udp; publish on LAN via override if needed)
- Data: `data/pihole/etc-pihole/`
- Port **53** must be free on the host (stop other DNS listeners first)
- Set **`LAB_HOST_IP`** in `.env.pihole` ([pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md))
- **LAN / Raspberry Pi:** bind DNS on all interfaces via `docker-compose.override.yml`, e.g. `"53:53/tcp"` and `"53:53/udp"`, then set your router DHCP DNS to the Pi’s IP

### Caddy

```bash
bash scripts/start.sh caddy
```

- Proxies **every** web stack in [caddy/Caddyfile](caddy/Caddyfile) on port **80** (host network)
- **`PIHOLE_LOCAL_DOMAIN`** in `.env.caddy` must match `.env.pihole`
- Target stacks must be running; Caddy forwards to their localhost ports
- Port **80** must be free on the host
- Some apps need their public URL set in-app or in `.env.*` (n8n, Immich, Jellyfin)

### Odysseus (submodule)

Odysseus lives in [`odysseus/`](odysseus/) as a [git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules) pointing at [pewdiepie-archdaemon/odysseus](https://github.com/pewdiepie-archdaemon/odysseus).

`docker-compose.odysseus.yml` at the repo root includes the submodule’s compose file so you can start it like the other stacks. Build context, `.env`, and runtime data stay under `odysseus/`.

```bash
bash scripts/start.sh odysseus
```

- UI: http://odysseus.network.lan
- First admin password: `docker compose -f docker-compose.odysseus.yml logs odysseus`
- Data: `odysseus/data/` · logs: `odysseus/logs/` (ignored by the submodule’s git, not under lab `data/`)
- UI: http://odysseus.network.lan · SearXNG: http://searxng.network.lan · ntfy: http://ntfy.network.lan · ChromaDB `127.0.0.1:8100` (loopback)

Update the submodule to latest upstream:

```bash
git submodule update --remote odysseus
# commit the updated gitlink in lab when you want to pin a new revision
```

Upstream docs (GPU overlays, macOS native run, etc.): see `odysseus/README.md`.

### Persistence and local data

Git ignores runtime data so it is not committed (see `.gitignore`):

- `data/` — used by n8n, Jellyfin, Seerr, Immich (under stack-specific subpaths).
- `media/` — Jellyfin library mount.
- `secrets/` — optional place for sensitive files.
- **Stirling PDF** uses **`.data/stirling-pdf/`** at the repo root for tessdata, configs, logs, and pipeline.
- **Odysseus** uses **`odysseus/data/`** and **`odysseus/logs/`** inside the submodule checkout.

Create directories as needed before first run, or let Docker create them when mounting.

### n8n environment (optional)

Defaults live in `.env.n8n.example` (created by `setup.sh`). Adjust `N8N_HOST`, `WEBHOOK_URL`, `GENERIC_TIMEZONE`, etc. for reverse-proxy or custom domain setups.

n8n volumes:

- `./data/n8n` — application data
- `./data/n8n-local-files` — local/binary files mount at `/files` in the container

### Jellyfin notes

The container runs as `1000:1000`. On Linux, align ownership of `./data/jellyfin/*` and `./media` with that UID/GID if you hit permission issues.

## VS Code / Cursor

| Task | Script | Purpose |
|------|--------|---------|
| **lab: setup** | `scripts/setup.sh` | Copy all `.env.*.example` → `.env.*` (once) |
| **docker-compose: &lt;name&gt; up** | `scripts/start.sh <name>` | Start that stack (requires setup) |

Launch profiles run the matching **up** task. **`start.sh` does not create env files** — run setup first.

| Stack | Env file |
|-------|----------|
| Jellyfin, n8n, Seerr, IT-Tools, Stirling PDF, Immich, Pi-hole, Postgres, Caddy | `.env.<stack>` at repo root |
| Odysseus | `odysseus/.env` (submodule) |

All `.env.*` files are gitignored except `*.example`.

When you add a new `docker-compose.*.yml`, add `.env.<name>.example`, register the stack in `scripts/start.sh` / `scripts/setup.sh` (via glob), and add a task + launch entry (see `.cursor/rules/docker-compose-vscode-launch.mdc`).

## License

MIT — see [LICENSE](LICENSE).
