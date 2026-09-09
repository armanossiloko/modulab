const sidebarCategories = document.getElementById("sidebar-categories");
const centerWidgets = document.getElementById("center-widgets");
const rightRail = document.getElementById("right-rail");
const searchInput = document.getElementById("search");
const refreshBtn = document.getElementById("refresh");
const railFoot = document.getElementById("rail-foot");
const brandName = document.getElementById("brand-name");

const CATEGORY_ORDER = ["productivity", "media", "tools", "infrastructure", "other"];
const CATEGORY_LABELS = {
  productivity: "Productivity",
  media: "Media",
  tools: "Tools",
  infrastructure: "Infrastructure",
  other: "Other",
};
/** Legacy token → hex (bookmark group titles used to use category names). */
const BOOKMARK_COLOR_PRESETS = {
  productivity: "#5b9bd9",
  media: "#e88a4a",
  tools: "#39b98a",
  infrastructure: "#b388c9",
  other: "#7a7a85",
};

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/i.test(value.trim());
}

function resolveBookmarkColor(value) {
  if (isHexColor(value)) return value.trim().toLowerCase();
  if (value && BOOKMARK_COLOR_PRESETS[value]) return BOOKMARK_COLOR_PRESETS[value];
  return BOOKMARK_COLOR_PRESETS.other;
}

const SERVICE_ICONS = {
  jellyfin: { domain: "jellyfin.org", letter: "JF", color: "#00a4dc" },
  n8n: { domain: "n8n.io", letter: "N8", color: "#ea4b71" },
  seerr: { domain: "seerr.dev", letter: "SE", color: "#5b6abf" },
  immich: { domain: "immich.app", letter: "IM", color: "#4250af" },
  odysseus: { letter: "OD", color: "#6b7280" },
  "control-center": { letter: "CC", color: "#d9a441" },
  "stirling-pdf": { domain: "stirlingpdf.com", letter: "SP", color: "#e74c3c" },
  bentopdf: { letter: "BP", color: "#3498db" },
  "it-tools": { domain: "it-tools.tech", letter: "IT", color: "#18b26b" },
  picoshare: { letter: "PS", color: "#d9a441" },
  "futo-notes": { letter: "FN", color: "#2f6fed" },
  notes: { letter: "FN", color: "#2f6fed" },
  searxng: { domain: "searxng.org", letter: "SX", color: "#3050ff" },
  ntfy: { domain: "ntfy.sh", letter: "NT", color: "#317f43" },
  pihole: { domain: "pi-hole.net", letter: "PH", color: "#960060" },
  postgres: { letter: "PG", color: "#336791" },
  redis: { letter: "RD", color: "#c6302b" },
  caddy: { letter: "CA", color: "#1f9a5b" },
};

const CENTER_WIDGET_IDS = ["stacks", "community", "hackerNews", "media"];
const RIGHT_WIDGET_IDS = [
  "clock", "weather", "yearProgress", "stackUsage", "network", "nowRunning", "calendar",
];

const DEFAULT_DASHBOARD = {
  title: "Modulab",
  search: {
    engine: "https://duckduckgo.com/?q=%s",
    placeholder: "Search stacks or the web…",
    libraryPlaceholder: "Filter library…",
  },
  theme: { accent: "#d9a441" },
  sidebar: { showInstalledApps: true, bookmarks: [] },
  widgets: {
    stacks: { enabled: true, title: "Lab stacks" },
    community: { enabled: true, title: "Community", communities: [], limit: 6 },
    hackerNews: { enabled: true, title: "Hacker News", limit: 8 },
    media: { enabled: true, title: "Media", emptyHint: "Install a media app from the Library." },
    clock: { enabled: true },
    weather: { enabled: false, title: "Weather", label: "", latitude: null, longitude: null },
    yearProgress: { enabled: true, title: "Year progress" },
    stackUsage: { enabled: true, title: "Stack usage" },
    network: { enabled: true, title: "Network" },
    nowRunning: { enabled: true, title: "Now running" },
    calendar: { enabled: true },
  },
  layout: {
    center: [...CENTER_WIDGET_IDS],
    right: [...RIGHT_WIDGET_IDS],
  },
};

let allServices = [];
let runningServices = [];
let catalogApps = [];
let dashboard = structuredClone(DEFAULT_DASHBOARD);
let activeView = "home";
let activeFeedTab = "all";
let activeCommunity = "";
let probeTimes = new Map();
let installTarget = null;
let feedCache = { community: null, hn: null, weather: null };
let ui = {};
let settingsDraft = null;
let settingsDirty = false;
let settingsSection = "general";
let settingsStatus = { text: "", kind: "" };
let routingReady = false;

const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "sidebar", label: "Sidebar" },
  { id: "widgets", label: "Widgets" },
  { id: "layout", label: "Layout" },
];

const SETTINGS_SECTION_IDS = new Set(SETTINGS_SECTIONS.map((s) => s.id));
const APP_VIEWS = new Set(["home", "library", "settings"]);

const WIDGET_LABELS = {
  stacks: "Lab stacks",
  community: "Community feeds",
  hackerNews: "Hacker News",
  media: "Media",
  clock: "Clock",
  weather: "Weather",
  yearProgress: "Year progress",
  stackUsage: "Stack usage",
  network: "Network",
  nowRunning: "Now running",
  calendar: "Calendar",
};

const API_KEY_STORAGE = "modulab.controlCenterApiKey";

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return overlay ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "_comment") continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeDashboard(raw) {
  const merged = deepMerge(structuredClone(DEFAULT_DASHBOARD), raw || {});

  // Back-compat for older dashboard.json shapes
  if (Array.isArray(raw?.bookmarks) && !raw?.sidebar?.bookmarks) {
    merged.sidebar.bookmarks = raw.bookmarks;
  }
  if (Array.isArray(raw?.reddit) && raw.reddit.length && !raw?.widgets?.community?.communities) {
    merged.widgets.community.communities = raw.reddit;
    merged.widgets.community.enabled = true;
  }
  if (raw?.weather && !raw?.widgets?.weather) {
    merged.widgets.weather = {
      ...merged.widgets.weather,
      ...raw.weather,
      enabled: raw.weather.enabled !== false,
    };
  }
  if (typeof raw?.searchEngine === "string") {
    merged.search.engine = raw.searchEngine;
  }

  if (!Array.isArray(merged.sidebar.bookmarks)) merged.sidebar.bookmarks = [];
  merged.sidebar.bookmarks = merged.sidebar.bookmarks.map((group) => {
    if (!group || typeof group !== "object") return group;
    return { ...group, color: resolveBookmarkColor(group.color) };
  });
  if (!Array.isArray(merged.widgets.community.communities)) merged.widgets.community.communities = [];
  if (!Array.isArray(merged.layout.center) || !merged.layout.center.length) {
    merged.layout.center = [...CENTER_WIDGET_IDS];
  }
  if (!Array.isArray(merged.layout.right) || !merged.layout.right.length) {
    merged.layout.right = [...RIGHT_WIDGET_IDS];
  }

  const weather = merged.widgets.weather;
  if (
    weather.enabled &&
    (weather.latitude == null || weather.longitude == null || Number.isNaN(Number(weather.latitude)))
  ) {
    weather.enabled = false;
  }

  return merged;
}

function widgetCfg(id) {
  return dashboard.widgets?.[id] || DEFAULT_DASHBOARD.widgets[id] || { enabled: false };
}

function widgetOn(id) {
  return widgetCfg(id).enabled !== false;
}

function applyTheme() {
  const accent = dashboard.theme?.accent || DEFAULT_DASHBOARD.theme.accent;
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-soft", `${accent}29`);
  const title = dashboard.title || "Modulab";
  if (brandName) brandName.textContent = title;
  document.title = `${title} · Control Center`;
  syncDocumentTitle();
}

function communities() {
  return (widgetCfg("community").communities || []).filter(Boolean);
}

function serviceUrl(service) {
  const host = service.host || "127.0.0.1";
  const path = service.path || "";
  return `http://${host}:${service.port}${path}`;
}

function serviceHaystack(service) {
  return [service.name, service.label, service.description, String(service.port), serviceUrl(service)]
    .join(" ")
    .toLowerCase();
}

function matchesQuery(service, query) {
  if (!query) return true;
  return serviceHaystack(service).includes(query.toLowerCase());
}

function isInstalled(service) {
  if (service.core === true) return true;
  const app = catalogApps.find((a) => a.id === (service.label || service.id));
  if (app) {
    return app.status === "running" || app.status === "stopped" || app.status === "installed"
      || app.status === "removed" || app.running === true || app.enabled === true;
  }
  return service.enabled === true;
}

function installedServices() {
  return allServices.filter(isInstalled);
}

function iconMeta(service) {
  const label = service.label || service.id || "";
  return SERVICE_ICONS[label] || {
    letter: (service.name || label || "?").slice(0, 2).toUpperCase(),
    color: "#4b5563",
  };
}

function iconHtml(service, className = "app-icon") {
  const meta = iconMeta(service);
  if (meta.domain) {
    return `<img class="${className}" src="https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64" alt="" loading="lazy" onerror="this.outerHTML='<span class=\\'${className} app-icon-fallback\\' style=\\'background:${meta.color}\\'>${meta.letter}</span>'">`;
  }
  return `<span class="${className} app-icon-fallback" style="background:${meta.color}">${meta.letter}</span>`;
}

function favicon(domain, className = "app-icon") {
  if (!domain) return `<span class="${className} app-icon-fallback" style="background:#4b5563">•</span>`;
  return `<img class="${className}" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64" alt="" loading="lazy">`;
}

function externalArrow(cls = "app-link-arrow") {
  return `<svg class="${cls}" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>`;
}

async function probe(service) {
  if (!service.port) return false;
  const url = serviceUrl(service);
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(url, { mode: "no-cors", signal: controller.signal, cache: "no-store" });
    probeTimes.set(service.label, Math.round(performance.now() - start));
    return true;
  } catch {
    probeTimes.delete(service.label);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function groupByCategory(services) {
  const groups = new Map();
  for (const service of services) {
    const category = service.category || "other";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(service);
  }
  return groups;
}

function filteredServices(pool) {
  const query = searchInput.value.trim();
  return pool.filter((s) => matchesQuery(s, query));
}

function isUp(service) {
  return runningServices.some((s) => s.label === service.label);
}

function openWebSearch(query) {
  const engine = dashboard.search?.engine || DEFAULT_DASHBOARD.search.engine;
  const url = engine.replace("%s", encodeURIComponent(query));
  window.open(url, "_blank", "noopener,noreferrer");
}

function apiHeaders(extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  const key = sessionStorage.getItem(API_KEY_STORAGE) || "";
  if (key) headers["X-Lab-Key"] = key;
  return headers;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: apiHeaders(options.headers || {}),
  });
  if (response.status === 401) {
    const key = window.prompt("Control Center API key (lab.controlCenterApiKey)");
    if (key) {
      sessionStorage.setItem(API_KEY_STORAGE, key);
      return apiFetch(path, options);
    }
  }
  const data = await response.json().catch(() => ({ message: response.statusText }));
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function appendBookmarkGroups(container) {
  const groups = Array.isArray(dashboard.sidebar?.bookmarks) ? dashboard.sidebar.bookmarks : [];
  for (const group of groups) {
    if (group.enabled === false) continue;
    const links = Array.isArray(group.links) ? group.links.filter((l) => l && l.enabled !== false) : [];
    if (!links.length) continue;
    const block = document.createElement("section");
    block.className = "category-block";
    const title = document.createElement("h2");
    title.className = "category-title";
    title.style.color = resolveBookmarkColor(group.color);
    title.textContent = group.title || "Bookmarks";
    block.appendChild(title);
    for (const link of links) {
      const a = document.createElement("a");
      a.className = "app-link";
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const domain = link.domain || (() => {
        try { return new URL(link.url).hostname; } catch { return ""; }
      })();
      a.innerHTML = `
        ${favicon(domain, "app-icon bookmark-link-icon")}
        <span class="app-link-text">${link.title || link.url}</span>
        ${externalArrow()}
      `;
      block.appendChild(a);
    }
    container.appendChild(block);
  }
}

function renderSidebar() {
  sidebarCategories.replaceChildren();
  appendBookmarkGroups(sidebarCategories);

  const showApps = dashboard.sidebar?.showInstalledApps !== false;
  const pool = showApps
    ? filteredServices(installedServices()).filter((s) => (s.label || s.id) !== "control-center")
    : [];
  const groups = groupByCategory(pool);

  for (const category of CATEGORY_ORDER) {
    const items = (groups.get(category) || []).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) continue;

    const block = document.createElement("section");
    block.className = "category-block";
    const title = document.createElement("h2");
    title.className = `category-title category-title--${category}`;
    title.textContent = CATEGORY_LABELS[category] || category;
    block.appendChild(title);

    for (const service of items) {
      const up = isUp(service);
      const link = document.createElement("a");
      link.className = `app-link${up ? "" : " is-dim"}`;
      link.href = service.port ? serviceUrl(service) : "#";
      if (!service.port) link.addEventListener("click", (e) => e.preventDefault());
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML = `
        ${iconHtml(service)}
        <span class="app-link-text">${service.name}</span>
        ${service.port ? externalArrow() : ""}
      `;
      block.appendChild(link);
    }
    sidebarCategories.appendChild(block);
  }

  const bookmarkCount = (dashboard.sidebar?.bookmarks || []).length;
  if (!pool.length && !bookmarkCount) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.innerHTML = `Nothing here yet.<br><a href="/settings/sidebar" data-go-settings>Open Settings</a> or <a href="/library" data-go-library>Library</a>`;
    note.querySelector("[data-go-settings]")?.addEventListener("click", (event) => goSettings("sidebar", event));
    note.querySelector("[data-go-library]")?.addEventListener("click", goLibrary);
    sidebarCategories.appendChild(note);
  }

  const installed = installedServices();
  railFoot.textContent = `${installed.filter(isUp).length} online · ${installed.length} installed`;
}

function renderStacksWidget() {
  const cfg = widgetCfg("stacks");
  const widget = document.createElement("article");
  widget.className = "widget";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">${cfg.title || "Lab stacks"}</span></div>`;

  const installed = installedServices();
  const categories = ["all", ...CATEGORY_ORDER.filter((c) =>
    installed.some((s) => (s.category || "other") === c)
  )];

  const tabs = document.createElement("div");
  tabs.className = "widget-tabs";
  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `widget-tab${activeFeedTab === cat ? " is-active" : ""}`;
    btn.textContent = cat === "all" ? "ALL" : (CATEGORY_LABELS[cat] || cat).toUpperCase();
    btn.addEventListener("click", () => {
      activeFeedTab = cat;
      renderCenter();
    });
    tabs.appendChild(btn);
  }
  widget.appendChild(tabs);

  const list = document.createElement("ul");
  list.className = "feed-list";

  let items = filteredServices(installed);
  if (activeFeedTab !== "all") {
    items = items.filter((s) => (s.category || "other") === activeFeedTab);
  }
  items.sort((a, b) => (isUp(a) ? 0 : 1) - (isUp(b) ? 0 : 1) || a.name.localeCompare(b.name));

  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    if (!installed.length) {
      li.innerHTML = `No apps installed. <a href="/library">Browse the Library</a>`;
      li.querySelector("a[href='/library']")?.addEventListener("click", goLibrary);
    } else {
      li.textContent = "No matches.";
    }
    list.appendChild(li);
  } else {
    for (const service of items) {
      const up = isUp(service);
      const ms = probeTimes.get(service.label);
      const li = document.createElement("li");
      li.className = "feed-item";
      const href = service.port ? serviceUrl(service) : "#";
      li.innerHTML = `
        <div class="feed-thumb">${iconHtml(service)}</div>
        <div>
          <p class="feed-title">${
            service.port
              ? `<a href="${href}" target="_blank" rel="noopener">${service.name}</a>`
              : service.name
          }</p>
          <p class="feed-meta">${service.description || ""}${service.port ? ` · :${service.port}` : ""}${ms != null ? ` · ${ms}ms` : ""}</p>
        </div>
        <span class="feed-status ${up ? "is-up" : "is-down"}">${up ? "Live" : "Off"}</span>
      `;
      list.appendChild(li);
    }
  }

  widget.appendChild(list);
  return widget;
}

function renderPostList(items, { plain = false } = {}) {
  const list = document.createElement("ul");
  list.className = "post-list";
  if (!items?.length) {
    list.innerHTML = `<li class="empty-note">Nothing to show right now.</li>`;
    return list;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.className = `post-item${plain || !item.thumb ? " post-item--plain" : ""}`;
    const thumb = !plain && item.thumb
      ? `<img class="post-thumb" src="${item.thumb}" alt="" loading="lazy" onerror="this.remove()">`
      : "";
    li.innerHTML = `
      ${thumb}
      <div>
        <p class="post-title"><a href="${item.url}" target="_blank" rel="noopener">${item.title}</a></p>
        <p class="post-meta">${item.meta || ""}</p>
      </div>
    `;
    list.appendChild(li);
  }
  return list;
}

function renderCommunityWidget() {
  const cfg = widgetCfg("community");
  const widget = document.createElement("article");
  widget.className = "widget";
  const subs = communities();
  if (!activeCommunity || !subs.includes(activeCommunity)) activeCommunity = subs[0] || "";

  const head = document.createElement("div");
  head.className = "widget-head";
  head.innerHTML = `<span class="widget-title">${cfg.title || "Community"}</span>`;
  widget.appendChild(head);

  if (!subs.length) {
    widget.appendChild(Object.assign(document.createElement("p"), {
      className: "empty-note",
      textContent: "Add communities in dashboard.json → widgets.community.communities",
    }));
    return widget;
  }

  const tabs = document.createElement("div");
  tabs.className = "widget-tabs";
  for (const sub of subs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `widget-tab${activeCommunity === sub ? " is-active" : ""}`;
    btn.textContent = sub.toUpperCase();
    btn.addEventListener("click", async () => {
      activeCommunity = sub;
      feedCache.community = null;
      await loadCommunityFeed(true);
      renderCenter();
    });
    tabs.appendChild(btn);
  }
  widget.appendChild(tabs);

  if (!feedCache.community) {
    widget.appendChild(Object.assign(document.createElement("p"), {
      className: "empty-note",
      textContent: "Loading feed…",
    }));
  } else if (feedCache.community.error) {
    widget.appendChild(Object.assign(document.createElement("p"), {
      className: "empty-note",
      textContent: feedCache.community.error,
    }));
  } else {
    widget.appendChild(renderPostList(feedCache.community.items || []));
  }
  return widget;
}

function renderHnWidget() {
  const cfg = widgetCfg("hackerNews");
  const widget = document.createElement("article");
  widget.className = "widget";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">${cfg.title || "Hacker News"}</span></div>`;
  if (!feedCache.hn) {
    widget.appendChild(Object.assign(document.createElement("p"), {
      className: "empty-note",
      textContent: "Loading feed…",
    }));
  } else if (feedCache.hn.error) {
    widget.appendChild(Object.assign(document.createElement("p"), {
      className: "empty-note",
      textContent: feedCache.hn.error,
    }));
  } else {
    widget.appendChild(renderPostList(feedCache.hn.items || [], { plain: true }));
  }
  return widget;
}

function renderMediaWidget() {
  const cfg = widgetCfg("media");
  const media = installedServices().filter((s) => s.category === "media");
  const widget = document.createElement("article");
  widget.className = "widget";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">${cfg.title || "Media"}</span></div>`;
  if (!media.length) {
    widget.innerHTML += `<p class="empty-note">${cfg.emptyHint || "Install a media app from the Library."}</p>`;
    return widget;
  }
  const list = document.createElement("ul");
  list.className = "feed-list";
  for (const service of media) {
    const up = isUp(service);
    const li = document.createElement("li");
    li.className = "feed-item";
    li.innerHTML = `
      <div class="feed-thumb">${iconHtml(service)}</div>
      <div>
        <p class="feed-title"><a href="${serviceUrl(service)}" target="_blank" rel="noopener">${service.name}</a></p>
        <p class="feed-meta">${service.description || ""}</p>
      </div>
      <span class="feed-status ${up ? "is-up" : "is-down"}">${up ? "Live" : "Off"}</span>
    `;
    list.appendChild(li);
  }
  widget.appendChild(list);
  return widget;
}

function renderCalendar() {
  if (!ui.calendarRoot) return;
  ui.calendarRoot.replaceChildren();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = now.toLocaleDateString([], { month: "long", year: "numeric" });

  const head = document.createElement("div");
  head.className = "calendar-head";
  head.innerHTML = `<span class="calendar-month">${monthName}</span>`;
  ui.calendarRoot.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  for (const dow of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
    const el = document.createElement("span");
    el.className = "calendar-dow";
    el.textContent = dow;
    grid.appendChild(el);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("span");
    el.className = "calendar-day is-other";
    grid.appendChild(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement("span");
    el.className = `calendar-day${d === today ? " is-today" : ""}`;
    el.textContent = String(d);
    grid.appendChild(el);
  }
  ui.calendarRoot.appendChild(grid);
}

function updateClock() {
  if (!ui.clockTime || !ui.clockDate) return;
  const now = new Date();
  ui.clockTime.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ui.clockDate.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function renderWeather() {
  if (!ui.weatherBody) return;
  const weather = feedCache.weather;
  if (!weather) {
    ui.weatherBody.innerHTML = `<p class="widget-caption">Loading…</p>`;
    return;
  }
  if (weather.error) {
    if (ui.weatherPlace) ui.weatherPlace.textContent = "";
    ui.weatherBody.innerHTML = `<p class="widget-caption">${weather.error}</p>`;
    return;
  }
  if (ui.weatherPlace) ui.weatherPlace.textContent = weather.label || "";
  ui.weatherBody.innerHTML = `
    <p class="weather-temp">${Math.round(weather.temperatureC)}°</p>
    <p class="weather-summary">${weather.summary || ""}</p>
    <p class="weather-meta">Wind ${Math.round(weather.windKmh)} km/h · Humidity ${weather.humidity}%</p>
  `;
}

function buildRightWidget(id) {
  const cfg = widgetCfg(id);
  const article = document.createElement("article");
  article.className = "widget";
  article.dataset.widget = id;

  if (id === "clock") {
    article.classList.add("widget--clock");
    article.innerHTML = `
      <p id="clock-time" class="clock-time">—</p>
      <p id="clock-date" class="clock-date">—</p>
    `;
    return article;
  }
  if (id === "weather") {
    article.innerHTML = `
      <div class="widget-head">
        <span class="widget-title">${cfg.title || "Weather"}</span>
        <span id="weather-place" class="widget-badge"></span>
      </div>
      <div id="weather-body" class="weather-body"><p class="widget-caption">Loading…</p></div>
    `;
    return article;
  }
  if (id === "yearProgress") {
    article.innerHTML = `
      <div class="widget-head">
        <span class="widget-title">${cfg.title || "Year progress"}</span>
        <span id="year-pct" class="widget-badge"></span>
      </div>
      <div class="progress"><div id="year-bar" class="progress-fill"></div></div>
      <p id="year-label" class="widget-caption"></p>
    `;
    return article;
  }
  if (id === "stackUsage") {
    article.innerHTML = `
      <div class="widget-head"><span class="widget-title">${cfg.title || "Stack usage"}</span></div>
      <div class="storage-labels">
        <span id="storage-used-label">USED —</span>
        <span id="storage-left-label">— LEFT</span>
      </div>
      <div class="progress progress--thick"><div id="storage-bar" class="progress-fill progress-fill--warm"></div></div>
      <p id="storage-caption" class="widget-caption"></p>
    `;
    return article;
  }
  if (id === "network") {
    article.innerHTML = `
      <div class="widget-head"><span class="widget-title">${cfg.title || "Network"}</span></div>
      <div id="network-stats" class="network-stats"></div>
    `;
    return article;
  }
  if (id === "nowRunning") {
    article.innerHTML = `
      <div class="widget-head"><span class="widget-title">${cfg.title || "Now running"}</span></div>
      <div id="now-playing" class="now-playing"></div>
    `;
    return article;
  }
  if (id === "calendar") {
    article.classList.add("widget--calendar");
    article.innerHTML = `<div id="calendar-root"></div>`;
    return article;
  }
  return null;
}

function refreshUiRefs() {
  ui = {
    clockTime: document.getElementById("clock-time"),
    clockDate: document.getElementById("clock-date"),
    weatherPlace: document.getElementById("weather-place"),
    weatherBody: document.getElementById("weather-body"),
    yearPct: document.getElementById("year-pct"),
    yearBar: document.getElementById("year-bar"),
    yearLabel: document.getElementById("year-label"),
    storageUsedLabel: document.getElementById("storage-used-label"),
    storageLeftLabel: document.getElementById("storage-left-label"),
    storageBar: document.getElementById("storage-bar"),
    storageCaption: document.getElementById("storage-caption"),
    networkStats: document.getElementById("network-stats"),
    nowPlaying: document.getElementById("now-playing"),
    calendarRoot: document.getElementById("calendar-root"),
  };
}

function renderRightRail() {
  rightRail.replaceChildren();
  const order = dashboard.layout?.right || RIGHT_WIDGET_IDS;
  let count = 0;
  for (const id of order) {
    if (!RIGHT_WIDGET_IDS.includes(id) || !widgetOn(id)) continue;
    if (id === "community" && !communities().length) continue;
    if (id === "weather") {
      const w = widgetCfg("weather");
      if (w.latitude == null || w.longitude == null) continue;
    }
    const el = buildRightWidget(id);
    if (el) {
      rightRail.appendChild(el);
      count += 1;
    }
  }
  rightRail.classList.toggle("is-hidden", count === 0);
  refreshUiRefs();
}

const CENTER_RENDERERS = {
  stacks: renderStacksWidget,
  community: renderCommunityWidget,
  hackerNews: renderHnWidget,
  media: renderMediaWidget,
};

function renderLibraryWidget() {
  const widget = document.createElement("article");
  widget.className = "widget widget--wide";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">App library</span></div>`;

  const list = document.createElement("ul");
  list.className = "library-list";
  const query = (searchInput.value || "").trim().toLowerCase();
  let apps = catalogApps.length
    ? catalogApps.map((a) => ({ ...a }))
    : allServices.map((s) => ({
        id: s.label,
        name: s.name,
        description: s.description,
        category: s.category,
        port: s.port,
        path: s.path,
        installable: s.installable !== false,
        core: s.core === true,
        enabled: s.enabled === true || s.core === true,
        running: isUp(s),
        status: isUp(s) ? "running" : s.enabled === true || s.core === true ? "installed" : "available",
        fields: [],
      }));
  apps = apps.filter((a) => a.id !== "control-center");

  // Prefer live catalog status (Docker-backed) over stale services.json enabled flags.
  for (const app of apps) {
    const svc = allServices.find((s) => s.label === app.id);
    if (app.status === "running" || app.running === true) {
      app.running = true;
      app.status = "running";
    } else if (app.status === "removed") {
      app.running = false;
      app.status = "removed";
      app.enabled = true;
    } else if (app.status === "stopped" || app.status === "installed") {
      app.running = false;
      app.status = "stopped";
    } else {
      app.running = false;
      app.status = "available";
      app.enabled = false;
    }
    if (svc?.port && !app.port) app.port = svc.port;
    if (svc?.path && !app.path) app.path = svc.path;
  }

  if (query) {
    apps = apps.filter((a) =>
      [a.name, a.id, a.description, a.category].join(" ").toLowerCase().includes(query)
    );
  }
  apps.sort((a, b) => {
    const order = { removed: 0, available: 1, stopped: 2, installed: 2, running: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name);
  });

  if (!apps.length) {
    list.innerHTML = `<li class="empty-note">No recipes found.</li>`;
  } else {
    for (const app of apps) {
      const li = document.createElement("li");
      li.className = "library-item";
      const actions = document.createElement("div");
      actions.className = "library-actions";
      if (app.status === "available" && app.installable !== false) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--primary";
        btn.textContent = "Install";
        btn.addEventListener("click", () => openInstallModal(app));
        actions.appendChild(btn);
      } else if (app.status === "removed") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--primary";
        btn.textContent = "Reinstall";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await apiFetch(`/api/apps/${encodeURIComponent(app.id)}/start`, { method: "POST" });
            await loadDashboard();
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
          }
        });
        actions.appendChild(btn);
      } else if (app.status === "running") {
        if (app.port) {
          const link = document.createElement("a");
          link.className = "btn btn--primary";
          link.textContent = "Open";
          link.href = serviceUrl({ label: app.id, port: app.port, path: app.path || "" });
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          actions.appendChild(link);
        } else {
          const badge = document.createElement("span");
          badge.className = "library-action-note";
          badge.textContent = "Running";
          actions.appendChild(badge);
        }
      } else if (app.status === "stopped" || app.status === "installed") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = "Start";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            await apiFetch(`/api/apps/${encodeURIComponent(app.id)}/start`, { method: "POST" });
            await loadDashboard();
          } catch (err) {
            alert(err.message);
            btn.disabled = false;
          }
        });
        actions.appendChild(btn);
      }

      if (
        app.core !== true
        && (app.status === "stopped" || app.status === "installed" || app.status === "running" || app.status === "removed")
      ) {
        const uninstall = document.createElement("button");
        uninstall.type = "button";
        uninstall.className = "btn btn--danger btn--sm";
        uninstall.textContent = "Uninstall";
        uninstall.addEventListener("click", () => uninstallLibraryApp(app, uninstall));
        actions.appendChild(uninstall);
      }

      const statusClass =
        app.status === "running" ? "is-running"
          : app.status === "available" ? "is-available"
            : app.status === "removed" ? "is-removed"
              : "";
      li.innerHTML = `
        <div>${iconHtml({ label: app.id, name: app.name })}</div>
        <div class="library-meta">
          <p class="library-title">${app.name}</p>
          <p class="library-desc">${app.description || ""}</p>
          <span class="library-status ${statusClass}">${app.status}</span>
        </div>
      `;
      li.appendChild(actions);
      list.appendChild(li);
    }
  }

  widget.appendChild(list);
  return widget;
}

async function uninstallLibraryApp(app, btn) {
  if (!confirm(`Uninstall ${app.name}?\n\nContainers will stop. Data volumes are kept.`)) return;
  if (btn) btn.disabled = true;
  try {
    await apiFetch(`/api/apps/${encodeURIComponent(app.id)}`, { method: "DELETE" });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
    if (btn) btn.disabled = false;
  }
}

function renderCenter() {
  centerWidgets.replaceChildren();
  const searchRow = document.querySelector(".search-row");
  if (searchRow) searchRow.classList.toggle("is-settings-hidden", activeView === "settings");

  if (activeView === "settings") {
    rightRail.classList.add("is-hidden");
    if (!settingsDraft) {
      settingsDraft = structuredClone(dashboard);
      settingsDirty = false;
    }
    centerWidgets.appendChild(renderSettingsPage());
    return;
  }

  if (activeView === "library") {
    rightRail.classList.add("is-hidden");
    searchInput.placeholder = dashboard.search?.libraryPlaceholder || "Filter library…";
    centerWidgets.appendChild(renderLibraryWidget());
    return;
  }

  searchInput.placeholder = dashboard.search?.placeholder || DEFAULT_DASHBOARD.search.placeholder;
  renderRightRail();

  const grid = document.createElement("div");
  grid.className = "home-grid";
  const order = dashboard.layout?.center || CENTER_WIDGET_IDS;
  let added = 0;
  for (const id of order) {
    if (!CENTER_WIDGET_IDS.includes(id) || !widgetOn(id)) continue;
    if (id === "community" && !communities().length) continue;
    const render = CENTER_RENDERERS[id];
    if (!render) continue;
    grid.appendChild(render());
    added += 1;
  }
  if (!added) {
    const note = document.createElement("article");
    note.className = "widget widget--wide";
    note.innerHTML = `<p class="empty-note">No home widgets enabled. Open <a href="/settings">Settings</a>.</p>`;
    note.querySelector("a[href='/settings']")?.addEventListener("click", (event) => goSettings("general", event));
    grid.appendChild(note);
  }
  centerWidgets.appendChild(grid);
}

function renderNetworkStats() {
  if (!ui.networkStats) return;
  ui.networkStats.replaceChildren();
  const installed = installedServices();
  const online = installed.filter(isUp);
  const pings = online.map((s) => probeTimes.get(s.label)).filter((v) => v != null);
  const avgPing = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;
  const stats = [
    { label: "Online", value: String(online.length) },
    { label: "Avg ping", value: avgPing != null ? `${avgPing}ms` : "—" },
    { label: "Installed", value: String(installed.length) },
  ];
  for (const stat of stats) {
    const el = document.createElement("div");
    el.className = "network-stat";
    el.innerHTML = `
      <span class="network-stat-value">${stat.value}</span>
      <span class="network-stat-label">${stat.label}</span>
    `;
    ui.networkStats.appendChild(el);
  }
}

function renderNowPlaying() {
  if (!ui.nowPlaying) return;
  ui.nowPlaying.replaceChildren();
  const featured = runningServices.find((s) => isInstalled(s) && s.label === "jellyfin")
    || runningServices.find((s) => isInstalled(s) && s.category === "media")
    || runningServices.find((s) => isInstalled(s));

  if (!featured) {
    ui.nowPlaying.innerHTML = `<p class="empty-note" style="padding:0.35rem;grid-column:1/-1">Nothing running</p>`;
    return;
  }

  const meta = iconMeta(featured);
  ui.nowPlaying.innerHTML = `
    <div class="now-playing-thumb">${meta.letter}</div>
    <div>
      <p class="now-playing-title">${featured.name}</p>
      <p class="now-playing-sub">${featured.description || ""} · :${featured.port || "—"}</p>
    </div>
  `;
}

function openInstallModal(app) {
  installTarget = app;
  const modal = document.getElementById("install-modal");
  const form = document.getElementById("install-form");
  const err = document.getElementById("install-error");
  document.getElementById("install-title").textContent = `Install ${app.name}`;
  document.getElementById("install-desc").textContent = app.description || "";
  err.hidden = true;
  form.replaceChildren();

  const fields = Array.isArray(app.fields) ? app.fields.filter((f) => !f.fromLab) : [];
  if (!fields.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No extra settings — defaults from the recipe will be used.";
    form.appendChild(note);
  } else {
    for (const field of fields) {
      const id = `field-${field.key}`;
      const labelText = field.label || humanizeFieldKey(field.key);

      if (field.type === "boolean") {
        const wrap = document.createElement("label");
        wrap.className = "install-field install-field--bool";
        wrap.htmlFor = id;
        const input = document.createElement("input");
        input.id = id;
        input.name = field.key;
        input.type = "checkbox";
        input.checked = field.default === true;
        const text = document.createElement("span");
        text.className = "install-field-text";
        text.textContent = labelText;
        wrap.append(input, text);
        form.appendChild(wrap);
        continue;
      }

      const wrap = document.createElement("div");
      wrap.className = "install-field";
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = labelText;
      if (field.required) {
        const req = document.createElement("span");
        req.className = "install-field-required";
        req.textContent = " required";
        label.appendChild(req);
      }
      const input = document.createElement("input");
      input.id = id;
      input.name = field.key;
      input.required = !!field.required;
      if (field.type === "number") {
        input.type = "number";
        if (field.default != null && field.default !== "") input.value = String(field.default);
      } else {
        input.type = "text";
        if (field.default != null && field.default !== "") input.value = String(field.default);
      }
      wrap.append(label, input);
      form.appendChild(wrap);
    }
  }
  modal.hidden = false;
}

function humanizeFieldKey(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Option";
}

function closeInstallModal() {
  document.getElementById("install-modal").hidden = true;
  installTarget = null;
}

async function submitInstall(event) {
  event.preventDefault();
  if (!installTarget) return;
  const form = document.getElementById("install-form");
  const err = document.getElementById("install-error");
  const submit = document.getElementById("install-submit");
  err.hidden = true;
  submit.disabled = true;

  const config = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") config[el.name] = el.checked;
    else if (el.type === "number") config[el.name] = el.value === "" ? null : Number(el.value);
    else if (el.value !== "") config[el.name] = el.value;
  }

  try {
    await apiFetch(`/api/apps/${encodeURIComponent(installTarget.id)}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    closeInstallModal();
    setActiveView("home");
    await loadDashboard();
  } catch (error) {
    err.textContent = error.message;
    err.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function syncNavTabs() {
  document.querySelectorAll(".page-tab[data-view]").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === activeView);
  });
}

function updateStats() {
  const now = new Date();
  if (ui.yearPct && ui.yearBar && ui.yearLabel) {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
    const yearProgress = ((now - yearStart) / (yearEnd - yearStart)) * 100;
    ui.yearPct.textContent = `${Math.round(yearProgress)}%`;
    ui.yearBar.style.width = `${yearProgress}%`;
    ui.yearLabel.textContent = `${Math.round(yearProgress)}% of the year has passed`;
  }

  if (ui.storageUsedLabel && ui.storageLeftLabel && ui.storageBar && ui.storageCaption) {
    const installed = installedServices();
    const online = installed.filter(isUp).length;
    const usedPct = installed.length ? Math.round((online / installed.length) * 100) : 0;
    ui.storageUsedLabel.textContent = `USED ${usedPct}%`;
    ui.storageLeftLabel.textContent = `${100 - usedPct}% LEFT`;
    ui.storageBar.style.width = `${usedPct}%`;
    ui.storageCaption.textContent = `${online} of ${installed.length} installed stacks online`;
  }
}

function markSettingsDirty() {
  settingsDirty = true;
  settingsStatus = { text: "Unsaved changes", kind: "" };
}

function bumpArrayItem(list, index, delta) {
  const next = index + delta;
  if (!Array.isArray(list) || next < 0 || next >= list.length) return;
  const tmp = list[index];
  list[index] = list[next];
  list[next] = tmp;
}

function ensureSettingsDraftShape() {
  if (!settingsDraft.sidebar) settingsDraft.sidebar = { showInstalledApps: true, bookmarks: [] };
  if (!Array.isArray(settingsDraft.sidebar.bookmarks)) settingsDraft.sidebar.bookmarks = [];
  if (!settingsDraft.search) settingsDraft.search = structuredClone(DEFAULT_DASHBOARD.search);
  if (!settingsDraft.theme) settingsDraft.theme = structuredClone(DEFAULT_DASHBOARD.theme);
  if (!settingsDraft.widgets) settingsDraft.widgets = structuredClone(DEFAULT_DASHBOARD.widgets);
  if (!settingsDraft.layout) settingsDraft.layout = structuredClone(DEFAULT_DASHBOARD.layout);
  if (!Array.isArray(settingsDraft.layout.center)) settingsDraft.layout.center = [...CENTER_WIDGET_IDS];
  if (!Array.isArray(settingsDraft.layout.right)) settingsDraft.layout.right = [...RIGHT_WIDGET_IDS];
}

function sanitizeSettingsDraft(draft) {
  const out = structuredClone(draft);
  out.title = (out.title || "Modulab").trim() || "Modulab";
  out.theme = out.theme || {};
  out.theme.accent = out.theme.accent || DEFAULT_DASHBOARD.theme.accent;
  out.search = out.search || {};
  out.search.engine = (out.search.engine || DEFAULT_DASHBOARD.search.engine).trim();
  out.search.placeholder = out.search.placeholder || DEFAULT_DASHBOARD.search.placeholder;
  out.search.libraryPlaceholder = out.search.libraryPlaceholder || DEFAULT_DASHBOARD.search.libraryPlaceholder;
  out.sidebar = out.sidebar || { showInstalledApps: true, bookmarks: [] };
  out.sidebar.showInstalledApps = out.sidebar.showInstalledApps !== false;
  out.sidebar.bookmarks = (out.sidebar.bookmarks || [])
    .map((group) => ({
      title: (group.title || "Shortcuts").trim() || "Shortcuts",
      color: resolveBookmarkColor(group.color),
      links: (group.links || [])
        .map((link) => {
          const url = (link.url || "").trim();
          if (!url) return null;
          let domain = (link.domain || "").trim();
          try {
            if (!domain) domain = new URL(url).hostname;
          } catch {
            return null;
          }
          return {
            title: (link.title || domain).trim() || domain,
            url,
            domain,
          };
        })
        .filter(Boolean),
    }));
  out.sidebar.bookmarks = out.sidebar.bookmarks.filter((g) => g.title && g.links.length);

  const community = out.widgets?.community;
  if (community) {
    if (typeof community.communities === "string") {
      community.communities = community.communities.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(community.communities)) community.communities = [];
    community.limit = Math.min(15, Math.max(1, Number(community.limit) || 6));
  }
  const hn = out.widgets?.hackerNews;
  if (hn) hn.limit = Math.min(20, Math.max(1, Number(hn.limit) || 8));
  const weather = out.widgets?.weather;
  if (weather) {
    weather.latitude = weather.latitude === "" || weather.latitude == null ? null : Number(weather.latitude);
    weather.longitude = weather.longitude === "" || weather.longitude == null ? null : Number(weather.longitude);
  }

  // Ensure layout includes all known widgets once
  for (const id of CENTER_WIDGET_IDS) {
    if (!out.layout.center.includes(id)) out.layout.center.push(id);
  }
  out.layout.center = out.layout.center.filter((id, i, arr) => CENTER_WIDGET_IDS.includes(id) && arr.indexOf(id) === i);
  for (const id of RIGHT_WIDGET_IDS) {
    if (!out.layout.right.includes(id)) out.layout.right.push(id);
  }
  out.layout.right = out.layout.right.filter((id, i, arr) => RIGHT_WIDGET_IDS.includes(id) && arr.indexOf(id) === i);

  return out;
}

function renderSettingsPage() {
  ensureSettingsDraftShape();
  const page = document.createElement("div");
  page.className = "settings-page";

  const toolbar = document.createElement("div");
  toolbar.className = "settings-toolbar";
  toolbar.innerHTML = `
    <div>
      <h1>Settings</h1>
      <p class="settings-status ${settingsStatus.kind ? `is-${settingsStatus.kind}` : ""}">${settingsStatus.text || (settingsDirty ? "Unsaved changes" : "Changes write to dashboard.json")}</p>
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "settings-toolbar-actions";
  const discard = document.createElement("button");
  discard.type = "button";
  discard.className = "btn btn--ghost";
  discard.textContent = "Discard";
  discard.disabled = !settingsDirty;
  discard.addEventListener("click", () => {
    settingsDraft = structuredClone(dashboard);
    settingsDirty = false;
    settingsStatus = { text: "Discarded", kind: "" };
    renderAll();
  });
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn--primary";
  save.textContent = "Save";
  save.disabled = !settingsDirty;
  save.addEventListener("click", submitSettingsSave);
  actions.append(discard, save);
  toolbar.appendChild(actions);
  page.appendChild(toolbar);

  const tabs = document.createElement("div");
  tabs.className = "settings-tabs";
  tabs.setAttribute("role", "tablist");
  for (const section of SETTINGS_SECTIONS) {
    const btn = document.createElement("a");
    btn.href = pathForRoute("settings", section.id);
    btn.className = `settings-tab${settingsSection === section.id ? " is-active" : ""}`;
    btn.textContent = section.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", settingsSection === section.id ? "true" : "false");
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveView("settings", { section: section.id });
    });
    tabs.appendChild(btn);
  }
  page.appendChild(tabs);

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  if (settingsSection === "general") panel.appendChild(renderSettingsGeneral());
  else if (settingsSection === "sidebar") panel.appendChild(renderSettingsSidebar());
  else if (settingsSection === "widgets") panel.appendChild(renderSettingsWidgets());
  else panel.appendChild(renderSettingsLayout());
  page.appendChild(panel);
  return page;
}

function renderSettingsGeneral() {
  const block = document.createElement("section");
  block.className = "settings-block";
  block.innerHTML = `<h2>General</h2><p class="settings-hint">Brand, accent, and search behavior for Control Center.</p>`;
  const grid = document.createElement("div");
  grid.className = "settings-grid";

  grid.appendChild(settingsTextField("Brand title", settingsDraft.title || "", (v) => {
    settingsDraft.title = v;
  }));
  grid.appendChild(settingsColorField("Accent color", settingsDraft.theme.accent || "#d9a441", (v) => {
    settingsDraft.theme.accent = v;
  }));
  grid.appendChild(settingsTextField("Web search URL (%s = query)", settingsDraft.search.engine || "", (v) => {
    settingsDraft.search.engine = v;
  }, true));
  grid.appendChild(settingsTextField("Home search placeholder", settingsDraft.search.placeholder || "", (v) => {
    settingsDraft.search.placeholder = v;
  }, true));
  grid.appendChild(settingsTextField("Library search placeholder", settingsDraft.search.libraryPlaceholder || "", (v) => {
    settingsDraft.search.libraryPlaceholder = v;
  }, true));

  block.appendChild(grid);
  return block;
}

function settingsTextField(label, value, onChange, full = false) {
  const wrap = document.createElement("label");
  wrap.className = `settings-field${full ? " settings-field--full" : ""}`;
  wrap.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("input", () => {
    onChange(input.value);
    markSettingsDirty();
    updateSettingsToolbarState();
  });
  wrap.appendChild(input);
  return wrap;
}

function settingsColorField(label, value, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "settings-field";
  wrap.innerHTML = `<span>${label}</span>`;
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#d9a441";
  input.addEventListener("input", () => {
    onChange(input.value);
    markSettingsDirty();
    document.documentElement.style.setProperty("--accent", input.value);
    document.documentElement.style.setProperty("--accent-soft", `${input.value}29`);
    updateSettingsToolbarState();
  });
  wrap.appendChild(input);
  return wrap;
}

function updateSettingsToolbarState() {
  const page = centerWidgets.querySelector(".settings-page");
  if (!page) return;
  const status = page.querySelector(".settings-status");
  if (status) {
    status.textContent = settingsStatus.text || (settingsDirty ? "Unsaved changes" : "Changes write to dashboard.json");
    status.classList.toggle("is-error", settingsStatus.kind === "error");
    status.classList.toggle("is-ok", settingsStatus.kind === "ok");
  }
  const buttons = page.querySelectorAll(".settings-toolbar-actions .btn");
  buttons.forEach((btn) => {
    if (btn.textContent === "Discard" || btn.textContent === "Save") btn.disabled = !settingsDirty;
  });
}

function renderSettingsSidebar() {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "0.85rem";

  const opts = document.createElement("section");
  opts.className = "settings-block";
  opts.innerHTML = `<h2>Sidebar</h2><p class="settings-hint">Reorder groups and links, rename them, or import from a browser bookmarks HTML export.</p>`;
  const showApps = document.createElement("label");
  showApps.className = "settings-check";
  const showAppsInput = document.createElement("input");
  showAppsInput.type = "checkbox";
  showAppsInput.checked = settingsDraft.sidebar.showInstalledApps !== false;
  showAppsInput.addEventListener("change", () => {
    settingsDraft.sidebar.showInstalledApps = showAppsInput.checked;
    markSettingsDirty();
    updateSettingsToolbarState();
  });
  showApps.append(showAppsInput, document.createElement("span"));
  showApps.lastChild.textContent = "Show installed lab apps under shortcuts";
  opts.appendChild(showApps);

  const actions = document.createElement("div");
  actions.className = "settings-inline-actions";
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "btn btn--ghost";
  importBtn.textContent = "Import bookmarks…";
  importBtn.addEventListener("click", openBookmarkImportModal);
  const addGroup = document.createElement("button");
  addGroup.type = "button";
  addGroup.className = "btn";
  addGroup.textContent = "Add group";
  addGroup.addEventListener("click", () => {
    settingsDraft.sidebar.bookmarks.push({ title: "New group", color: BOOKMARK_COLOR_PRESETS.tools, links: [] });
    markSettingsDirty();
    renderAll();
  });
  actions.append(importBtn, addGroup);
  opts.appendChild(actions);
  wrap.appendChild(opts);

  const groups = settingsDraft.sidebar.bookmarks;
  groups.forEach((group, gi) => {
    wrap.appendChild(renderSettingsBookmarkGroup(group, gi, groups.length));
  });

  if (!groups.length) {
    const empty = document.createElement("section");
    empty.className = "settings-block";
    empty.innerHTML = `<p class="empty-note">No shortcut groups yet. Add a group or import bookmarks.</p>`;
    wrap.appendChild(empty);
  }

  return wrap;
}

function renderSettingsBookmarkGroup(group, gi, total) {
  if (!Array.isArray(group.links)) group.links = [];
  const card = document.createElement("section");
  card.className = "settings-group";

  const head = document.createElement("div");
  head.className = "settings-group-head";

  const titleField = document.createElement("label");
  titleField.className = "settings-field";
  titleField.innerHTML = "<span>Group title</span>";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = group.title || "";
  titleInput.addEventListener("input", () => {
    group.title = titleInput.value;
    markSettingsDirty();
    updateSettingsToolbarState();
  });
  titleField.appendChild(titleInput);

  const colorField = document.createElement("label");
  colorField.className = "settings-field settings-field--color";
  colorField.innerHTML = "<span>Color</span>";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = resolveBookmarkColor(group.color);
  colorInput.title = "Group title color";
  colorInput.addEventListener("input", () => {
    group.color = colorInput.value;
    markSettingsDirty();
    updateSettingsToolbarState();
  });
  colorField.appendChild(colorInput);

  const gActions = document.createElement("div");
  gActions.className = "settings-group-actions";
  gActions.append(
    iconAction("↑", "Move group up", () => {
      bumpArrayItem(settingsDraft.sidebar.bookmarks, gi, -1);
      markSettingsDirty();
      renderAll();
    }, gi === 0),
    iconAction("↓", "Move group down", () => {
      bumpArrayItem(settingsDraft.sidebar.bookmarks, gi, 1);
      markSettingsDirty();
      renderAll();
    }, gi >= total - 1),
    iconAction("×", "Delete group", () => {
      if (!confirm(`Delete group “${group.title || "Untitled"}”?`)) return;
      settingsDraft.sidebar.bookmarks.splice(gi, 1);
      markSettingsDirty();
      renderAll();
    }, false, true),
  );

  head.append(titleField, colorField, gActions);
  card.appendChild(head);

  group.links.forEach((link, li) => {
    card.appendChild(renderSettingsBookmarkLink(group, gi, link, li));
  });

  const addLink = document.createElement("button");
  addLink.type = "button";
  addLink.className = "btn btn--ghost btn--sm";
  addLink.textContent = "Add link";
  addLink.addEventListener("click", () => {
    group.links.push({ title: "", url: "https://", domain: "" });
    markSettingsDirty();
    renderAll();
  });
  card.appendChild(addLink);
  return card;
}

function renderSettingsBookmarkLink(group, gi, link, li) {
  const row = document.createElement("div");
  row.className = "settings-link-row";

  const title = document.createElement("input");
  title.type = "text";
  title.placeholder = "Title";
  title.value = link.title || "";
  title.addEventListener("input", () => {
    link.title = title.value;
    markSettingsDirty();
    updateSettingsToolbarState();
  });

  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://…";
  url.value = link.url || "";
  url.addEventListener("input", () => {
    link.url = url.value;
    try { link.domain = new URL(url.value).hostname; } catch { /* keep */ }
    markSettingsDirty();
    updateSettingsToolbarState();
  });

  const actions = document.createElement("div");
  actions.className = "settings-link-actions";
  actions.append(
    iconAction("↑", "Move link up", () => {
      bumpArrayItem(group.links, li, -1);
      markSettingsDirty();
      renderAll();
    }, li === 0),
    iconAction("↓", "Move link down", () => {
      bumpArrayItem(group.links, li, 1);
      markSettingsDirty();
      renderAll();
    }, li >= group.links.length - 1),
  );

  const move = document.createElement("select");
  move.title = "Move to group";
  move.innerHTML = `<option value="">Move to…</option>`;
  settingsDraft.sidebar.bookmarks.forEach((g, idx) => {
    if (idx === gi) return;
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = g.title || `Group ${idx + 1}`;
    move.appendChild(opt);
  });
  move.addEventListener("change", () => {
    const target = Number(move.value);
    if (!Number.isInteger(target) || target === gi) return;
    const [item] = group.links.splice(li, 1);
    settingsDraft.sidebar.bookmarks[target].links.push(item);
    markSettingsDirty();
    renderAll();
  });
  actions.appendChild(move);

  actions.appendChild(iconAction("×", "Delete link", () => {
    group.links.splice(li, 1);
    markSettingsDirty();
    renderAll();
  }, false, true));

  row.append(title, url, actions);
  return row;
}

function iconAction(label, title, onClick, disabled = false, danger = false) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `settings-icon-btn${danger ? " is-danger" : ""}`;
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderSettingsWidgets() {
  const block = document.createElement("section");
  block.className = "settings-block";
  block.innerHTML = `<h2>Widgets</h2><p class="settings-hint">Enable or tune home widgets. Layout order is under Layout.</p>`;

  const ids = [...CENTER_WIDGET_IDS, ...RIGHT_WIDGET_IDS];
  for (const id of ids) {
    if (!settingsDraft.widgets[id]) settingsDraft.widgets[id] = structuredClone(DEFAULT_DASHBOARD.widgets[id] || { enabled: true });
    const cfg = settingsDraft.widgets[id];
    const row = document.createElement("div");
    row.className = "settings-widget-row";

    const check = document.createElement("label");
    check.className = "settings-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = cfg.enabled !== false;
    input.addEventListener("change", () => {
      cfg.enabled = input.checked;
      markSettingsDirty();
      updateSettingsToolbarState();
    });
    check.append(input, Object.assign(document.createElement("span"), { textContent: WIDGET_LABELS[id] || id }));
    row.appendChild(check);

    const fields = document.createElement("div");
    fields.className = "settings-grid";

    if (cfg.title != null || DEFAULT_DASHBOARD.widgets[id]?.title != null) {
      fields.appendChild(settingsTextField("Title", cfg.title || "", (v) => { cfg.title = v; }));
    }
    if (id === "community") {
      fields.appendChild(settingsTextField(
        "Communities (comma-separated)",
        (cfg.communities || []).join(", "),
        (v) => { cfg.communities = v; },
        true,
      ));
      fields.appendChild(settingsTextField("Limit", String(cfg.limit ?? 6), (v) => { cfg.limit = v; }));
    }
    if (id === "hackerNews") {
      fields.appendChild(settingsTextField("Limit", String(cfg.limit ?? 8), (v) => { cfg.limit = v; }));
    }
    if (id === "media") {
      fields.appendChild(settingsTextField("Empty hint", cfg.emptyHint || "", (v) => { cfg.emptyHint = v; }, true));
    }
    if (id === "weather") {
      fields.appendChild(settingsTextField("Label", cfg.label || "", (v) => { cfg.label = v; }));
      fields.appendChild(settingsTextField("Latitude", cfg.latitude == null ? "" : String(cfg.latitude), (v) => { cfg.latitude = v; }));
      fields.appendChild(settingsTextField("Longitude", cfg.longitude == null ? "" : String(cfg.longitude), (v) => { cfg.longitude = v; }));
    }

    if (fields.childElementCount) row.appendChild(fields);
    else row.appendChild(document.createElement("div"));
    block.appendChild(row);
  }

  return block;
}

function renderSettingsLayout() {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "0.85rem";

  wrap.appendChild(renderLayoutList(
    "Center column",
    "Order of main home widgets.",
    settingsDraft.layout.center,
    CENTER_WIDGET_IDS,
  ));
  wrap.appendChild(renderLayoutList(
    "Right rail",
    "Order of status widgets.",
    settingsDraft.layout.right,
    RIGHT_WIDGET_IDS,
  ));
  return wrap;
}

function renderLayoutList(title, hint, list, allowed) {
  // Keep only allowed, append missing
  const cleaned = list.filter((id) => allowed.includes(id));
  for (const id of allowed) if (!cleaned.includes(id)) cleaned.push(id);
  list.length = 0;
  list.push(...cleaned);

  const block = document.createElement("section");
  block.className = "settings-block";
  block.innerHTML = `<h2>${title}</h2><p class="settings-hint">${hint}</p>`;
  const ul = document.createElement("div");
  ul.className = "settings-layout-list";
  list.forEach((id, index) => {
    const item = document.createElement("div");
    item.className = "settings-layout-item";
    item.innerHTML = `<span>${WIDGET_LABELS[id] || id}</span>`;
    const actions = document.createElement("div");
    actions.className = "settings-group-actions";
    actions.append(
      iconAction("↑", "Move up", () => {
        bumpArrayItem(list, index, -1);
        markSettingsDirty();
        renderAll();
      }, index === 0),
      iconAction("↓", "Move down", () => {
        bumpArrayItem(list, index, 1);
        markSettingsDirty();
        renderAll();
      }, index >= list.length - 1),
    );
    item.appendChild(actions);
    ul.appendChild(item);
  });
  block.appendChild(ul);
  return block;
}

async function submitSettingsSave() {
  if (!settingsDraft) return;
  settingsStatus = { text: "Saving…", kind: "" };
  updateSettingsToolbarState();
  try {
    const payload = sanitizeSettingsDraft(settingsDraft);
    await apiFetch("/api/dashboard", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    dashboard = normalizeDashboard(payload);
    settingsDraft = structuredClone(dashboard);
    settingsDirty = false;
    settingsStatus = { text: "Saved", kind: "ok" };
    applyTheme();
    renderSidebar();
    renderAll();
    feedCache = { community: null, hn: null, weather: null };
  } catch (err) {
    settingsStatus = { text: err.message || String(err), kind: "error" };
    updateSettingsToolbarState();
  }
}

function normalizePathname(pathname) {
  const path = (pathname || "/").split("?")[0].split("#")[0];
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function pathForRoute(view, section = settingsSection) {
  if (view === "library") return "/library";
  if (view === "settings") {
    const id = SETTINGS_SECTION_IDS.has(section) ? section : "general";
    return id === "general" ? "/settings" : `/settings/${id}`;
  }
  return "/";
}

function parseRoute(pathname = location.pathname) {
  const path = normalizePathname(pathname);
  if (path === "/" || path === "/home") {
    return { view: "home", section: "general", canonical: "/" };
  }
  if (path === "/library") {
    return { view: "library", section: "general", canonical: "/library" };
  }
  if (path === "/settings") {
    return { view: "settings", section: "general", canonical: "/settings" };
  }
  const match = path.match(/^\/settings\/([a-z0-9-]+)$/i);
  if (match) {
    const section = match[1].toLowerCase();
    if (SETTINGS_SECTION_IDS.has(section)) {
      return {
        view: "settings",
        section,
        canonical: pathForRoute("settings", section),
      };
    }
  }
  return { view: "home", section: "general", canonical: "/", unknown: true };
}

function syncDocumentTitle() {
  const brand = dashboard.title || "Modulab";
  if (activeView === "library") document.title = `${brand} · Library`;
  else if (activeView === "settings") document.title = `${brand} · Settings`;
  else document.title = `${brand} · Control Center`;
}

function syncUrl(replace = false) {
  const url = pathForRoute(activeView, settingsSection);
  const current = normalizePathname(location.pathname);
  if (current === url && !replace) return;
  const state = { view: activeView, section: settingsSection };
  if (replace || current === url) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
}

function setActiveView(view, options = {}) {
  if (!APP_VIEWS.has(view)) view = "home";
  const nextSection = options.section && SETTINGS_SECTION_IDS.has(options.section)
    ? options.section
    : view === "settings"
      ? (settingsSection || "general")
      : settingsSection;
  const replace = options.replace === true;
  const fromPop = options.fromPop === true;

  if (
    view === activeView
    && (view !== "settings" || nextSection === settingsSection)
    && !options.force
  ) {
    if (routingReady && !fromPop) syncUrl(replace);
    return true;
  }

  if (activeView === "settings" && settingsDirty && view !== "settings") {
    if (!confirm("Discard unsaved settings changes?")) {
      if (routingReady) syncUrl(true);
      return false;
    }
    settingsDraft = null;
    settingsDirty = false;
    settingsStatus = { text: "", kind: "" };
    applyTheme();
  }

  if (view === "settings") {
    if (!settingsDraft || activeView !== "settings") {
      settingsDraft = structuredClone(dashboard);
      settingsDirty = false;
      settingsStatus = { text: "", kind: "" };
    }
    settingsSection = nextSection;
  } else if (activeView === "settings") {
    settingsDraft = null;
  }

  activeView = view;
  if (view === "settings") settingsSection = nextSection;

  if (routingReady && !fromPop) syncUrl(replace);
  syncNavTabs();
  syncDocumentTitle();
  renderAll();
  if (activeView === "home") loadHomeWidgets(false);
  return true;
}

function applyRouteFromLocation({ replace = false, fromPop = false } = {}) {
  const route = parseRoute(location.pathname);
  if (route.unknown || route.canonical !== normalizePathname(location.pathname)) {
    history.replaceState(
      { view: route.view, section: route.section },
      "",
      route.canonical,
    );
  }
  return setActiveView(route.view, {
    section: route.section,
    replace: true,
    fromPop,
    force: true,
  });
}

function goLibrary(event) {
  if (event) event.preventDefault();
  setActiveView("library");
}

function goSettings(section = "general", event) {
  if (event) event.preventDefault();
  setActiveView("settings", { section });
}

function renderAll() {
  applyTheme();
  syncDocumentTitle();
  renderSidebar();
  renderCenter();
  if (activeView === "home") {
    updateClock();
    renderWeather();
    renderNetworkStats();
    renderNowPlaying();
    renderCalendar();
    updateStats();
  }
}

async function loadDashboardConfig() {
  try {
    const res = await fetch("/dashboard.json", { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    dashboard = normalizeDashboard(await res.json());
  } catch {
    dashboard = normalizeDashboard({});
  }
  const subs = communities();
  if (!activeCommunity || !subs.includes(activeCommunity)) {
    activeCommunity = subs[0] || "";
  }
}

async function loadCommunityFeed(force = false) {
  if (!widgetOn("community") || !communities().length) return;
  if (feedCache.community && !force) return;
  const sub = activeCommunity || communities()[0];
  const limit = widgetCfg("community").limit || 6;
  try {
    const data = await apiFetch(`/api/feeds/reddit?sub=${encodeURIComponent(sub)}&limit=${limit}`);
    feedCache.community = { items: data.items || [] };
  } catch (err) {
    feedCache.community = { error: err.message || "Feed unavailable" };
  }
}

async function loadHnFeed(force = false) {
  if (!widgetOn("hackerNews")) return;
  if (feedCache.hn && !force) return;
  const limit = widgetCfg("hackerNews").limit || 8;
  try {
    const data = await apiFetch(`/api/feeds/hn?limit=${limit}`);
    feedCache.hn = { items: data.items || [] };
  } catch (err) {
    feedCache.hn = { error: err.message || "HN unavailable" };
  }
}

async function loadWeather(force = false) {
  if (!widgetOn("weather")) return;
  if (feedCache.weather && !force) return;
  const w = widgetCfg("weather");
  try {
    const data = await apiFetch(
      `/api/weather?lat=${encodeURIComponent(w.latitude)}&lon=${encodeURIComponent(w.longitude)}&label=${encodeURIComponent(w.label || "Local")}`
    );
    feedCache.weather = data;
  } catch (err) {
    feedCache.weather = { error: err.message || "Weather unavailable" };
  }
}

async function loadHomeWidgets(force = false) {
  await Promise.all([loadCommunityFeed(force), loadHnFeed(force), loadWeather(force)]);
  if (activeView === "home") renderAll();
}

async function loadDashboard() {
  if (activeView === "settings" && settingsDirty) return;
  refreshBtn.disabled = true;
  probeTimes.clear();

  try {
    await loadDashboardConfig();
    if (activeView === "settings" && !settingsDirty) {
      settingsDraft = structuredClone(dashboard);
    }

    const response = await fetch("/services.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`services.json ${response.status}`);
    allServices = await response.json();
    if (!Array.isArray(allServices)) allServices = [];

    try {
      const catalog = await apiFetch("/api/catalog");
      catalogApps = Array.isArray(catalog.apps) ? catalog.apps : [];
      for (const app of catalogApps) {
        const svc = allServices.find((s) => s.label === app.id);
        if (svc && typeof app.enabled === "boolean") svc.enabled = app.enabled;
      }
    } catch {
      catalogApps = [];
    }

    renderAll();
    loadHomeWidgets(true);

    const results = await Promise.all(
      installedServices().map(async (service) => ({
        service,
        up: await probe(service),
      }))
    );
    runningServices = results.filter(({ up }) => up).map(({ service }) => service);
    renderAll();
  } catch (err) {
    console.error(err);
    centerWidgets.innerHTML = `<article class="widget"><p class="empty-note">Failed to load. ${String(err.message || err)}</p></article>`;
  } finally {
    refreshBtn.disabled = false;
  }
}

searchInput.addEventListener("input", renderAll);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    renderAll();
    searchInput.blur();
    return;
  }
  if (event.key === "Enter") {
    const query = searchInput.value.trim();
    if (!query) return;
    const local = filteredServices(activeView === "library" ? allServices : installedServices());
    if (!local.length && activeView === "home") {
      event.preventDefault();
      openWebSearch(query);
    }
  }
});

refreshBtn.addEventListener("click", loadDashboard);

document.querySelectorAll(".page-tab[data-view]").forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    setActiveView(tab.dataset.view);
  });
});

document.getElementById("install-form").addEventListener("submit", submitInstall);
document.querySelectorAll("[data-close-install-modal]").forEach((el) => {
  el.addEventListener("click", closeInstallModal);
});

document.getElementById("edit-shortcuts-btn")?.addEventListener("click", () => {
  setActiveView("settings", { section: "sidebar" });
});

document.getElementById("import-bookmarks-btn")?.addEventListener("click", openBookmarkImportModal);
document.querySelectorAll("[data-close-bookmark-modal]").forEach((el) => {
  el.addEventListener("click", closeBookmarkImportModal);
});
document.getElementById("bookmark-file")?.addEventListener("change", onBookmarkFileSelected);
document.getElementById("bookmark-select-all")?.addEventListener("click", () => setAllBookmarkChecks(true));
document.getElementById("bookmark-select-none")?.addEventListener("click", () => setAllBookmarkChecks(false));
document.getElementById("bookmark-group-mode")?.addEventListener("change", syncBookmarkGroupModeUi);
document.getElementById("bookmark-import-submit")?.addEventListener("click", submitBookmarkImport);

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.target && link.target !== "_self") return;
  if (link.hasAttribute("download")) return;

  let url;
  try {
    url = new URL(link.getAttribute("href"), location.origin);
  } catch {
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const route = parseRoute(url.pathname);
  if (route.unknown && normalizePathname(url.pathname) !== "/") return;

  event.preventDefault();
  setActiveView(route.view, { section: route.section });
});

window.addEventListener("popstate", () => {
  applyRouteFromLocation({ fromPop: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput && activeView !== "settings") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (event.key === "Escape") {
    closeInstallModal();
    closeBookmarkImportModal();
  }
});

applyRouteFromLocation({ replace: true });
routingReady = true;

loadDashboard();
setInterval(loadDashboard, 5 * 60 * 1000);
setInterval(updateClock, 30 * 1000);
setInterval(() => {
  if (activeView === "home") loadHomeWidgets(true);
}, 10 * 60 * 1000);

/** @type {{ type: "folder" | "link", title: string, url?: string, children?: any[], id: string }[]} */
let bookmarkImportTree = [];
let bookmarkImportLinkIds = new Map();

function openBookmarkImportModal() {
  const modal = document.getElementById("bookmark-import-modal");
  const err = document.getElementById("bookmark-import-error");
  const file = document.getElementById("bookmark-file");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  if (file) file.value = "";
  resetBookmarkImportUi();
  modal.hidden = false;
}

function closeBookmarkImportModal() {
  const modal = document.getElementById("bookmark-import-modal");
  if (modal) modal.hidden = true;
  bookmarkImportTree = [];
  bookmarkImportLinkIds = new Map();
}

function resetBookmarkImportUi() {
  bookmarkImportTree = [];
  bookmarkImportLinkIds = new Map();
  const tree = document.getElementById("bookmark-tree");
  const toolbar = document.getElementById("bookmark-import-toolbar");
  const options = document.getElementById("bookmark-import-options");
  const submit = document.getElementById("bookmark-import-submit");
  if (tree) {
    tree.hidden = true;
    tree.replaceChildren();
  }
  if (toolbar) toolbar.hidden = true;
  if (options) options.hidden = true;
  if (submit) submit.disabled = true;
  syncBookmarkGroupModeUi();
  updateBookmarkSelectionCount();
}

function syncBookmarkGroupModeUi() {
  const mode = document.getElementById("bookmark-group-mode")?.value || "folders";
  const wrap = document.getElementById("bookmark-flat-name-wrap");
  if (wrap) wrap.hidden = mode !== "flat";
}

function onBookmarkFileSelected(event) {
  const file = event.target.files?.[0];
  const err = document.getElementById("bookmark-import-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  if (!file) {
    resetBookmarkImportUi();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      bookmarkImportTree = parseNetscapeBookmarks(String(reader.result || ""));
      if (!countBookmarkLinks(bookmarkImportTree)) {
        throw new Error("No http(s) bookmarks found in that file.");
      }
      renderBookmarkTree();
    } catch (error) {
      resetBookmarkImportUi();
      if (err) {
        err.textContent = error.message || String(error);
        err.hidden = false;
      }
    }
  };
  reader.onerror = () => {
    resetBookmarkImportUi();
    if (err) {
      err.textContent = "Could not read that file.";
      err.hidden = false;
    }
  };
  reader.readAsText(file);
}

function parseNetscapeBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const roots = [];
  let idSeq = 0;
  const nextId = () => `bm-${++idSeq}`;

  function walkDl(dl, into) {
    if (!dl) return;
    let child = dl.firstElementChild;
    while (child) {
      if (child.tagName === "DT") {
        const h3 = child.querySelector(":scope > h3");
        const a = child.querySelector(":scope > a");
        if (h3) {
          const folder = {
            type: "folder",
            id: nextId(),
            title: (h3.textContent || "Folder").trim() || "Folder",
            children: [],
          };
          let next = child.nextElementSibling;
          if (next?.tagName === "DD") next = next.nextElementSibling;
          if (next?.tagName === "DL") {
            walkDl(next, folder.children);
            child = next.nextElementSibling;
          } else {
            const nested = child.querySelector(":scope > dl");
            if (nested) walkDl(nested, folder.children);
            child = child.nextElementSibling;
          }
          into.push(folder);
          continue;
        }
        if (a) {
          const href = (a.getAttribute("href") || "").trim();
          if (/^https?:\/\//i.test(href)) {
            into.push({
              type: "link",
              id: nextId(),
              title: (a.textContent || href).trim() || href,
              url: href,
            });
          }
        }
      } else if (child.tagName === "DL") {
        walkDl(child, into);
      }
      child = child.nextElementSibling;
    }
  }

  const topDl = doc.querySelector("dl");
  if (topDl) walkDl(topDl, roots);
  return roots;
}

function countBookmarkLinks(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "link") n += 1;
    else if (node.children) n += countBookmarkLinks(node.children);
  }
  return n;
}

function renderBookmarkTree() {
  const tree = document.getElementById("bookmark-tree");
  const toolbar = document.getElementById("bookmark-import-toolbar");
  const options = document.getElementById("bookmark-import-options");
  const submit = document.getElementById("bookmark-import-submit");
  bookmarkImportLinkIds = new Map();
  tree.replaceChildren();
  tree.appendChild(buildBookmarkTreeFragment(bookmarkImportTree));
  tree.hidden = false;
  toolbar.hidden = false;
  options.hidden = false;
  submit.disabled = false;
  syncBookmarkGroupModeUi();
  updateBookmarkSelectionCount();
}

function buildBookmarkTreeFragment(nodes) {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === "folder") {
      const row = document.createElement("div");
      row.className = "bookmark-folder";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.dataset.folderId = node.id;
      check.addEventListener("change", () => {
        setFolderChecks(node, check.checked);
        updateBookmarkSelectionCount();
      });
      const body = document.createElement("div");
      body.className = "bookmark-folder-body";
      const title = document.createElement("div");
      title.className = "bookmark-folder-title";
      title.textContent = node.title;
      const kids = document.createElement("div");
      kids.className = "bookmark-folder-children";
      kids.appendChild(buildBookmarkTreeFragment(node.children || []));
      body.append(title, kids);
      row.append(check, body);
      frag.appendChild(row);
    } else if (node.type === "link") {
      bookmarkImportLinkIds.set(node.id, node);
      const row = document.createElement("label");
      row.className = "bookmark-link-row";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = true;
      check.dataset.linkId = node.id;
      check.addEventListener("change", updateBookmarkSelectionCount);
      const text = document.createElement("span");
      text.innerHTML = `${escapeHtml(node.title)}<span class="bookmark-link-url">${escapeHtml(node.url)}</span>`;
      row.append(check, text);
      frag.appendChild(row);
    }
  }
  return frag;
}

function setFolderChecks(folder, checked) {
  for (const child of folder.children || []) {
    if (child.type === "link") {
      const el = document.querySelector(`#bookmark-tree input[data-link-id="${CSS.escape(child.id)}"]`);
      if (el) el.checked = checked;
    } else if (child.type === "folder") {
      const el = document.querySelector(`#bookmark-tree input[data-folder-id="${CSS.escape(child.id)}"]`);
      if (el) el.checked = checked;
      setFolderChecks(child, checked);
    }
  }
}

function setAllBookmarkChecks(checked) {
  document.querySelectorAll("#bookmark-tree input[type=checkbox]").forEach((el) => {
    el.checked = checked;
  });
  updateBookmarkSelectionCount();
}

function updateBookmarkSelectionCount() {
  const selected = document.querySelectorAll("#bookmark-tree input[data-link-id]:checked").length;
  const total = document.querySelectorAll("#bookmark-tree input[data-link-id]").length;
  const countEl = document.getElementById("bookmark-selection-count");
  const submit = document.getElementById("bookmark-import-submit");
  if (countEl) countEl.textContent = total ? `${selected} of ${total} selected` : "";
  if (submit) submit.disabled = selected === 0;
}

function selectedBookmarkGroups() {
  const color = resolveBookmarkColor(document.getElementById("bookmark-group-color")?.value);
  const mode = document.getElementById("bookmark-group-mode")?.value || "folders";
  const selectedIds = new Set(
    [...document.querySelectorAll("#bookmark-tree input[data-link-id]:checked")].map((el) => el.dataset.linkId)
  );

  function collectFromFolder(folder, pathTitles) {
    const groups = [];
    const ownLinks = [];
    for (const child of folder.children || []) {
      if (child.type === "link" && selectedIds.has(child.id)) {
        ownLinks.push(toBookmarkLink(child));
      } else if (child.type === "folder") {
        groups.push(...collectFromFolder(child, [...pathTitles, child.title]));
      }
    }
    if (ownLinks.length) {
      groups.unshift({
        title: pathTitles.filter(Boolean).join(" / ") || folder.title || "Imported",
        color,
        links: ownLinks,
      });
    }
    return groups;
  }

  if (mode === "flat") {
    const links = [];
    for (const [id, node] of bookmarkImportLinkIds) {
      if (selectedIds.has(id)) links.push(toBookmarkLink(node));
    }
    const title = (document.getElementById("bookmark-flat-name")?.value || "Imported").trim() || "Imported";
    return links.length ? [{ title, color, links }] : [];
  }

  const groups = [];
  for (const node of bookmarkImportTree) {
    if (node.type === "folder") {
      groups.push(...collectFromFolder(node, [node.title]));
    } else if (node.type === "link" && selectedIds.has(node.id)) {
      // Root-level bookmarks without a folder.
      let catchAll = groups.find((g) => g.title === "Bookmarks");
      if (!catchAll) {
        catchAll = { title: "Bookmarks", color, links: [] };
        groups.push(catchAll);
      }
      catchAll.links.push(toBookmarkLink(node));
    }
  }
  return groups.filter((g) => g.links.length);
}

function toBookmarkLink(node) {
  let domain = "";
  try { domain = new URL(node.url).hostname; } catch { /* ignore */ }
  return { title: node.title, url: node.url, domain };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function submitBookmarkImport() {
  const err = document.getElementById("bookmark-import-error");
  const submit = document.getElementById("bookmark-import-submit");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  const groups = selectedBookmarkGroups();
  if (!groups.length) {
    if (err) {
      err.textContent = "Select at least one bookmark.";
      err.hidden = false;
    }
    return;
  }

  submit.disabled = true;
  try {
    const result = await apiFetch("/api/dashboard/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groups,
        mergeByTitle: document.getElementById("bookmark-merge")?.checked !== false,
      }),
    });
    closeBookmarkImportModal();
    await loadDashboardConfig();
    if (activeView === "settings") {
      settingsDraft = structuredClone(dashboard);
      settingsDirty = false;
      settingsStatus = { text: result?.message || "Imported", kind: "ok" };
      setActiveView("settings", { section: "sidebar", replace: true, force: true });
    }
    renderSidebar();
    renderAll();
    if (result?.message && activeView !== "settings") {
      railFoot.textContent = result.message;
      setTimeout(() => {
        const installed = installedServices();
        railFoot.textContent = `${installed.filter(isUp).length} online · ${installed.length} installed`;
      }, 3500);
    }
  } catch (error) {
    if (err) {
      err.textContent = error.message || String(error);
      err.hidden = false;
    }
  } finally {
    updateBookmarkSelectionCount();
  }
}

(function initSidebarResize() {
  const resizer = document.getElementById("sidebar-resizer");
  if (!resizer) return;

  const STORAGE_KEY = "modulab.sidebarWidth";
  const root = document.documentElement;
  const min = () => parseFloat(getComputedStyle(root).getPropertyValue("--sidebar-min")) || 160;
  const max = () => {
    const cssMax = parseFloat(getComputedStyle(root).getPropertyValue("--sidebar-max")) || 420;
    return Math.min(cssMax, Math.floor(window.innerWidth * 0.45));
  };

  function clamp(px) {
    return Math.round(Math.min(max(), Math.max(min(), px)));
  }

  function applyWidth(px, persist = false) {
    const width = clamp(px);
    root.style.setProperty("--sidebar", `${width}px`);
    resizer.setAttribute("aria-valuenow", String(width));
    if (persist) localStorage.setItem(STORAGE_KEY, String(width));
    return width;
  }

  const saved = Number(localStorage.getItem(STORAGE_KEY));
  if (Number.isFinite(saved) && saved > 0) applyWidth(saved);

  resizer.setAttribute("aria-valuemin", String(min()));
  resizer.setAttribute("aria-valuemax", String(max()));

  let dragging = false;

  function onPointerDown(event) {
    if (window.matchMedia("(max-width: 760px)").matches) return;
    dragging = true;
    document.body.classList.add("is-resizing-sidebar");
    resizer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragging) return;
    applyWidth(event.clientX);
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("is-resizing-sidebar");
    try { resizer.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    applyWidth(event.clientX || parseFloat(getComputedStyle(root).getPropertyValue("--sidebar")), true);
  }

  resizer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  resizer.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 24 : 12;
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--sidebar")) || 210;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyWidth(current - step, true);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      applyWidth(current + step, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      applyWidth(min(), true);
    } else if (event.key === "End") {
      event.preventDefault();
      applyWidth(max(), true);
    }
  });

  window.addEventListener("resize", () => {
    const current = parseFloat(getComputedStyle(root).getPropertyValue("--sidebar")) || 210;
    applyWidth(current);
  });
})();
