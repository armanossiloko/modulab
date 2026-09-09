# Control Center — UI + API in one directory

```text
control-center/
  wwwroot/                              # static UI + dashboard.json
  src-backend/Modulab.ControlCenter/    # .NET 10 host (serves wwwroot + /api)
  render-services.py
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

Edit **`wwwroot/dashboard.json`** (see `dashboard.example.json` for a full template), or use the **Settings** page in Control Center (saves the same file). Hard-refresh after manual edits.

| Section | What it controls |
|---|---|
| `title` / `theme.accent` | Brand name + accent color |
| `search` | Web search engine URL (`%s` = query) + placeholders |
| `sidebar.bookmarks` | Left-rail link groups — use **Edit shortcuts** to rename, regroup, reorder; **Import…** for browser HTML exports |
| `sidebar.showInstalledApps` | Show/hide installed lab apps under bookmarks |
| `widgets.*` | Enable/disable each widget + titles, weather coords, communities, limits |
| `layout.center` / `layout.right` | Widget order on the home page |

Disable anything you don’t want with `"enabled": false`. Empty `bookmarks: []` removes the hardcoded Web/Tools feel — put only your links.
