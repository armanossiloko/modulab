# Lab — modular homelab stacks

Independent [Docker Compose](https://docs.docker.com/compose/) stacks you can run alone or together on one host. Each stack has a `docker-compose.<name>.yml` at the repo root; [Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) is included as a submodule.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose (v2: `docker compose`, or classic `docker-compose` used by VS Code tasks)
- **Odysseus:** after cloning, run `git submodule update --init --recursive`

## Setup

Copy example env files to local `.env.*` (never overwrites existing files):

```bash
bash scripts/setup.sh
```

Edit the generated files — at minimum set passwords in `.env.immich` and `.env.postgres`. Odysseus config lives in `odysseus/.env`.

VS Code: run task **lab: setup**.

## Quick start

Start one stack:

```bash
bash scripts/start.sh jellyfin
bash scripts/start.sh n8n
bash scripts/start.sh odysseus
```

Start the default lab (Caddy dashboard, Postgres, all apps — skips Odysseus if the submodule is not initialized). Pi-hole is not included:

```bash
bash scripts/start.sh all
bash scripts/start.sh pihole   # optional — only for network.lan DNS
```

Stop a stack (containers removed, volumes kept):

```bash
bash scripts/stop.sh jellyfin
bash scripts/stop.sh all
```

Or use **Run and Debug** → **All stacks up** / **&lt;Stack&gt; up** (and matching **down** tasks) in VS Code.

## Dashboard

The **caddy** stack serves a home dashboard on loopback. An optional **network.lan** reverse proxy is off by default.

```bash
bash scripts/start.sh caddy
```

Open **http://127.0.0.1:8888** (`HOME_PORT` in `.env.caddy`). Cards show running stacks; links use `127.0.0.1:<port>`. You can skip Caddy and open each stack on its own port instead — see the [port map](#port-map).

| Mode | What to run | How you reach services |
|------|-------------|-------------------------|
| **Direct** (default) | App stacks only | `http://127.0.0.1:8096`, `:5678`, … |
| **Dashboard** | `caddy` (`ENABLE_LAN_PROXY=false`) | Dashboard at **http://127.0.0.1:8888** → links to localhost ports |
| **network.lan** | Pi-hole + `caddy` with `ENABLE_LAN_PROXY=true` | Portless `http://jellyfin.network.lan` on port 80 |

Config: [home/services.json](home/services.json) · routes: [caddy/Caddyfile](caddy/Caddyfile) · LAN proxy: [caddy/proxy.caddy](caddy/proxy.caddy)

### Optional: network.lan URLs

Enable only if you want portless LAN hostnames. In **`.env.caddy`**:

```env
ENABLE_LAN_PROXY=true
PIHOLE_LOCAL_DOMAIN=network.lan
```

Set **`LAB_HOST_IP`** in **`.env.pihole`**, then:

```bash
bash scripts/start.sh pihole
bash scripts/start.sh caddy
```

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

Details: [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md)

## Stacks

| Stack | Compose file | Default URL | Role |
|--------|----------------|-------------|------|
| **Caddy** | `docker-compose.caddy.yml` | http://127.0.0.1:8888 | Dashboard; optional network.lan proxy |
| **n8n** | `docker-compose.n8n.yml` | http://127.0.0.1:5678 | Workflow automation ([n8n](https://n8n.io/)) |
| **Jellyfin** | `docker-compose.jellyfin.yml` | http://localhost:8096 | Media server ([Jellyfin](https://jellyfin.org/)) |
| **Seerr** | `docker-compose.seerr.yml` | http://localhost:5055 | Requests & discovery ([Seerr](https://docs.seerr.dev/)) |
| **IT-Tools** | `docker-compose.it-tools.yml` | http://localhost:8083 | Dev utilities ([it-tools](https://github.com/CorentinTh/it-tools)) |
| **Stirling PDF** | `docker-compose.stirling-pdf.yml` | http://localhost:8082 | PDF toolkit ([Stirling PDF](https://docs.stirlingpdf.com/)) |
| **Postgres** | `docker-compose.postgres.yml` | `127.0.0.1:5432` | Shared PostgreSQL 18 |
| **Immich** | `docker-compose.immich.yml` | http://127.0.0.1:2283 | Photo/video backup ([Immich](https://immich.app/)) |
| **Pi-hole** | `docker-compose.pihole.yml` | http://127.0.0.1:5080/admin | DNS ([Pi-hole](https://pi-hole.net/)); optional |
| **Odysseus** | `docker-compose.odysseus.yml` | http://localhost:7000 | AI workspace; submodule in `odysseus/` |

Ports **8080**, **8082**, and **8083** are chosen so stacks can run together: Odysseus SearXNG (8080), Stirling PDF (8082), IT-Tools (8083).

### Port map

| Port | Stack / service | Compose file |
|------|-----------------|--------------|
| 8888 | Dashboard (loopback) | `docker-compose.caddy.yml` |
| 80 | LAN proxy (loopback, if `ENABLE_LAN_PROXY=true`) | `docker-compose.caddy.proxy-ports.yml` |
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
| 5432 | Postgres (loopback) | `docker-compose.postgres.yml` |

## Stack notes

### Postgres

```bash
bash scripts/start.sh postgres
```

- Host: `127.0.0.1:5432` · in-network hostname: `postgres` on `modulab-db`
- Data: `data/postgres/`
- Defaults: user/database `modulab` / password `modulab` — override via `.env.postgres`
- **First boot:** `postgres/init/<NN>-<app>.sql` (empty data dir only)
- **Every `up`:** idempotent `postgres/bootstrap.sql` via `db-bootstrap` — see [postgres/README.md](postgres/README.md)

Other containers join the shared database:

```yaml
networks:
  modulab-db:
    external: true
    name: modulab-db
```

**Odysseus + Cookbook:** ChromaDB uses host port **8100**. Cookbook’s diffusion server also defaults to **8100** — pick another port in the serve command if both are active.

### Immich

```bash
bash scripts/setup.sh   # once
bash scripts/start.sh immich
```

- UI: http://127.0.0.1:2283 (first visit creates the admin user)
- Data: `data/immich/library/`, `data/immich/postgres/`
- Machine learning container is **commented out** by default. Uncomment `immich-machine-learning` in `docker-compose.immich.yml` for smart search and facial recognition
- Pin versions via `IMMICH_VERSION` in `.env.immich` ([releases](https://github.com/immich-app/immich/releases))
- Hardware transcoding: uncomment `extends` on `immich-server` and add upstream `hwaccel.*.yml` from the [Immich docker folder](https://github.com/immich-app/immich/tree/main/docker) if needed

### Pi-hole

```bash
bash scripts/setup.sh   # once
bash scripts/start.sh pihole
```

- Admin: http://pihole.network.lan/admin (with network.lan DNS) or http://127.0.0.1:5080/admin
- DNS: `127.0.0.1:53` on the host (tcp + udp)
- Data: `data/pihole/etc-pihole/`
- Port **53** must be free on the host
- Set **`LAB_HOST_IP`** in `.env.pihole` — see [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md)
- **LAN / Raspberry Pi:** bind DNS on all interfaces via `docker-compose.override.yml`, e.g. `"53:53/tcp"` and `"53:53/udp"`, then point router DHCP DNS at the host IP

### Odysseus

Submodule at [`odysseus/`](odysseus/) → [pewdiepie-archdaemon/odysseus](https://github.com/pewdiepie-archdaemon/odysseus). Root `docker-compose.odysseus.yml` includes the submodule compose file; build context, `.env`, and data stay under `odysseus/`.

```bash
bash scripts/start.sh odysseus
```

- UI: http://localhost:7000 · SearXNG: http://127.0.0.1:8080 · ntfy: http://127.0.0.1:8091 · ChromaDB: `127.0.0.1:8100`
- First admin password: `docker compose -f docker-compose.odysseus.yml logs odysseus`
- Data: `odysseus/data/` · logs: `odysseus/logs/`

Update submodule:

```bash
git submodule update --remote odysseus
```

GPU overlays, macOS native run, etc.: [odysseus/README.md](odysseus/README.md)

### Jellyfin

Container runs as `1000:1000`. On Linux, align ownership of `./data/jellyfin/*` and `./media` with that UID/GID if you hit permission errors.

### n8n

Defaults in `.env.n8n.example` (created by `setup.sh`). Adjust `N8N_HOST`, `WEBHOOK_URL`, `GENERIC_TIMEZONE`, etc. for reverse-proxy setups.

Volumes: `./data/n8n` (app data), `./data/n8n-local-files` (mounted at `/files` in the container).

### Local data

Git ignores runtime data (see `.gitignore`):

| Path | Used by |
|------|---------|
| `data/` | n8n, Jellyfin, Seerr, Immich, Postgres, Pi-hole, … |
| `media/` | Jellyfin library |
| `secrets/` | Optional sensitive files |
| `.data/stirling-pdf/` | Stirling PDF (tessdata, configs, logs) |
| `odysseus/data/`, `odysseus/logs/` | Odysseus (inside submodule) |

Create directories before first run, or let Docker create them on mount.

## VS Code / Cursor

| Task | Script | Purpose |
|------|--------|---------|
| **lab: setup** | `scripts/setup.sh` | Copy all `.env.*.example` → `.env.*` |
| **docker-compose: all up** | `scripts/start.sh all` | Start every stack |
| **docker-compose: all down** | `scripts/stop.sh all` | Stop every stack (keeps volumes) |
| **docker-compose: &lt;name&gt; up** | `scripts/start.sh <name>` | Start one stack |
| **docker-compose: &lt;name&gt; down** | `scripts/stop.sh <name>` | Stop one stack |

Launch profiles run the matching **up** or **down** task. **`start.sh` does not create env files** — run setup first.

| Stack | Env file |
|-------|----------|
| Jellyfin, n8n, Seerr, IT-Tools, Stirling PDF, Immich, Caddy, Pi-hole, Postgres | `.env.<stack>` at repo root |
| Odysseus | `odysseus/.env` |

All `.env.*` files are gitignored except `*.example`.

When adding a new `docker-compose.*.yml`, add `.env.<name>.example`, register the stack in `scripts/start.sh` / `scripts/setup.sh`, and add a task + launch entry (see `.cursor/rules/docker-compose-vscode-launch.mdc`).

## License

MIT — see [LICENSE](LICENSE).
