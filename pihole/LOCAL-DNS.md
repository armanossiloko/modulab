Pi-hole answers **DNS**: hostname → IP. **Caddy** on port **80** removes the need for `:8096`, `:5678`, etc. on every stack.

## All lab URLs

Start Pi-hole and Caddy, then any stacks you use:

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
| http://immich.network.lan | Immich |
| http://odysseus.network.lan | Odysseus |
| http://searxng.network.lan | SearXNG |
| http://ntfy.network.lan | ntfy |
| http://pihole.network.lan/admin | Pi-hole admin |
| `postgres.network.lan:5432` | Shared Postgres (TCP only) |

Replace `network.lan` with your **`PIHOLE_LOCAL_DOMAIN`**. Routes: **`caddy/Caddyfile`**.

## Configuration

Set in **`.env.pihole`** (from `.env.pihole.example`):

| Variable | Example | Purpose |
|----------|---------|---------|
| `LAB_HOST_IP` | `192.168.1.10` | LAN IP of the Docker host — all local names point here |
| `PIHOLE_LOCAL_DOMAIN` | `network.lan` | Private zone suffix |

DNS records are defined in **`docker-compose.pihole.yml`** under `FTLCONF_dns_hosts` (substituted at container start). Keep **`pihole/dns-hosts.conf`** in sync — same host labels, one per line.

After changing IP, domain, or host list:

```bash
bash scripts/start.sh pihole
```

### Direct port access (without Caddy)

| Label | Stack / service | URL |
|-------|-----------------|-----|
| `jellyfin` | Jellyfin | http://jellyfin.network.lan:8096 |
| `n8n` | n8n | http://n8n.network.lan:5678 |
| `seerr` | Seerr | http://seerr.network.lan:5055 |
| `it-tools` | IT-Tools | http://it-tools.network.lan:8083 |
| `stirling` | Stirling PDF | http://stirling.network.lan:8082 |
| `immich` | Immich | http://immich.network.lan:2283 |
| `odysseus` | Odysseus UI | http://odysseus.network.lan:7000 |
| `searxng` | Odysseus SearXNG | http://searxng.network.lan:8080 |
| `ntfy` | Odysseus ntfy | http://ntfy.network.lan:8091 |
| `postgres` | Shared Postgres | `postgres.network.lan:5432` |
| `pihole` | Pi-hole admin | http://pihole.network.lan:5080/admin |

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

## Loopback-only stacks

n8n, Immich, Postgres, etc. bind `127.0.0.1` by default. **Caddy uses host network** and reaches them on localhost. LAN clients still need Pi-hole DNS and a reachable host (Caddy on `:80` is on all interfaces via host network).

## Related

- [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/)
- [README.md](../README.md#port-map-host-bindings)
