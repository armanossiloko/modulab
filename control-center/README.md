# Control Center — frontend + backend together (FileVault-style)

```text
control-center/
  src/                                  # Angular SPA
  src-backend/Modulab.ControlCenter/    # .NET 10 API + SPA host
  defaults/                             # tracked dashboard templates
  openapi/                              # OpenAPI document (generated)
  wwwroot/                              # generated (gitignored)
  package.json / angular.json           # frontend toolchain at this root
  Dockerfile                            # multi-stage UI + API image
```

Shell chrome (sidebar) is a separate component — shortcuts are global. Widget boards live in `dashboards[]` (nest via `parentId`) and open at `/d/:id`.

`wwwroot/` is **not** in git. Create it with:

```bash
bash scripts/setup.sh
bash scripts/publish-ui.sh     # optional local SPA publish; Docker builds UI into the image
```

Dev UI: `cd control-center && npm start` (proxies `/api` to :8888).

Open `Modulab.slnx` in Visual Studio.
Regenerate env/edge: `bash scripts/render-config.sh`

## Routes

| Path | View |
|---|---|
| `/` | Home |
| `/library` | Library |
| `/settings` | Settings (General) |
| `/settings/sidebar` | Settings → Sidebar |
| `/settings/widgets` | Settings → Widgets |
| `/settings/layout` | Settings → Layout |

## Configure the UI

Defaults live in **`defaults/dashboard.json`** (seeded into `wwwroot/` on first setup). Edit the runtime file under `wwwroot/dashboard.json`, or use the **Settings** page in Control Center.
