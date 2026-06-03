const grid = document.getElementById("grid");
const domainLabel = document.getElementById("domain-label");
const refreshBtn = document.getElementById("refresh");
const searchInput = document.getElementById("search");

let runningServices = [];

function serviceUrl(service) {
  const host = service.host || "127.0.0.1";
  const path = service.path || "";
  return `http://${host}:${service.port}${path}`;
}

function serviceHaystack(service) {
  const url = serviceUrl(service);
  return [service.name, service.label, service.description, String(service.port), url]
    .join(" ")
    .toLowerCase();
}

function matchesQuery(service, query) {
  if (!query) return true;
  return serviceHaystack(service).includes(query.toLowerCase());
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(url, { mode: "no-cors", signal: controller.signal, cache: "no-store" });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function renderCard(service, index) {
  const url = serviceUrl(service);
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "card";
  a.href = url;
  a.style.animationDelay = `${index * 45}ms`;
  a.innerHTML = `
    <div class="card-head">
      <h2 class="card-name">${service.name}</h2>
      <span class="status is-up" title="Running"></span>
    </div>
    <p class="card-desc">${service.description}</p>
    <p class="card-url">${url.replace(/^https?:\/\//, "")}</p>
  `;
  li.appendChild(a);
  return li;
}

function renderEmpty(title, desc) {
  const li = document.createElement("li");
  li.className = "empty";
  li.innerHTML = `
    <p class="empty-title">${title}</p>
    <p class="empty-desc">${desc}</p>
  `;
  return li;
}

function renderGrid() {
  grid.replaceChildren();
  const query = searchInput.value.trim();
  const filtered = runningServices.filter((service) => matchesQuery(service, query));

  if (runningServices.length === 0) {
    grid.appendChild(
      renderEmpty(
        "No services running",
        'Start a stack, then refresh — e.g. <code>bash scripts/start.sh jellyfin</code>'
      )
    );
    return;
  }

  if (filtered.length === 0) {
    grid.appendChild(
      renderEmpty("No matches", `Nothing matches “${query}”. Try another term or clear the search.`)
    );
    return;
  }

  filtered.forEach((service, index) => {
    grid.appendChild(renderCard(service, index));
  });
}

async function loadDashboard() {
  domainLabel.textContent = window.location.host;

  const response = await fetch("services.json", { cache: "no-store" });
  const services = await response.json();

  const results = await Promise.all(
    services.map(async (service) => ({
      service,
      up: await probe(serviceUrl(service)),
    }))
  );

  runningServices = results
    .filter(({ up }) => up)
    .map(({ service }) => service)
    .sort((a, b) => a.name.localeCompare(b.name));

  renderGrid();
}

searchInput.addEventListener("input", renderGrid);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    renderGrid();
    searchInput.blur();
  }
});

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  loadDashboard().finally(() => {
    refreshBtn.disabled = false;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

loadDashboard();
