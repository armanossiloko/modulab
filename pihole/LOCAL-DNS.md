# Local names for lab stacks (optional)

Pi-hole is optional. **Control Center** is **http://127.0.0.1:8888**. Set **`caddy.ENABLE_LAN_PROXY=true`** in `lab.config.json` and run Pi-hole only for network.lan URLs on port 80.

Use this when you want portless **`http://<label>.<domain>`** URLs on your LAN.

## network.lan URLs (Pi-hole + Caddy)

```bash
bash scripts/start.sh pihole
bash scripts/start.sh caddy
bash scripts/start.sh jellyfin   # example — repeat per stack
```

| URL | Stack |
|-----|-------|
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

Replace `network.lan` with your **`lab.domain`**. Routes: **`caddy/proxy.caddy`** (requires `caddy.ENABLE_LAN_PROXY=true`).

## Configuration

Set in **`lab.config.json`** (then `bash scripts/render-config.sh`):

| Key | Example | Purpose |
|-----|---------|---------|
| `lab.hostIp` | `192.168.1.10` | LAN IP of the Docker host — all local names point here |
| `lab.domain` | `network.lan` | Private zone suffix |

DNS host labels come from **catalog recipes** → generated `pihole/dns-hosts.conf` + `docker-compose.pihole.dns.yml`.

After changing IP, domain, or recipes:

```bash
bash scripts/render-config.sh
bash scripts/start.sh pihole
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
| `picoshare` | PicoShare | http://127.0.0.1:4001 |
| `immich` | Immich | http://127.0.0.1:2283 |
| `searxng` | SearXNG | http://127.0.0.1:8080 |
| `postgres` | Shared Postgres | `127.0.0.1:5432` |
| `pihole` | Pi-hole admin | http://127.0.0.1:5080/admin |

## LAN DNS

1. Set **`LAB_HOST_IP`** to this machine’s address.
2. On a Pi/homelab, publish port 53 on the LAN via `docker-compose.override.yml` (see below).
3. Point router DHCP DNS at that host.
4. `bash scripts/start.sh pihole`

```yaml
# docker-compose.override.yml (example)
services:
  pihole:
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "127.0.0.1:5080:80/tcp"
```

## Related

- [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/)
- [README.md](../README.md#port-map-host-bindings)
