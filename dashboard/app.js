const sidebarCategories = document.getElementById("sidebar-categories");
const centerWidgets = document.getElementById("center-widgets");
const systemIcons = document.getElementById("system-icons");
const networkStats = document.getElementById("network-stats");
const adminLinks = document.getElementById("admin-links");
const nowPlaying = document.getElementById("now-playing");
const searchInput = document.getElementById("search");
const refreshBtn = document.getElementById("refresh");

const yearPct = document.getElementById("year-pct");
const yearBar = document.getElementById("year-bar");
const yearLabel = document.getElementById("year-label");
const storageUsedLabel = document.getElementById("storage-used-label");
const storageLeftLabel = document.getElementById("storage-left-label");
const storageBar = document.getElementById("storage-bar");
const storageCaption = document.getElementById("storage-caption");
const dayBar = document.getElementById("day-bar");
const statusText = document.getElementById("status-text");

const CATEGORY_ORDER = ["productivity", "media", "tools", "infrastructure", "other"];
const CATEGORY_LABELS = {
  productivity: "Productivity",
  media: "Media",
  tools: "Tools",
  infrastructure: "Infrastructure",
  other: "Other",
};

const SERVICE_ICONS = {
  jellyfin: { domain: "jellyfin.org", emoji: "🎬", color: "#00a4dc" },
  n8n: { domain: "n8n.io", emoji: "⚡", color: "#ea4b71" },
  seerr: { domain: "seerr.dev", emoji: "📺", color: "#5b6abf" },
  immich: { domain: "immich.app", emoji: "📷", color: "#4250af" },
  odysseus: { emoji: "🧠", color: "#6366f1" },
  "stirling-pdf": { domain: "stirlingpdf.com", emoji: "📄", color: "#e74c3c" },
  bentopdf: { emoji: "📑", color: "#3498db" },
  "it-tools": { domain: "it-tools.tech", emoji: "🔧", color: "#18b26b" },
  picoshare: { emoji: "📦", color: "#f39c12" },
  searxng: { domain: "searxng.org", emoji: "🔍", color: "#3050ff" },
  ntfy: { domain: "ntfy.sh", emoji: "🔔", color: "#317f43" },
  pihole: { domain: "pi-hole.net", emoji: "🛡", color: "#960060" },
};

const SYSTEM_SHORTCUTS = [
  { label: "Dash", match: "caddy", emoji: "🏠", port: 8888 },
  { label: "Code", match: "odysseus", emoji: "💻" },
  { label: "Files", match: "picoshare", emoji: "📁" },
  { label: "PDF", match: "stirling-pdf", emoji: "📄" },
  { label: "DNS", match: "pihole", emoji: "🌐", path: "/admin" },
];

let allServices = [];
let runningServices = [];
let activeFeedTab = "all";
let probeTimes = new Map();

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

function iconMeta(service) {
  return SERVICE_ICONS[service.label] || { emoji: service.name[0], color: "#3a4250" };
}

function iconHtml(service, className = "app-icon") {
  const meta = iconMeta(service);
  if (meta.domain) {
    return `<img class="${className}" src="https://www.google.com/s2/favicons?domain=${meta.domain}&sz=32" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','<span class=\\'${className} app-icon-fallback\\' style=\\'background:${meta.color}\\'>${meta.emoji}</span>')">`;
  }
  return `<span class="${className} app-icon-fallback" style="background:${meta.color}">${meta.emoji}</span>`;
}

function externalArrow(cls = "app-link-arrow") {
  return `<svg class="${cls}" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>`;
}

async function probe(service) {
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

function filteredServices(pool = allServices) {
  const query = searchInput.value.trim();
  return pool.filter((s) => matchesQuery(s, query));
}

function isUp(service) {
  return runningServices.some((s) => s.label === service.label);
}

function renderSidebar() {
  sidebarCategories.replaceChildren();
  const groups = groupByCategory(filteredServices());

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
      link.href = serviceUrl(service);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML = `
        ${iconHtml(service)}
        <span class="app-link-text">${service.name}</span>
        ${externalArrow()}
      `;
      block.appendChild(link);
    }

    sidebarCategories.appendChild(block);
  }
}

function renderFeedWidget() {
  const widget = document.createElement("article");
  widget.className = "widget widget--tall";

  const categories = ["all", ...CATEGORY_ORDER.filter((c) =>
    runningServices.some((s) => (s.category || "other") === c)
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

  let items = filteredServices(runningServices);
  if (activeFeedTab !== "all") {
    items = items.filter((s) => (s.category || "other") === activeFeedTab);
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  if (!items.length) {
    list.innerHTML = `<li class="empty-note">${runningServices.length ? "No matches" : "No services running — <code>bash scripts/start.sh all</code>"}</li>`;
  } else {
    for (const service of items) {
      const url = serviceUrl(service);
      const ms = probeTimes.get(service.label);
      const li = document.createElement("li");
      li.className = "feed-item";
      li.innerHTML = `
        <div class="feed-thumb">${iconHtml(service, "feed-thumb-icon")}</div>
        <div class="feed-body">
          <p class="feed-title"><a href="${url}" target="_blank" rel="noopener">${service.name}</a></p>
          <p class="feed-meta">${service.description} · :${service.port}${ms != null ? ` · ${ms}ms` : ""}</p>
        </div>
        <a class="feed-arrow" href="${url}" target="_blank" rel="noopener">${externalArrow("feed-arrow")}</a>
      `;
      list.appendChild(li);
    }
  }

  widget.appendChild(list);
  return widget;
}

function renderMediaWidget() {
  const widget = document.createElement("article");
  widget.className = "widget widget--tall";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">Media stack</span></div>`;

  const scroll = document.createElement("div");
  scroll.className = "media-scroll";

  const media = filteredServices(
    runningServices.filter((s) => s.category === "media")
  );

  if (!media.length) {
    scroll.innerHTML = `<p class="empty-note">Start Jellyfin, Seerr, or Immich to see media apps here.</p>`;
  } else {
    for (const service of media) {
      const url = serviceUrl(service);
      const meta = iconMeta(service);
      const card = document.createElement("a");
      card.className = "media-card";
      card.href = url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.innerHTML = `
        <div class="media-poster">
          ${meta.domain
            ? `<img src="https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64" alt="" loading="lazy">`
            : `<span class="media-poster-fallback">${meta.emoji}</span>`}
        </div>
        <div>
          <p class="media-name">${service.name}</p>
          <div class="media-tags">
            <span class="media-tag media-tag--green">ONLINE</span>
            <span class="media-tag">:${service.port}</span>
          </div>
          <p class="media-desc">${service.description}</p>
        </div>
      `;
      scroll.appendChild(card);
    }
  }

  widget.appendChild(scroll);
  return widget;
}

function renderScheduleWidget() {
  const widget = document.createElement("article");
  widget.className = "widget widget--tall";
  widget.innerHTML = `<div class="widget-head"><span class="widget-title">Stack schedule</span></div>`;

  const list = document.createElement("ul");
  list.className = "schedule-list";

  const items = filteredServices(allServices).sort((a, b) => a.name.localeCompare(b.name));

  if (!items.length) {
    list.innerHTML = `<li class="empty-note">No services configured.</li>`;
  } else {
    for (const service of items) {
      const up = isUp(service);
      const url = serviceUrl(service);
      const li = document.createElement("a");
      li.className = "schedule-item";
      li.href = url;
      li.target = "_blank";
      li.rel = "noopener noreferrer";
      li.innerHTML = `
        <span class="schedule-team"><span class="schedule-dot ${up ? "is-on" : "is-off"}"></span>${service.name}</span>
        <span class="schedule-mid">
          <span class="schedule-status${up ? "" : " is-off"}">${up ? "RUNNING" : "STOPPED"}</span>
          :${service.port}
        </span>
        <span class="schedule-team schedule-team--away">${service.description}</span>
      `;
      list.appendChild(li);
    }
  }

  widget.appendChild(list);
  return widget;
}

function renderCalendarWidget() {
  const widget = document.createElement("article");
  widget.className = "widget widget--tall";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = now.toLocaleDateString([], { month: "long", year: "numeric" });

  const head = document.createElement("div");
  head.className = "calendar-head";
  head.innerHTML = `<span class="calendar-month">${monthName}</span>`;
  widget.appendChild(head);

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

  widget.appendChild(grid);
  return widget;
}

function renderCenter() {
  centerWidgets.replaceChildren();
  centerWidgets.appendChild(renderFeedWidget());
  centerWidgets.appendChild(renderMediaWidget());
  centerWidgets.appendChild(renderScheduleWidget());
  centerWidgets.appendChild(renderCalendarWidget());
}

function findService(match) {
  return allServices.find((s) => s.label === match || s.label.includes(match));
}

function renderSystemIcons() {
  systemIcons.replaceChildren();
  for (const shortcut of SYSTEM_SHORTCUTS) {
    let service = findService(shortcut.match);
    if (!service && shortcut.port) {
      service = { label: shortcut.match, port: shortcut.port, path: shortcut.path || "" };
    }
    const up = service ? (shortcut.port ? true : isUp(service)) : false;
    const url = service ? serviceUrl({ ...service, port: service.port || shortcut.port, path: service.path || shortcut.path }) : "#";

    const link = document.createElement("a");
    link.className = `icon-shortcut${up ? "" : " is-off"}`;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.innerHTML = `
      <span class="icon-shortcut-mark">${shortcut.emoji}</span>
      ${shortcut.label}
    `;
    systemIcons.appendChild(link);
  }
}

function renderNetworkStats() {
  networkStats.replaceChildren();
  const pings = runningServices
    .map((s) => probeTimes.get(s.label))
    .filter((v) => v != null);
  const avgPing = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  const stats = [
    { label: "Online", value: String(runningServices.length), suffix: "" },
    { label: "Avg ping", value: avgPing != null ? `${avgPing}` : "—", suffix: "ms" },
    { label: "Total", value: String(allServices.length), suffix: "" },
  ];

  for (const stat of stats) {
    const el = document.createElement("div");
    el.className = "network-stat";
    el.innerHTML = `
      <span class="network-stat-value">${stat.value}${stat.suffix ? `<span style="font-size:8px;color:var(--text-muted)">${stat.suffix}</span>` : ""}</span>
      <span class="network-stat-label">${stat.label}</span>
    `;
    networkStats.appendChild(el);
  }
}

function renderAdminLinks() {
  adminLinks.replaceChildren();
  const items = filteredServices(allServices)
    .filter((s) => s.category === "tools" || s.category === "infrastructure")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const service of items) {
    const up = isUp(service);
    const li = document.createElement("li");
    li.innerHTML = `<a href="${serviceUrl(service)}" target="_blank" rel="noopener" class="${up ? "" : "is-off"}">
      <span>${service.name}</span>${externalArrow()}
    </a>`;
    adminLinks.appendChild(li);
  }
}

function renderNowPlaying() {
  nowPlaying.replaceChildren();
  const featured = runningServices.find((s) => s.label === "jellyfin")
    || runningServices.find((s) => s.category === "media")
    || runningServices[0];

  if (!featured) {
    nowPlaying.innerHTML = `<p class="empty-note" style="grid-column:1/-1;padding:0.5rem">Nothing running</p>`;
    return;
  }

  const meta = iconMeta(featured);
  const pct = Math.round(((runningServices.indexOf(featured) + 1) / runningServices.length) * 100);

  nowPlaying.innerHTML = `
    <div class="now-playing-thumb">${meta.emoji}</div>
    <div>
      <p class="now-playing-title">${featured.name}</p>
      <p class="now-playing-sub">${featured.description} · ${serviceUrl(featured).replace(/^https?:\/\//, "")}</p>
    </div>
    <div class="now-playing-bar"><div class="now-playing-fill" style="width:${pct}%"></div></div>
  `;
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const parts = [];
  if (day) parts.push(`${day} day${day !== 1 ? "s" : ""}`);
  parts.push(`${hr % 24} hr`);
  parts.push(`${min % 60} min`);
  return parts.join(", ");
}

function updateStats() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const yearProgress = ((now - yearStart) / (yearEnd - yearStart)) * 100;
  yearPct.textContent = `${Math.round(yearProgress)}%`;
  yearBar.style.width = `${yearProgress}%`;
  yearLabel.textContent = `${Math.round(yearProgress)}% of the year has passed`;

  const usedPct = allServices.length
    ? Math.round((runningServices.length / allServices.length) * 100)
    : 0;
  const leftPct = 100 - usedPct;
  storageUsedLabel.textContent = `USED ${usedPct}%`;
  storageLeftLabel.textContent = `${leftPct}% LEFT`;
  storageBar.style.width = `${usedPct}%`;
  storageCaption.textContent = `${runningServices.length} of ${allServices.length} stacks online`;

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayProgress = ((now - dayStart) / 86400000) * 100;
  dayBar.style.width = `${dayProgress}%`;

  const uptime = now - dayStart;
  statusText.textContent = `Session uptime ${formatDuration(uptime)} · ${runningServices.length} of ${allServices.length} stacks reachable on this host`;
}

function renderAll() {
  renderSidebar();
  renderCenter();
  renderSystemIcons();
  renderNetworkStats();
  renderAdminLinks();
  renderNowPlaying();
  updateStats();
}

async function loadDashboard() {
  refreshBtn.disabled = true;
  probeTimes.clear();

  const response = await fetch("services.json", { cache: "no-store" });
  allServices = await response.json();

  const results = await Promise.all(
    allServices.map(async (service) => ({
      service,
      up: await probe(service),
    }))
  );

  runningServices = results.filter(({ up }) => up).map(({ service }) => service);
  renderAll();
  refreshBtn.disabled = false;
}

searchInput.addEventListener("input", renderAll);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    renderAll();
    searchInput.blur();
  }
});

refreshBtn.addEventListener("click", loadDashboard);

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

loadDashboard();
setInterval(loadDashboard, 60000);
