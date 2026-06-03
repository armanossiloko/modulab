# Local names for lab stacks (Pi-hole)

Pi-hole answers **DNS**: it turns a hostname into an IP address. It does **not** route HTTP paths like `/jellyfin` on a single site—that needs a **reverse proxy** (Caddy, nginx, Traefik).

Pick one pattern:

| Pattern | Example | Pi-hole | Also need |
|---------|---------|---------|-----------|
| **Subdomain** (recommended) | `http://jellyfin.network.lan:8096` | A record `jellyfin.network.lan` → `192.168.1.10` | Port in URL, unless you add a proxy |
| **Subdomain + proxy** | `http://jellyfin.network.lan` | Same A record (or CNAME to host) | Reverse proxy on `:80`/`:443` |
| **Path on one hostname** | `http://network.lan/jellyfin` | A record `network.lan` → proxy host | Reverse proxy with path rules |

Below uses **`network.lan`** as your private zone and **`192.168.1.10`** as the machine running Docker (replace with your Pi/homelab IP).

## 1. Make Pi-hole your LAN DNS

On the host that runs Pi-hole (often your Raspberry Pi):

1. Publish DNS on the LAN — in `docker-compose.override.yml` at the repo root:

   ```yaml
   services:
     pihole:
       ports:
         - "53:53/tcp"
         - "53:53/udp"
         - "127.0.0.1:5080:80/tcp"
   ```

2. Start Pi-hole: `bash scripts/up-pihole.sh`

3. Router **DHCP DNS** → `192.168.1.10` (your Pi-hole host IP), or set DNS manually on each device.

Clients must use Pi-hole for lookups; otherwise local names will not resolve.

## 2. Add local DNS records (Pi-hole admin)

1. Open http://192.168.1.10:5080/admin (or your Pi-hole admin URL).
2. **Local DNS** → **DNS Records** (Pi-hole v6).
3. Add an **A** record per service (domain → IP of the Docker host):

   | Domain | IP | Opens (with default modulab ports) |
   |--------|-----|-------------------------------------|
   | `jellyfin.network.lan` | `192.168.1.10` | http://jellyfin.network.lan:8096 |
   | `n8n.network.lan` | `192.168.1.10` | http://n8n.network.lan:5678 |
   | `seerr.network.lan` | `192.168.1.10` | http://seerr.network.lan:5055 |
   | `immich.network.lan` | `192.168.1.10` | http://immich.network.lan:2283 |
   | `odysseus.network.lan` | `192.168.1.10` | http://odysseus.network.lan:7000 |
   | `it-tools.network.lan` | `192.168.1.10` | http://it-tools.network.lan:8083 |
   | `stirling.network.lan` | `192.168.1.10` | http://stirling.network.lan:8082 |

   Optional apex record for a future reverse proxy:

   | Domain | IP |
   |--------|-----|
   | `network.lan` | `192.168.1.10` |

4. Save. Test from a LAN client:

   ```bash
   nslookup jellyfin.network.lan
   # should return 192.168.1.10
   ```

Records persist under `data/pihole/etc-pihole/` (gitignored).

### Example: Jellyfin only

1. Jellyfin compose publishes **8096** on all interfaces (`docker-compose.jellyfin.yml`).
2. Pi-hole: `jellyfin.network.lan` → `192.168.1.10`.
3. Browser: **http://jellyfin.network.lan:8096**

## 3. LAN access vs loopback-only stacks

Several modulab stacks bind **127.0.0.1** only (n8n, Immich, Postgres, etc.). DNS can point to the host IP, but **other devices on the LAN still cannot reach those ports** until you publish them on the host.

For LAN use, change the compose port mapping, e.g. n8n:

```yaml
ports:
  - "5678:5678"   # was 127.0.0.1:5678:5678
```

Or bind a specific LAN IP: `"192.168.1.10:5678:5678"`.

Use `docker-compose.override.yml` on the Pi so you do not have to edit tracked compose files.

## 4. Pretty URLs without `:8096` (reverse proxy)

To open **http://jellyfin.network.lan** with no port (or **http://network.lan/jellyfin**), run a reverse proxy on the same host listening on **80** / **443**.

Minimal **Caddy** idea (not included in this repo):

```text
jellyfin.network.lan {
    reverse_proxy 127.0.0.1:8096
}

n8n.network.lan {
    reverse_proxy 127.0.0.1:5678
}
```

Path-based on one hostname:

```text
network.lan {
    handle_path /jellyfin/* {
        reverse_proxy 127.0.0.1:8096
    }
    handle_path /n8n/* {
        reverse_proxy 127.0.0.1:5678
    }
}
```

Pi-hole still only provides **`network.lan` → 192.168.1.10**; Caddy does the `/jellyfin` routing.

Some apps (n8n, Immich) also need **`WEBHOOK_URL` / `ROOT_URL`** updated to the public hostname when behind a proxy.

## 5. Optional: records via env (Git-friendly)

For a small set of names you can version in git, add to `docker-compose.pihole.yml` (comma-separated `IP hostname` pairs):

```yaml
environment:
  FTLCONF_dns_hosts: |-
    192.168.1.10 jellyfin.network.lan
    192.168.1.10 n8n.network.lan
```

Env-defined settings are **read-only** in the Pi-hole UI until removed from compose. Prefer the UI or `FTLCONF_dns_hosts` for one source of truth, not both fighting each other.

## Related

- [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/)
- Modulab port map: [README.md](../README.md#port-map-host-bindings)
