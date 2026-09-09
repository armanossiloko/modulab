# Modulab Control Center UI (Angular 21)

Grafana-style resizable widget grid on a JSON-backed dashboard (`pages[]` in `dashboard.json`).

## Dev

```bash
# After API changes, refresh OpenAPI + HTTP client:
bash scripts/generate-api.sh

# API must be on :8888 (Docker compose control-center)
cd control-center/ui
npm start          # http://localhost:4200 with /api proxy
```

`npm run build` / `prebuild` regenerates `src/app/api/generated` from `../openapi/openapi.json`.

## Publish into wwwroot

```bash
bash scripts/publish-ui.sh
```

Keeps `*.json` under `control-center/wwwroot`. Docker Compose also prefers
`CONTROL_CENTER_ANGULAR_DIST` → `ui/dist/control-center/browser` when that build exists.
