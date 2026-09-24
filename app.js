const items = document.querySelectorAll(".rail-item");
const railPath = document.getElementById("rail-edge");
const railGlow = document.getElementById("rail-glow");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let bases = [];
let amplitude = 48;
let breathing = false;

function curveX(y, amp) {
  const t = Math.min(1, Math.max(0, y / 1000));
  return 58 + amp * Math.sin(Math.PI * t);
}

function buildPath(amp) {
  const steps = 56;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const y = 16 + (i / steps) * 968;
    const x = curveX(y, amp);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  railPath.setAttribute("d", d);
  railGlow.setAttribute("d", d);
}

function captureBases() {
  items.forEach((item) => {
    item.style.transform = "none";
  });
  const shape = document.querySelector(".sider-shape").getBoundingClientRect();
  bases = [...items].map((item) => {
    const icon = item.querySelector(".rail-icon").getBoundingClientRect();
    return {
      item,
      cx: icon.left + icon.width / 2,
      y: ((icon.top + icon.height / 2 - shape.top) / shape.height) * 1000,
    };
  });
}

function applyPositions(amp) {
  const shape = document.querySelector(".sider-shape").getBoundingClientRect();
  bases.forEach(({ item, cx, y }) => {
    const edge = shape.left + (curveX(y, amp) / 200) * shape.width;
    item.style.transform = `translateX(${edge - cx}px)`;
  });
}

function frame(now) {
  if (!breathing) return;
  amplitude = 48 + Math.sin(now / 2400) * 5;
  buildPath(amplitude);
  applyPositions(amplitude);
  requestAnimationFrame(frame);
}

buildPath(amplitude);
captureBases();

if (reduceMotion) {
  applyPositions(amplitude);
} else {
  items.forEach((item, index) => {
    item.style.transitionDelay = `${0.08 + index * 0.07}s`;
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => applyPositions(amplitude));
  });
  window.setTimeout(() => {
    items.forEach((item) => {
      item.style.transition = "none";
    });
    breathing = true;
    requestAnimationFrame(frame);
  }, 1700);
}

window.addEventListener("resize", () => {
  const wasBreathing = breathing;
  breathing = false;
  items.forEach((item) => {
    item.style.transition = "none";
  });
  captureBases();
  applyPositions(amplitude);
  if (wasBreathing && !reduceMotion) {
    breathing = true;
    requestAnimationFrame(frame);
  }
});

const form = document.querySelector(".search");
const input = document.querySelector("#q");
const driveState = document.querySelector(".drive-state");
const view = document.getElementById("view");
const hero = document.querySelector(".hero");
const stage = document.querySelector("main");
const API = location.port === "8000" ? "" : "http://127.0.0.1:8000";
const pages = ["home", "services", "clients", "projects", "industries", "solutions", "about", "contact", "connections", "health", "profile", "search"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function token() {
  return sessionStorage.getItem("agara_token") || "";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (options.json) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.json);
  }
  const response = await fetch(`${API}${path}`, { method: options.method || "GET", headers, body: options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((item) => item.msg).join(" ") : "Request failed";
    throw new Error(message || "Request failed");
  }
  return data;
}

function page(kicker, title, copy, body) {
  view.innerHTML = `<header class="page-head"><div class="page-intro"><p class="page-kicker">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p class="page-copy">${escapeHtml(copy)}</p></div><form class="entry page-search" id="page-search"><input name="q" type="search" placeholder="Search the knowledge base" value="${escapeHtml(sessionStorage.getItem("agara_query") || "")}" /></form></header>${body}`;
  document.getElementById("page-search").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") || "").trim();
    if (!query) return;
    sessionStorage.setItem("agara_query", query);
    input.value = query;
    go("search");
  });
}

function records(itemsHtml) {
  return `<div class="record-grid">${itemsHtml}</div>`;
}

function record(title, body, meta) {
  return `<article class="card"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""}</article>`;
}

function show(name) {
  if (name === "settings") name = "profile";
  const pageName = pages.includes(name) ? name : "home";
  hero.hidden = pageName !== "home";
  view.hidden = pageName === "home";
  stage.classList.toggle("is-page", pageName !== "home");
  items.forEach((item) => item.classList.toggle("is-active", item.dataset.view === pageName));
  if (pageName !== "home") render(pageName);
}

async function render(name) {
  view.innerHTML = `<p class="page-copy">Loading…</p>`;
  try {
    if (name === "services") return renderServices();
    if (name === "clients") return renderClients();
    if (name === "projects") return renderProjects();
    if (name === "industries") return renderIndustries();
    if (name === "solutions") return renderSolutions();
    if (name === "about") return renderAbout();
    if (name === "contact") return renderContact();
    if (name === "connections") return renderConnections();
    if (name === "health") return renderHealth();
    if (name === "profile") return renderProfile();
    if (name === "search") return renderSearch();
  } catch (error) {
    view.innerHTML = `<p class="notice">${escapeHtml(error.message)}. Start the knowledge service on port 8000 and try again.</p>`;
  }
}

async function renderServices() {
  const rows = await api("/api/services");
  page(
    "Capabilities",
    "Services",
    "These are services the company can provide. They are not a record of completed work.",
    records(rows.map((row) => record(row.name, row.description, row.category)).join(""))
  );
}

async function renderClients() {
  const rows = await api("/api/clients");
  const list = rows.length
    ? records(rows.map((row) => record(row.name, row.relationship || row.services || "Verified client", [row.industry, row.country].filter(Boolean).join(" · "))).join(""))
    : `<p class="notice">No verified clients are on record yet.</p>`;
  page("Verified relationships", "Clients", "Only companies stored in the knowledge base appear here.", list + clientForm());
  bindClientForm();
}

function clientForm() {
  if (!token()) return "";
  return `<form class="entry" id="client-form">
    <input name="name" placeholder="Company name" required />
    <input name="industry" placeholder="Industry" />
    <input name="country" placeholder="Country" />
    <textarea name="relationship" placeholder="Verified relationship" required></textarea>
    <button type="submit">Add client</button>
  </form>`;
}

function bindClientForm() {
  const formEl = document.getElementById("client-form");
  if (!formEl) return;
  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    await api("/api/clients", { method: "POST", json: data });
    renderClients();
  });
}

async function renderProjects() {
  const rows = await api("/api/projects");
  const list = rows.length
    ? records(rows.map((row) => record(row.name, row.description || "Verified project", [row.client, row.location, row.status].filter(Boolean).join(" · "))).join(""))
    : `<p class="notice">No verified projects are on record yet.</p>`;
  page("Verified work", "Projects", "A project appears here only after it is recorded. Recommendations are not listed as projects.", list + projectForm());
  bindProjectForm();
}

function projectForm() {
  if (!token()) return "";
  return `<form class="entry" id="project-form">
    <input name="name" placeholder="Project name" required />
    <input name="client_name" placeholder="Client" />
    <input name="industry" placeholder="Industry" />
    <input name="location" placeholder="Location" />
    <select name="status">
      <option>Opportunity</option><option>In Discussion</option><option>Active</option><option>Completed</option><option>On Hold</option><option>Confidential</option>
    </select>
    <textarea name="description" placeholder="What was actually done" required></textarea>
    <button type="submit">Add project</button>
  </form>`;
}

function bindProjectForm() {
  const formEl = document.getElementById("project-form");
  if (!formEl) return;
  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(formEl));
    if (data.status === "Confidential") data.confidential = true;
    await api("/api/projects", { method: "POST", json: data });
    renderProjects();
  });
}

async function renderIndustries() {
  const rows = await api("/api/industries");
  page("Sectors", "Industries", "Industries describe where the company can work. Each card is a sector overview, not a record of completed work.", records(rows.map((row) => record(row.name, row.overview)).join("")));
}

async function renderSolutions() {
  const rows = await api("/api/solutions");
  page(
    "Recommendations",
    "Solutions",
    "A solution combines services for a problem. It is not proof that the work has already been done.",
    records(rows.map((row) => record(row.name, row.summary, row.services)).join(""))
  );
}

function renderAbout() {
  page(
    "Company",
    "About us",
    "Stratgon Agara Global helps clients navigate complexity while keeping the path to a decision clear.",
    `<div class="record-grid">
      ${record("What we do", "Services describe current capabilities: government relations, project development, infrastructure, energy, ESG, and market entry.")}
      ${record("What we have done", "Projects and clients appear only when a verified record exists in the knowledge base.")}
      ${record("What we can propose", "Solutions combine services for a new request. They are labeled as recommendations.")}
    </div>`
  );
}

function renderContact() {
  page(
    "Talk to the team",
    "Contact",
    "Send a requirement. It is stored in the company audit log.",
    `<form class="entry" id="contact-form">
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <textarea name="message" placeholder="What do you need help with?" required></textarea>
      <button type="submit">Send</button>
      <p class="notice" id="contact-note"></p>
    </form>`
  );
  document.getElementById("contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.getElementById("contact-note");
    try {
      await api("/api/contact", { method: "POST", json: Object.fromEntries(new FormData(event.currentTarget)) });
      note.textContent = "Message received.";
      event.currentTarget.reset();
    } catch (error) {
      note.textContent = error.message;
    }
  });
}

async function renderConnections() {
  const rows = await api("/api/integrations");
  const drive = rows[0];
  const signedIn = Boolean(token());
  page(
    "Data sources",
    "Connections",
    "A source is connected only after authentication succeeds. Google Drive stays disconnected until OAuth credentials are configured.",
    `<article class="card"><h2>${escapeHtml(drive.name)}</h2><p>${escapeHtml(drive.detail || "No documents have been synced.")}</p><span class="meta">${escapeHtml(drive.status)} · ${drive.record_count || 0} records</span>${drive.error ? `<p class="notice">${escapeHtml(drive.error)}</p>` : ""}</article>
    <form class="entry" id="drive-form">
      <button type="submit">Connect Google Drive</button>
      ${signedIn && drive.status === "connected" ? `<button type="button" id="drive-sync">Sync now</button>` : ""}
      <p class="notice" id="drive-note"></p>
    </form>
    ${signedIn ? `<form class="entry" id="upload-form"><input type="file" name="file" accept=".txt,.csv,.md" required /><button type="submit">Upload a text document</button><p class="notice" id="upload-note"></p></form>` : ""}`
  );
  document.getElementById("drive-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!token()) {
      document.getElementById("drive-note").textContent = "Google Drive connection will be available with the login page.";
      return;
    }
    const note = document.getElementById("drive-note");
    try {
      const result = await api("/api/integrations/google-drive/connect", { method: "POST" });
      note.textContent = result.message || result.authorization_url || `Status: ${result.status}`;
      refreshDrive();
    } catch (error) {
      note.textContent = error.message;
    }
  });
  document.getElementById("drive-sync")?.addEventListener("click", async () => {
    const note = document.getElementById("drive-note");
    try {
      const result = await api("/api/integrations/google-drive/sync", { method: "POST" });
      note.textContent = `Sync status: ${result.status || "done"}`;
      refreshDrive();
      renderConnections();
    } catch (error) {
      note.textContent = error.message;
    }
  });
  document.getElementById("upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = document.getElementById("upload-note");
    const body = new FormData(event.currentTarget);
    const headers = token() ? { Authorization: `Bearer ${token()}` } : {};
    const response = await fetch(`${API}/api/documents`, { method: "POST", headers, body });
    const data = await response.json().catch(() => ({}));
    note.textContent = response.ok ? `Indexed in ${data.chunks} sections.` : data.detail || "Upload failed";
  });
}

async function renderHealth() {
  const data = await api("/api/health");
  page(
    "System",
    "System health",
    "Live status from the knowledge service.",
    data.components.map((item) => `<div class="health-row"><span>${escapeHtml(item.name)}</span><span>${escapeHtml(item.status)}</span></div>`).join("")
  );
}

function photoUrl() {
  return localStorage.getItem("agara_photo") || "";
}

function applyUserPhoto() {
  const url = photoUrl();
  const button = document.querySelector(".user-btn");
  const image = button?.querySelector(".user-photo");
  if (!button || !image) return;
  image.src = url;
  button.classList.toggle("has-photo", Boolean(url));
}

function storePhoto(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const source = new Image();
    source.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const scale = Math.max(size / source.width, size / source.height);
      const width = source.width * scale;
      const height = source.height * scale;
      canvas.getContext("2d").drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
      localStorage.setItem("agara_photo", canvas.toDataURL("image/jpeg", 0.86));
      applyUserPhoto();
      renderProfile();
    };
    source.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderProfile() {
  const url = photoUrl();
  page(
    "Profile",
    "Your profile",
    "Add a photo now. It replaces the icon on the profile button.",
    `<div class="profile-card">
      <div class="profile-photo${url ? " has-photo" : ""}" id="profile-photo">
        <img alt="" src="${escapeHtml(url)}" />
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.1"/><path d="M5.2 19.2c1.1-3 3.4-4.5 6.8-4.5s5.7 1.5 6.8 4.5"/></svg>
      </div>
      <div>
        <div class="profile-actions">
          <button type="button" class="text-btn" id="profile-pick">${url ? "Change photo" : "Add photo"}</button>
          ${url ? `<button type="button" class="text-btn" id="profile-remove">Remove</button>` : ""}
        </div>
        <input id="profile-file" type="file" accept="image/*" hidden />
      </div>
    </div>`
  );
  const file = document.getElementById("profile-file");
  document.getElementById("profile-pick").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    if (chosen) storePhoto(chosen);
  });
  document.getElementById("profile-remove")?.addEventListener("click", () => {
    localStorage.removeItem("agara_photo");
    applyUserPhoto();
    renderProfile();
  });
}

async function renderSearch() {
  const query = sessionStorage.getItem("agara_query") || "";
  if (!query) {
    page("Search result", "Search", "Enter a request in the search field.", "");
    return;
  }
  const data = await api("/api/search", { method: "POST", json: { query } });
  const blocks = [
    ...data.verified.services.map((item) => record(item.name, item.description, "Capability")),
    ...data.verified.industries.map((item) => record(item.name, item.overview, "Industry")),
    ...data.verified.projects.map((item) => record(item.name, item.description, `Verified project · ${item.status}`)),
    ...data.verified.clients.map((item) => record(item.name, item.relationship || item.description, "Verified client")),
    ...data.recommendations.solutions.map((item) => record(item.name, item.summary, "Recommendation")),
  ].join("");
  const sources = data.sources.map((item) => `${item.integration} → ${item.document}`).join(" · ");
  page(
    "Search result",
    query,
    data.answer,
    `${records(blocks || record("No direct match", data.gaps[0] || "Nothing matched.", ""))}<p class="notice">${escapeHtml(data.gaps.join(" "))}</p><p class="notice">Sources: ${escapeHtml(sources || "None")}</p><button type="button" class="text-btn" id="brief-btn">Prepare meeting brief</button><div id="brief"></div>`
  );
  document.getElementById("brief-btn").addEventListener("click", async () => {
    const brief = document.getElementById("brief");
    brief.innerHTML = `<p class="notice">Preparing…</p>`;
    try {
      const result = await api("/api/briefs", { method: "POST", json: { query } });
      brief.innerHTML = `<div class="record-grid">
        ${record("Capabilities", result.capabilities.join(", ") || "None on record", "What the company can do")}
        ${record("Verified projects", result.projects.join(", ") || "None on record", "What has been done")}
        ${record("Verified clients", result.clients.join(", ") || "None on record", "Who is on record")}
        ${record("Possible solution", result.potential_solution.join(", ") || "None suggested", "Not a past engagement")}
      </div><p class="notice">Questions: ${escapeHtml(result.questions.join(" "))}</p><p class="notice">Next steps: ${escapeHtml(result.next_steps.join(" "))}</p>`;
    } catch (error) {
      brief.innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`;
    }
  });
}

function go(name) {
  if (location.hash !== `#${name}`) location.hash = name;
  else show(name);
}

items.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    go(item.dataset.view);
  });
});

document.querySelectorAll(".card[href^='#']").forEach((card) => {
  card.addEventListener("click", (event) => {
    event.preventDefault();
    go(card.getAttribute("href").slice(1));
  });
});

document.querySelector(".drive-chip")?.addEventListener("click", () => go("connections"));
document.getElementById("system-status")?.addEventListener("click", () => go("health"));
document.querySelectorAll(".status-icon").forEach((button) => {
  button.addEventListener("click", () => go(button.dataset.go));
});
document.querySelector(".user-btn")?.addEventListener("click", () => go("profile"));

const gear = document.querySelector(".gear-btn");
const settingsPop = document.getElementById("settings-pop");

function setPop(open) {
  settingsPop.hidden = !open;
  gear.classList.toggle("is-open", open);
  gear.setAttribute("aria-expanded", open ? "true" : "false");
}

gear?.addEventListener("click", (event) => {
  event.stopPropagation();
  setPop(settingsPop.hidden);
});

document.addEventListener("click", (event) => {
  if (!settingsPop || settingsPop.hidden) return;
  if (settingsPop.contains(event.target) || gear.contains(event.target)) return;
  setPop(false);
});

settingsPop?.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    setPop(false);
    go(button.dataset.go);
  });
});
document.querySelector(".brand")?.addEventListener("click", (event) => {
  event.preventDefault();
  go("home");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  sessionStorage.setItem("agara_query", query);
  go("search");
});

window.addEventListener("hashchange", () => show((location.hash || "#home").slice(1)));
show((location.hash || "#home").slice(1));

async function refreshDrive() {
  if (!driveState) return;
  try {
    const [drive] = await api("/api/integrations");
    const labels = { connected: "Connected", syncing: "Syncing", connecting: "Connecting", error: "Error", not_connected: "Not connected" };
    const colors = { connected: "#22c55e", syncing: "#eab308", connecting: "#eab308", error: "#ef4444", not_connected: "#b0b5bc" };
    driveState.lastChild.textContent = ` ${labels[drive.status] || "Not connected"}`;
    driveState.style.color = drive.status === "connected" ? "#1a9d45" : "#8b9199";
    const dot = driveState.querySelector("i");
    if (dot) dot.style.background = colors[drive.status] || colors.not_connected;
    document.querySelector(".drive-chip")?.setAttribute("aria-label", `Google Drive, ${labels[drive.status] || "Not connected"}`);
  } catch {
    driveState.lastChild.textContent = " Not connected";
  }
}

function markIcon(id, state, label) {
  const icon = document.getElementById(id);
  if (!icon) return;
  icon.classList.remove("is-ok", "is-warn", "is-bad");
  icon.classList.add(state);
  icon.title = label;
  icon.setAttribute("aria-label", label);
}

async function refreshHealth() {
  const label = document.getElementById("status-label");
  const dot = document.querySelector("#system-status i");
  if (!label) return;
  try {
    const data = await api("/api/health");
    const status = Object.fromEntries(data.components.map((item) => [item.name, item.status]));
    const database = status.Database || "error";
    const drive = status["Google Drive"] || "not_connected";
    markIcon("status-network", "is-ok", "Network is reachable");
    markIcon("status-database", database === "operational" ? "is-ok" : "is-bad", `Database is ${database}`);
    markIcon(
      "status-cloud",
      drive === "connected" ? "is-ok" : drive === "error" ? "is-bad" : "is-warn",
      drive === "connected" ? "Google Drive is connected" : drive === "error" ? "Google Drive has an error" : "Google Drive is not connected"
    );
    const failed = data.components.some((item) => item.status === "error") || database !== "operational";
    label.textContent = failed ? "A system needs attention" : drive === "connected" ? "All systems operational" : "Core systems operational";
    if (dot) dot.style.background = failed ? "#ef4444" : "#3dcc6a";
  } catch {
    markIcon("status-network", "is-bad", "Network is offline");
    markIcon("status-database", "is-bad", "Database is unreachable");
    markIcon("status-cloud", "is-bad", "Google Drive status is unknown");
    label.textContent = "Knowledge service offline";
    if (dot) dot.style.background = "#b0b5bc";
  }
}

refreshHealth();
refreshDrive();
applyUserPhoto();
