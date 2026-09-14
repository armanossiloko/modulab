# Modulab — modular homelab stacks

Independent [Docker Compose](https://docs.docker.com/compose/) stacks for a personal lab. Run Control Center (dashboard + install API), shared Postgres/Redis, optional Pi-hole + Caddy for `*.network.lan` names, and install apps from a catalog.

Each stack is a root file `docker-compose.<name>.yml`.

## Prerequisites

- **Docker Engine** with Compose v2 (`docker compose`) — not Podman for this project
- Linux host recommended (Control Center talks to Docker via `/var/run/docker.sock`)
- Your server’s **LAN IP** (example below uses `192.168.1.10` — replace with yours)

Find your LAN IP:

```bash
hostname -I | awk '{print $1}'
```

## Quick start (fresh clone)

```bash
git clone https://github.com/armanossiloko/modulab.git
cd modulab
bash scripts/setup.sh
```

That creates **`lab.config.json`** from [`lab.config.example.json`](lab.config.example.json) and renders `.env`.

1. Edit **`lab.config.json`** and set at least:
   - `lab.hostIp` → this machine’s LAN IP (not `127.0.0.1`)
   - `lab.timezone` / passwords if you want something other than the defaults
2. Apply config and start enabled stacks:

```bash
bash scripts/render-config.sh
bash scripts/start.sh all
```

3. Open Control Center:
   - **By IP:** `http://192.168.1.10:8888` (use *your* `hostIp`)
   - **By name:** `http://home.network.lan` (only after clients use your host as DNS — see [LAN DNS](#lan-dns-required-for-networklan-names))

First Control Center start **builds a Docker image** (can take several minutes).

## Default credentials

All example secrets default to **`modulab`** (change them in `lab.config.json` for anything exposed beyond a trusted LAN):

| What | Value |
|------|--------|
| Postgres user / password / DB | `modulab` / `modulab` / `modulab` |
| Pi-hole admin password | `modulab` |
| PicoShare admin secret | `modulab` |
| FUTO Notes sync password | `modulab` |

Anyone who can open Control Center can install/start/stop apps (LAN reachability is the trust boundary — do not expose port 8888 to the public internet).

## Config files

| File | Purpose |
|------|---------|
| **`lab.config.json`** | Only hand-edited config (**gitignored**) |
| **`lab.config.example.json`** | Tracked template |
| **`.env`** | Generated for Compose (**gitignored** — do not edit) |
| **`secrets/`** | Optional files referenced as `"$secret:filename"` |

```json
{
  "lab": {
    "domain": "network.lan",
    "hostIp": "192.168.1.10",
    "timezone": "Europe/Berlin",
    "postgresUser": "modulab",
    "postgresPassword": "modulab",
    "postgresDb": "modulab",
    "piholePassword": "modulab",
    "picoshareAdminSecret": "modulab",
    "futoNotesPassword": "modulab",
    "searxngSecret": "modulab"
  },
  "caddy": { "ENABLE_LAN_PROXY": true },
  "enabled": ["control-center", "postgres", "redis", "pihole", "caddy"]
}
```

After every edit:

```bash
bash scripts/render-config.sh
```

Sensitive values can live under `secrets/` and be referenced, e.g. `"picoshareAdminSecret": "$secret:picoshare-admin"`.

## How you reach apps

Two ways, both supported when stacks are running:

| Method | Example (replace IP / names) | Needs LAN DNS? |
|--------|------------------------------|----------------|
| **IP + port** | `http://192.168.1.10:8083` | No |
| **Hostname** | `http://it-tools.network.lan` | **Yes** — client DNS must be your `lab.hostIp` |

HTTP app ports publish on **`LAB_PUBLISH_IP`** (default `0.0.0.0`), so they listen on the LAN. **Postgres stays on `127.0.0.1:5432` only.**

With **`caddy.ENABLE_LAN_PROXY: true`** (example default):

- Caddy listens on **host port 80** (host networking) and routes `http://<label>.<domain>` → the app port
- Pi-hole answers DNS for `*.<domain>` → `lab.hostIp`

### Port map (IP access)

Use `http://<lab.hostIp>:<port>`:

| Port | Service |
|------|---------|
| **8888** | Control Center |
| **80** | Caddy (hostname routes only — bare IP shows a stub) |
| **8083** | IT-Tools |
| **8084** | BentoPDF |
| **8082** | Stirling PDF |
| **8080** | SearXNG |
| **8096** / **8920** | Jellyfin |
| **5678** | n8n |
| **5055** | Seerr |
| **4001** | PicoShare |
| **3005** | FUTO Notes |
| **2283** | Immich |
| **5080** | Pi-hole admin |
| **53** tcp/udp | Pi-hole DNS (bound to `lab.hostIp`) |
| **5432** | Postgres (**localhost only**) |

### Hostname map (`lab.domain`, default `network.lan`)

| URL | Stack |
|-----|-------|
| http://home.network.lan | Control Center |
| http://jellyfin.network.lan | Jellyfin |
| http://n8n.network.lan | n8n |
| http://seerr.network.lan | Seerr |
| http://it-tools.network.lan | IT-Tools |
| http://stirling.network.lan | Stirling PDF |
| http://bentopdf.network.lan | BentoPDF |
| http://picoshare.network.lan | PicoShare |
| http://notes.network.lan | FUTO Notes |
| http://immich.network.lan | Immich |
| http://searxng.network.lan | SearXNG |
| http://pihole.network.lan/admin | Pi-hole admin |

Replace `network.lan` with whatever you set in `lab.domain`.

## LAN DNS (required for `*.network.lan` names)

Hostname URLs **do not work** until devices use this server as DNS.

1. Set **`lab.hostIp`** to the Docker host’s LAN address and start Pi-hole + Caddy (`enabled` in the example already includes them).
2. Point **router DHCP DNS** (or each client’s DNS) at that same IP.
3. Test from a client:

```bash
dig @192.168.1.10 it-tools.network.lan   # use your hostIp
curl -I http://it-tools.network.lan
```

On the server itself, OS DNS may still be your ISP resolver until you set it (NetworkManager / `resolvectl`) to `lab.hostIp` or add a routing domain for `network.lan`.

Pi-hole forwards unknown queries upstream (default Cloudflare `1.1.1.1` / `1.0.0.1` via `PIHOLE_UPSTREAM_DNS`).

More detail: [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md).

## Install apps (Control Center or CLI)

**Library UI:** open Control Center → **Library** → **Install**.

**CLI:**

```bash
bash scripts/install.sh jellyfin
bash scripts/install.sh it-tools
```

Install / start / uninstall will:

1. Enable the app (and `dependsOn`) in `lab.config.json`
2. Run `render-config.sh` (`.env` + Caddy/Pi-hole edge files)
3. Start the stack
4. Run **`refresh-edge.sh`** when LAN proxy is on and Pi-hole/Caddy are present, so new DNS/proxy routes apply immediately

Recipes live in [`catalog/<id>/recipe.json`](catalog/) (`proxy`, `dns`, `dependsOn`, …).

## Day-to-day commands

```bash
bash scripts/start.sh all              # start enabled[]
bash scripts/start.sh jellyfin         # one stack
bash scripts/stop.sh jellyfin          # stop one (volumes kept)
bash scripts/stop.sh all
bash scripts/render-config.sh          # after editing lab.config.json
bash scripts/refresh-edge.sh           # reload Pi-hole DNS + Caddy proxy
bash scripts/update.sh <stack>         # pull + recreate
```

VS Code / Cursor tasks: **lab: setup**, **lab: render config**, **docker-compose: all up/down**.

## Control Center layout

```text
control-center/
  src/                                  # Angular SPA
  src-backend/Modulab.ControlCenter/    # API + SPA host (.NET)
  defaults/                             # tracked dashboard templates
  wwwroot/                              # generated / image-baked (gitignored)
Modulab.slnx
```

- Production UI is built **inside the Docker image**
- Local UI dev: `cd control-center && npm start` (proxies `/api` to `:8888`)
- After API changes: `bash scripts/generate-api.sh`

## Stacks overview

| Stack | Compose file | Role |
|--------|----------------|------|
| **Control Center** | `docker-compose.control-center.yml` | Home UI + install API |
| **Caddy** | `docker-compose.caddy.yml` | Optional `*.domain` reverse proxy on port 80 |
| **Pi-hole** | `docker-compose.pihole.yml` | LAN DNS for `*.domain` |
| **Postgres** | `docker-compose.postgres.yml` | Shared DB (vector image; localhost only) |
| **Redis** | `docker-compose.redis.yml` | Shared cache (Docker network) |
| **Jellyfin** | `docker-compose.jellyfin.yml` | Media |
| **n8n** | `docker-compose.n8n.yml` | Automation |
| **Seerr** | `docker-compose.seerr.yml` | Requests |
| **IT-Tools** | `docker-compose.it-tools.yml` | Utilities |
| **Stirling PDF** / **BentoPDF** | `docker-compose.stirling-pdf.yml` / `.bentopdf.yml` | PDF tools |
| **PicoShare** | `docker-compose.picoshare.yml` | File sharing |
| **FUTO Notes** | `docker-compose.futo-notes.yml` | Encrypted notes sync |
| **Immich** | `docker-compose.immich.yml` | Photos |
| **SearXNG** | `docker-compose.searxng.yml` | Metasearch |

**Shared infra:** one Postgres and one Redis on Docker network `modulab`. Apps get their own DB name via recipes — never a second Postgres for Immich/n8n.

### Postgres

```bash
bash scripts/start.sh postgres
```

- Host: `127.0.0.1:5432` · Docker hostname: `postgres` on **`modulab`**
- Credentials from `lab.postgresUser` / `postgresPassword` / `postgresDb`
- Data: `data/postgres/` — see [postgres/README.md](postgres/README.md)
- Each `up` runs generated `postgres/bootstrap.sql` for app databases

### Immich / FUTO Notes / Jellyfin / n8n / SearXNG

See install commands above and stack-specific notes in older docs sections:

- Immich: Library or `bash scripts/install.sh immich` — UI on `:2283` or `immich.<domain>`
- FUTO Notes: sync password from `lab.futoNotesPassword`; URL `:3005` or `notes.<domain>`
- Jellyfin: container user `1000:1000`; media under `./media`
- n8n: shared DB `n8n`; host/webhook URLs follow `lab.domain`
- SearXNG: settings from `searxng/settings.yml.template`

### Local data (gitignored)

| Path | Used by |
|------|---------|
| `data/` | Runtime volumes |
| `media/` | Jellyfin library |
| `secrets/` | Optional secret files |
| `lab.config.json`, `.env` | Local config |

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `*.network.lan` does not resolve | Client DNS is not `lab.hostIp` |
| `http://<ip>/` shows a short stub text | That is Caddy’s default on port 80 — use a hostname or `http://<ip>:<port>` |
| Install from Control Center fails on bind mounts | Fixed via `COMPOSE_PROJECT_NAME` + host project directory detection; ensure you are on a current `master` |
| Port 53 conflict | Pi-hole LAN mode binds DNS to **`lab.hostIp:53`** only (avoids systemd-resolved on `127.0.0.53`) |

## License

MIT — see [LICENSE](LICENSE).
