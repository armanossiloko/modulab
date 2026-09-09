# Control Center — UI + API in one directory

```text
control-center/
  ui/                                   # Angular 21 SPA source
  defaults/                             # tracked dashboard templates
  wwwroot/                              # generated (gitignored) — dashboard + published assets
  src-backend/Modulab.ControlCenter/    # .NET 10 host (serves SPA + /api)
  render-services.py                    # → wwwroot/services.json
```

`wwwroot/` is **not** in git. Create it with:

```bash
bash scripts/setup.sh          # or: bash scripts/ensure-wwwroot.sh
bash scripts/publish-ui.sh     # optional local SPA publish; Docker builds UI into the image
```

Open `Modulab.slnx` in Visual Studio.
Regenerate services: `bash scripts/render-config.sh`

## Routes

| Path | View |
|---|---|
| `/` | Home |
| `/library` | Library |
| `/settings` | Settings (General) |
| `/settings/sidebar` | Settings → Sidebar |
| `/settings/widgets` | Settings → Widgets |
| `/settings/layout` | Settings → Layout |

Deep links are served by the SPA fallback (`index.html`).

## Configure the UI

Defaults live in **`defaults/dashboard.json`** (seeded into `wwwroot/` on first setup). Edit the runtime file under `wwwroot/dashboard.json`, or use the **Settings** page in Control Center. Hard-refresh after manual edits.

| Section | What it controls |
|---|---|
| `title` / `theme.accent` | Brand name + accent color |
| `search` | Web search engine URL (`%s` = query) + placeholders |
| `sidebar.bookmarks` | Left-rail link groups — use **Edit shortcuts** to rename, regroup, reorder; **Import…** for browser HTML exports |
| `sidebar.showInstalledApps` | Show/hide installed lab apps under bookmarks |
| `widgets.*` | Enable/disable each widget + titles, weather coords, communities, limits |
| `layout.center` / `layout.right` | Widget order on the home page |

Disable anything you don’t want with `"enabled": false`. Empty `bookmarks: []` removes the hardcoded Web/Tools feel — put only your links.
