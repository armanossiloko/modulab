# Cloudflare Tunnel

Publish a Modulab app on a domain you bought in Cloudflare. The domain is already on Cloudflare nameservers. One connector in [`compose.yaml`](../compose.yaml) serves every app. Each app is a **public hostname** on that same tunnel. After the connector is running, you do not change Compose to add another app.

## 1. Create the tunnel

1. Open [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create a tunnel**.
2. Choose **Cloudflared**.
3. Name it `modulab-800-01`.
4. On the install page, copy only the token (the long value after `--token`). Leave that page open until the connector is **Healthy**.

## 2. Start the connector

On the machine that runs Modulab (the machine that has `compose.yaml`):

```bash
export MODULAB_HOST_ROOT="$HOME/modulab-data"
export CLOUDFLARE_TUNNEL_TOKEN='paste-token-here'
docker compose --profile cloudflare up -d
```

`cloudflared` uses the host network so it can open `127.0.0.1` ports. The tunnel status in the dashboard should switch to **Healthy**.

`docker compose up -d` without `--profile cloudflare` starts Control Center only.

## 3. Publish an app

Install and start the app in Control Center → **Library** first. Then, in the same tunnel, open **Public Hostname** → **Add a public hostname**:

| Field | Value |
|-------|--------|
| Subdomain | A short name, such as `notes` |
| Domain | Your Cloudflare domain |
| Type | **HTTP** |
| URL | `127.0.0.1:<host port>` |

Cloudflare terminates HTTPS and creates the DNS record. The service URL stays plain HTTP on localhost. The public address is `https://<subdomain>.<your-domain>`.

### Example: FUTO Notes

FUTO Notes listens on **http://127.0.0.1:3005** once the container is up.

1. **Public Hostname** → subdomain `notes`, type **HTTP**, URL `127.0.0.1:3005`.
2. Wait until `https://notes.<your-domain>` resolves.
3. In the FUTO Notes app, open **Settings → Self-hosted sync** and set that `https://` URL plus the same sync password you set in Modulab.

Leave this hostname **without** a Cloudflare Access application. The phone and desktop apps call the sync URL themselves and cannot complete a one-time PIN page. The sync password is what locks the server.

## 4. Browser apps (Access)

For a site you open in a browser, add the hostname the same way, then require a login:

1. **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Use the same hostname (`https://home.<your-domain>` for Control Center).
3. Require a login. One-time PIN is enough.

Control Center is subdomain `home`, service URL `127.0.0.1:8888`. Anyone who can open it can install and stop apps, so keep Access on that hostname.

## Hostnames

Use these when the container is running. Service type is always **HTTP**.

| Subdomain | Service | Service URL |
|-----------|---------|-------------|
| `home` | Control Center | `127.0.0.1:8888` |
| `notes` | FUTO Notes | `127.0.0.1:3005` |
| `jellyfin` | Jellyfin | `127.0.0.1:8096` |
| `immich` | Immich | `127.0.0.1:2283` |
| `n8n` | n8n | `127.0.0.1:5678` |
| `seerr` | Seerr | `127.0.0.1:5055` |
| `it-tools` | IT-Tools | `127.0.0.1:8083` |
| `stirling` | Stirling PDF | `127.0.0.1:8082` |
| `bentopdf` | BentoPDF | `127.0.0.1:8084` |
| `picoshare` | PicoShare | `127.0.0.1:4001` |
| `mediacms` | MediaCMS | `127.0.0.1:8088` |
| `searxng` | SearXNG | `127.0.0.1:8080` |
| `pihole` | Pi-hole admin | `127.0.0.1:5080` |

Pi-hole’s admin UI is `https://pihole.<your-domain>/admin`.

Postgres stays on `127.0.0.1:5432`. Do not add a public hostname for it.
