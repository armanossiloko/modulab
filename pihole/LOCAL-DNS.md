# Local names for lab stacks (optional)

**Pi-hole is optional.** Enable it from Control Center → **Settings → Lab** (or Library), or `python3 scripts/lab.py install pihole`.

Control Center is **http://127.0.0.1:8888**. Set **`caddy.ENABLE_LAN_PROXY=true`** (default) for portless **`http://<label>.<domain>`** URLs on your LAN. Hostname URLs also need Pi-hole (or another DNS) pointing clients at `lab.hostIp`.

## network.lan URLs (Pi-hole + Caddy)

```bash
python3 scripts/lab.py render-config
python3 scripts/lab.py start pihole
python3 scripts/lab.py start caddy
python3 scripts/lab.py install jellyfin   # example
```

Or appliance users: Settings → Lab → enable Pi-hole, then Library → Install.

With **`ENABLE_LAN_PROXY=true`**, start scripts automatically:

- Publish **Pi-hole DNS** on **`lab.hostIp:53`** (avoids clashing with systemd-resolved on `127.0.0.53`)
- Run **Caddy** in **host network** mode on port **80**, proxying to apps on `127.0.0.1:<port>`

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
| `postgres.network.lan:5432` | Shared Postgres (TCP only) |

Replace `network.lan` with your **`lab.domain`**. Routes: **`caddy/proxy.caddy`**.

## Configuration

Set in **Settings → Lab** or **`lab.config.json`** (then `python3 scripts/lab.py render-config`):

| Key | Example | Purpose |
|-----|---------|---------|
| `lab.hostIp` | `192.168.1.50` | LAN IP of the Docker host — DNS names point here; Pi-hole binds `:53` here |
| `lab.domain` | `network.lan` | Private zone suffix |
| `caddy.ENABLE_LAN_PROXY` | `true` | Caddy on port 80 + LAN DNS publish |

DNS host labels come from **catalog recipes** → generated `pihole/dns-hosts.conf` + `docker-compose.pihole.dns.yml` (uses `${MODULAB_HOST_IP}` / `${PIHOLE_LOCAL_DOMAIN}` from `.env`).

After changing IP, domain, or recipes:

```bash
python3 scripts/lab.py render-config
python3 scripts/lab.py start pihole
python3 scripts/lab.py start caddy
```

### Direct port access (no Caddy / no Pi-hole)

| Label | Stack / service | URL |
|-------|-----------------|-----|
| `jellyfin` | Jellyfin | http://127.0.0.1:8096 |
| `n8n` | n8n | http://127.0.0.1:5678 |
| `seerr` | Seerr | http://127.0.0.1:5055 |
| `it-tools` | IT-Tools | http://127.0.0.1:8083 |
| `stirling` | Stirling PDF | http://127.0.0.1:8082 |
| `bentopdf` | BentoPDF | http://127.0.0.1:8084 |
| `immich` | Immich | http://127.0.0.1:2283 |
| `searxng` | SearXNG | http://127.0.0.1:8080 |
| `postgres` | Shared Postgres | `127.0.0.1:5432` |
| `pihole` | Pi-hole admin | http://127.0.0.1:5080/admin |

## LAN DNS

1. Set **`lab.hostIp`** (Settings → Lab).
2. Enable Pi-hole and keep **`caddy.ENABLE_LAN_PROXY`: true**.
3. Point router DHCP DNS (or each client) at **`lab.hostIp`**.
4. Start Pi-hole + Caddy if not already running.

Optional per-machine tweaks (firewall, extra ports) can still use gitignored `docker-compose.override.yml`.
