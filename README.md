# Modulab — modular homelab stacks

Independent [Docker Compose](https://docs.docker.com/compose/) stacks for a personal lab. Run Control Center (dashboard + install API), shared Postgres, optional Caddy / Pi-hole for `*.network.lan` names, and install apps from a catalog.

---

## Install guide (first time)

**You need:** [Docker Engine](https://docs.docker.com/engine/install/) with Compose v2 (Docker Desktop is fine).  
**You do not need:** a git clone, Python, or Node on the host.

Catalog, scripts, and compose templates ship inside the published image. Your PC only keeps a **state directory** (config + app data).

### Linux / macOS

```bash
# 1. Create a permanent state folder
mkdir -p "$HOME/modulab-data"

# 2. Tell Compose the absolute path to that folder (required)
export MODULAB_HOST_ROOT="$HOME/modulab-data"

# 3. Download the bootstrap file (any working directory is fine)
curl -fsSL -o compose.yaml \
  https://raw.githubusercontent.com/armanossiloko/modulab/master/compose.yaml

# 4. Start Modulab
docker compose up -d
```

### Windows (PowerShell + Docker Desktop)

```powershell
# 1. State folder
New-Item -ItemType Directory -Force -Path "$HOME\modulab-data" | Out-Null

# 2. Absolute path for bind mounts (required)
$env:MODULAB_HOST_ROOT = (Resolve-Path "$HOME\modulab-data").Path

# 3. Bootstrap compose
curl.exe -fsSL -o compose.yaml `
  https://raw.githubusercontent.com/armanossiloko/modulab/master/compose.yaml

# 4. Start
docker compose up -d
```

> Tip: keep `MODULAB_HOST_ROOT` set in the same shell (or your user environment) whenever you run `docker compose` for Modulab.

### Open Control Center and finish setup

1. Wait until the container is healthy (`docker compose ps`). First pull can take a few minutes.
2. Open **http://localhost:8888** (or `http://<this-PC-LAN-IP>:8888` from another device).
3. Go to **Settings → Lab**.
4. Set **Host IP** to this machine’s LAN address (not `127.0.0.1`). Example: `192.168.1.50`.
5. Optionally set domain, timezone, passwords, LAN reverse proxy (Caddy), or enable Pi-hole.
6. Click **Save**.

Until Host IP is set, a banner appears and **Library → Install** stays disabled.

### Install apps

1. Open **Library**.
2. Choose an app (e.g. Jellyfin, Immich) → **Install**.
3. Open the app by IP+port or, if Pi-hole + Caddy are configured, by `http://<name>.network.lan`.

Dependencies start automatically. Immich uses shared Redis if it is already running; otherwise it starts its own sidecar Redis.

### What the first boot does

| Step | What happens |
|------|----------------|
| Pull image | `ghcr.io/armanossiloko/modulab:latest` |
| Seed state | Copies catalog, scripts, and compose templates into `MODULAB_HOST_ROOT` |
| Base stacks | Starts **Postgres** + **Caddy** (default). Redis and Pi-hole stay off until you enable them |
| Control Center | Serves UI + API on port **8888** |

### Day-to-day (appliance)

```bash
export MODULAB_HOST_ROOT="$HOME/modulab-data"   # if not already set
cd /path/to/folder/with/compose.yaml

docker compose ps          # status
docker compose logs -f     # logs
docker compose pull && docker compose up -d   # update Control Center image
docker compose down        # stop Control Center (app containers may keep running)
```

App start/stop/update after the first setup is done in the **Library** UI (or via scripts if you use a contributor checkout).

### Optional: friendly hostnames (`*.network.lan`)

Apps always work via `http://<host-ip>:<port>`. Hostnames need DNS:

1. In **Settings → Lab**, set Host IP and enable **Pi-hole**.
2. Point your router’s DHCP DNS (or each client) at that Host IP.
3. Use URLs like `http://jellyfin.network.lan` (Caddy on port 80).

Details: [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md).

### Environment variables

| Variable | Required | Meaning |
|----------|----------|---------|
| `MODULAB_HOST_ROOT` | **Yes** | Absolute host path to the state directory (bind-mounted at `/lab`) |
| `MODULAB_TAG` | No | Image tag (default `latest`) |
| `MODULAB_PUBLISH_IP` | No | Interface for published ports (default `0.0.0.0`) |
| `HOME_PORT` | No | Control Center host port (default `8888`) |
| `MODULAB_ROOT` | Set by compose | State path **inside** the container (`/lab`) |
| `MODULAB_KIT` | Set by image | Read-only kit inside the image (`/opt/modulab`) |

### Image / registry

- Image: `ghcr.io/armanossiloko/modulab:latest` (also version tags from CI)
- Bootstrap file: [`compose.yaml`](compose.yaml) in this repo

If the GHCR package is private:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
docker pull ghcr.io/armanossiloko/modulab:latest
```

Public packages can be pulled without login.

### Trust model

Anyone who can open Control Center can install/start/stop apps. **Do not expose port 8888 to the public internet** — keep it on your LAN (or behind your own auth/VPN).

### Troubleshooting (first install)

| Symptom | Fix |
|---------|-----|
| `MODULAB_HOST_ROOT` / variable is not set | Export an **absolute** path before `docker compose up` |
| `pull access denied` for `ghcr.io/...` | Log in to GHCR, or wait until the image is published / make the package public |
| Library Install disabled | Set Host IP under **Settings → Lab** and Save |
| Port 80 already in use | Turn off LAN proxy in Settings → Lab, or free host port 80 |
| Port 53 conflict | Leave Pi-hole disabled, or free DNS on your Host IP |

---

## Contributor quick start (git clone)

For developing Modulab itself:

```bash
git clone https://github.com/armanossiloko/modulab.git
cd modulab
python3 scripts/lab.py setup
```

Edit `lab.config.json` → set `lab.hostIp` → then:

```bash
python3 scripts/lab.py render-config
python3 scripts/lab.py start all
```

Requires **Docker Compose v2** and **Python 3**. `python3 scripts/lab.py` LF-normalizes shell scripts so Windows checkouts work when Control Center runs them from the bind mount.

Local Control Center build:

```bash
python3 scripts/lab.py start control-center
```

Or use root `docker-compose.control-center.yml` (`build:` + optional `MODULAB_SEED=auto` so a full checkout is not overwritten by the kit).

---

## Default credentials

Example secrets default to **`modulab`** (change in Settings → Lab or `lab.config.json`):

| What | Value |
|------|--------|
| Postgres user / password / DB | `modulab` / `modulab` / `modulab` |
| Pi-hole admin password | `modulab` |
| PicoShare / FUTO Notes / SearXNG | see `lab.config.example.json` |

## Base stack vs optional edge

| Stack | Default | Notes |
|-------|---------|--------|
| Control Center | yes | UI + install API |
| Postgres | yes | Shared DB (vector image) |
| Caddy | yes | LAN reverse proxy on port 80 when `ENABLE_LAN_PROXY` is true |
| Pi-hole | no | Optional LAN DNS / ad-blocking — enable in Settings → Lab or Library |
| Redis | no | Optional shared cache — Immich uses shared Redis if present, otherwise a sidecar |

## Config files

| File | Purpose |
|------|---------|
| **`lab.config.json`** | Hand-edited or via Settings → Lab (**gitignored** / lives in state dir) |
| **`lab.config.example.json`** | Tracked template |
| **`.env`** | Generated for Compose — do not edit |
| **`secrets/`** | Optional `"$secret:filename"` files |

Default `enabled`:

```json
["control-center", "postgres", "caddy"]
```

After hand-editing config (contributor path):

```bash
python3 scripts/lab.py render-config
```

## How you reach apps

| Method | Example | Needs LAN DNS? |
|--------|---------|----------------|
| **IP + port** | `http://192.168.1.50:8083` | No |
| **Hostname** | `http://it-tools.network.lan` | Yes — client DNS must be `lab.hostIp` (Pi-hole) |

With **LAN proxy** on, Caddy listens on host port **80** and routes `http://<label>.<domain>` → the app. Pi-hole (when enabled) maps those names to `lab.hostIp`.

### Port map (IP access)

| Port | Service |
|------|---------|
| **8888** | Control Center |
| **80** | Caddy (hostname routes) |
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
| **5080** | Pi-hole admin (if enabled) |
| **53** tcp/udp | Pi-hole DNS (if enabled) |
| **5432** | Postgres (**localhost only**) |

## LAN DNS (optional, for `*.network.lan`)

1. Set **Host IP** in Settings → Lab.
2. Enable **Pi-hole** (Settings → Lab or Library).
3. Point router/client DNS at that IP.
4. Test: `dig @<hostIp> it-tools.network.lan`

More detail: [pihole/LOCAL-DNS.md](pihole/LOCAL-DNS.md).

## Install apps (after first setup)

**Library UI:** Control Center → **Library** → **Install** (requires Host IP set).

**CLI (contributor checkout):**

```bash
python3 scripts/lab.py install jellyfin
python3 scripts/lab.py install immich
```

Install enables hard `dependsOn`, renders config, starts the stack, and refreshes edge routes when Caddy/Pi-hole are present. Immich prefers shared Redis when available; otherwise it starts sidecar Redis (`docker-compose.immich.redis.yml`).

Recipes: [`catalog/<id>/recipe.json`](catalog/).

## Day-to-day commands (contributor)

```bash
python3 scripts/lab.py start all
python3 scripts/lab.py start jellyfin
python3 scripts/lab.py stop jellyfin
python3 scripts/lab.py render-config
python3 scripts/lab.py refresh-edge
python3 scripts/lab.py update <stack>
```

## Control Center layout

```text
control-center/
  src/                                  # Angular SPA
  src-backend/Modulab.ControlCenter/    # API + SPA host (.NET)
  defaults/                             # tracked dashboard templates
  Dockerfile                            # publishes ghcr.io/.../modulab (API + kit)
```

- Production UI is baked into the image; kit lives at `/opt/modulab` and seeds into `/lab`.
- Local UI dev: `cd control-center && npm start` (proxies `/api` → `:8888`).
- After API changes: `python3 scripts/run_bash.py generate-api.sh`

## Stacks overview

| Stack | Compose file | Role |
|--------|----------------|------|
| **Control Center** | `docker-compose.control-center.yml` / `compose.yaml` | Home UI + install API |
| **Caddy** | `docker-compose.caddy.yml` | Optional `*.domain` reverse proxy |
| **Pi-hole** | `docker-compose.pihole.yml` | Optional LAN DNS |
| **Postgres** | `docker-compose.postgres.yml` | Shared DB |
| **Redis** | `docker-compose.redis.yml` | Optional shared cache |
| **Immich** | `docker-compose.immich.yml` (+ `.immich.redis.yml` sidecar) | Photos |
| Apps | `docker-compose.<name>.yml` | Jellyfin, n8n, Seerr, tools, … |

**Shared Postgres only** — apps get DB names via recipes. Redis may be shared or app-local.

### Local data (state directory / gitignored)

| Path | Used by |
|------|---------|
| `data/` | Runtime volumes |
| `media/` | Jellyfin library |
| `secrets/` | Optional secret files |
| `lab.config.json`, `.env` | Local config |

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Library Install disabled / blocked | Set Host IP under Settings → Lab |
| `*.network.lan` does not resolve | Pi-hole not enabled or client DNS ≠ `lab.hostIp` |
| `http://<ip>/` shows stub text | Caddy on port 80 — use hostname or `http://<ip>:<port>` |
| Immich crash-loops with `corrupted migrations` | Drop/recreate only the `immich` Postgres DB, then reinstall |
| Port 53 conflict | Disable Pi-hole or free host DNS on `lab.hostIp:53` |
| Appliance: compose needs `MODULAB_HOST_ROOT` | Export absolute path to your state directory before `docker compose up` |

## License

MIT — see [LICENSE](LICENSE).
