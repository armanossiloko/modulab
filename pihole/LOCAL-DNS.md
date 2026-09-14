# Local names for lab stacks (optional)

Pi-hole is optional. **Control Center** is **http://127.0.0.1:8888**. Set **`caddy.ENABLE_LAN_PROXY=true`** in `lab.config.json` for portless **`http://<label>.<domain>`** URLs on your LAN.

## network.lan URLs (Pi-hole + Caddy)

```bash
bash scripts/render-config.sh
bash scripts/start.sh pihole
bash scripts/start.sh caddy
bash scripts/install.sh jellyfin   # example — repeat per stack
```

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

Set in **`lab.config.json`** (then `bash scripts/render-config.sh`):

| Key | Example | Purpose |
|-----|---------|---------|
| `lab.hostIp` | `192.168.1.10` | LAN IP of the Docker host — DNS names point here; Pi-hole binds `:53` here |
| `lab.domain` | `network.lan` | Private zone suffix |
| `caddy.ENABLE_LAN_PROXY` | `true` | Caddy on port 80 + LAN DNS publish |

DNS host labels come from **catalog recipes** → generated `pihole/dns-hosts.conf` + `docker-compose.pihole.dns.yml` (uses `${LAB_HOST_IP}` / `${PIHOLE_LOCAL_DOMAIN}` from `.env`).

After changing IP, domain, or recipes:

```bash
bash scripts/render-config.sh
bash scripts/start.sh pihole
bash scripts/start.sh caddy
```

### Direct port access (no Caddy)

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

1. Set **`lab.hostIp`** to this machine’s LAN address.
2. Set **`caddy.ENABLE_LAN_PROXY`: true** and render config.
3. Point router DHCP DNS (or each client) at **`lab.hostIp`**.
4. `bash scripts/start.sh pihole` and `bash scripts/start.sh caddy`

Optional per-machine tweaks (firewall, extra ports) can still use gitignored `docker-compose.override.yml`.

## Related

- [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/)
- [README.md](../README.md#port-map-host-bindings)
