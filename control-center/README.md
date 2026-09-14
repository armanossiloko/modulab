# Control Center

Angular SPA + .NET 10 Native AOT API. In production Docker, the SPA is **baked into the image** at `/app/wwwroot`. The host file `wwwroot/dashboard.json` is the editable dashboard (seeded by `scripts/ensure-wwwroot.sh`).

```text
control-center/
  src/                                  # Angular SPA
  src-backend/Modulab.ControlCenter/    # API + SPA host
  defaults/                             # tracked dashboard templates
  wwwroot/                              # host: dashboard.json only (gitignored)
  Dockerfile                            # builds UI + API image
```

## Production

```bash
bash scripts/start.sh control-center
# http://127.0.0.1:8888 (or http://<LAB_HOST_IP>:8888 on the LAN)
```

Compose must keep `CONTROL_CENTER_WWWROOT=/app/wwwroot` so the baked UI is served. Do not point that env at an empty host `wwwroot/`.

## Development

```bash
cd control-center && npm start          # proxies /api → :8888
bash scripts/publish-ui.sh              # optional host dist for local `dotnet run`
bash scripts/generate-api.sh            # after API changes
```

Open **`Modulab.slnx`** for the backend.
