const PIPELINE_STAGES = [
  { key: "new", label: "Novo" },
  { key: "contacted", label: "Contactado" },
  { key: "replied", label: "Respondeu" },
  { key: "meeting_booked", label: "Reunião" },
  { key: "no_show", label: "No-show" },
  { key: "negotiating", label: "Negociação" },
  { key: "won", label: "Ganho" },
  { key: "lost", label: "Perdido" }
];

const MAX_LEADS_FETCH = 260;
const DASHBOARD_REFRESH_MS = 12000;
const SNAPSHOT_MAX_AGE_MS = 90000;

const state = {
  leads: [],
  selectedId: null,
  summary: null,
  health: null,
  filters: { q: "", priority: "", leadType: "", stage: "", platform: "", viewMode: "qualified" },
  ui: { leadsSignature: "", loadingLeads: false, running: false, iconRefreshQueued: false, toastTimer: null }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function iconRefresh() {
  if (!window.lucide || state.ui.iconRefreshQueued) return;
  state.ui.iconRefreshQueued = true;
  requestAnimationFrame(() => {
    window.lucide.createIcons();
    state.ui.iconRefreshQueued = false;
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortUrl(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 74);
  } catch {
    return String(url || "").slice(0, 74);
  }
}

async function api(path, options) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(state.ui.toastTimer);
  state.ui.toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function compactNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function filterQueryString({ includeLimit = false } = {}) {
  const params = new URLSearchParams();
  if (state.filters.viewMode === "raw") params.set("raw", "true");
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.priority) params.set("priority", state.filters.priority);
  if (state.filters.leadType) params.set("leadType", state.filters.leadType);
  if (state.filters.stage) params.set("stage", state.filters.stage);
  if (state.filters.platform) params.set("platform", state.filters.platform);
  if (includeLimit) params.set("limit", String(MAX_LEADS_FETCH));
  return params.toString();
}

function hasLiveFilters() {
  return state.filters.viewMode === "raw" || state.filters.q || state.filters.priority || state.filters.leadType || state.filters.stage || state.filters.platform;
}

function leadsSignature(leads = []) {
  return leads.map((lead) => [lead.id, lead.stage, lead.score, lead.contactConfidence, lead.lastSeen, lead.updatedAt].join(":")).join("|");
}

function snapshotHealth(summary = {}) {
  return {
    ok: true,
    counts: { working: summary.counts?.total || 0, contactable: summary.counts?.contactable || 0 },
    enrichmentQueue: { dueNow: 0 }
  };
}

async function loadStaticSnapshot() {
  if (hasLiveFilters()) return null;
  try {
    const bucket = Math.floor(Date.now() / 12000);
    const response = await fetch(`/ui-dashboard.json?v=${bucket}`, { cache: "no-store" });
    if (!response.ok) return null;
    const snapshot = await response.json();
    const generatedAt = Date.parse(snapshot.generatedAt || "");
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > SNAPSHOT_MAX_AGE_MS) return null;
    const summary = snapshot.summary || { counts: { total: snapshot.total || 0 }, rawTotal: snapshot.total || 0 };
    return {
      total: snapshot.total || 0,
      leads: (snapshot.leads || []).slice(0, MAX_LEADS_FETCH),
      summary,
      health: snapshotHealth(summary),
      run: { status: "idle", continuous: { status: "auto" } },
      snapshot: true
    };
  } catch {
    return null;
  }
}

function updateLastUpdated(value = new Date()) {
  const node = $("#lastUpdated");
  if (!node) return;
  const date = value instanceof Date ? value : new Date(value);
  node.textContent = `sync ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function applyDashboardData(data, { forceLeads = false } = {}) {
  state.summary = data.summary || null;
  state.health = data.health || null;
  renderSummary();
  renderHealth();
  renderRun(data.run || state.summary?.activeRun || {});
  updateLastUpdated(data.cachedAt || new Date());

  const leads = data.leads || [];
  const signature = leadsSignature(leads);
  const selectedBefore = state.selectedId;
  state.leads = leads;
  if (!state.selectedId && state.leads.length) state.selectedId = state.leads[0].id;
  if (state.selectedId && !state.leads.some((lead) => lead.id === state.selectedId)) state.selectedId = state.leads[0]?.id || null;
  const selectionChanged = selectedBefore !== state.selectedId;

  if (forceLeads || selectionChanged || signature !== state.ui.leadsSignature) {
    state.ui.leadsSignature = signature;
    renderLeads();
    renderDetail();
  }
}

async function loadDashboard({ forceLeads = false } = {}) {
  if (state.ui.loadingLeads) return;
  state.ui.loadingLeads = true;
  try {
    const snapshot = await loadStaticSnapshot();
    if (snapshot) {
      applyDashboardData(snapshot, { forceLeads });
      if (!state.ui.running) return;
    }
    const query = filterQueryString({ includeLimit: true });
    const data = await api(`/api/dashboard${query ? `?${query}` : ""}`);
    applyDashboardData(data, { forceLeads });
  } catch (error) {
    toast(error.message || "Erro ao carregar dashboard");
    throw error;
  } finally {
    state.ui.loadingLeads = false;
  }
}

function renderSummary() {
  const counts = state.summary?.counts || {};
  $("#metricTotalLabel").textContent = state.filters.viewMode === "raw" ? "Base filtrada" : "Qualificadas";
  $("#metricTotal").textContent = compactNumber(counts.total || 0);
  $("#metricRawTotal").textContent = compactNumber(state.summary?.rawTotal || counts.total || 0);
  $("#metricA").textContent = compactNumber(counts.priorityA || 0);
  $("#metricPartners").textContent = compactNumber(counts.partners || 0);
  $("#metricRecruitment").textContent = compactNumber(counts.recruitment || 0);
  $("#metricBooked").textContent = compactNumber(counts.booked || 0);
  $("#metricContactable").textContent = compactNumber(counts.contactable || 0);
  $("#metricEmailForm").textContent = compactNumber(Number(counts.emails || 0) + Number(counts.forms || 0));
  renderPlatformStrip();
}

function renderHealth() {
  const health = state.health;
  if (!health) return;
  const statusClass = health.ok ? "ok" : "bad";
  $("#systemHealth").innerHTML = `<span class="health-pill ${statusClass}"><i data-lucide="${health.ok ? "activity" : "alert-triangle"}"></i>${health.ok ? "ok" : "erro"}</span><span>${compactNumber(health.counts?.working)} working</span><span>${compactNumber(health.counts?.contactable)} contactáveis</span><span>${compactNumber(health.enrichmentQueue?.dueNow)} due</span>`;
  iconRefresh();
}

function renderRun(run = {}) {
  const continuous = run.continuous || {};
  const isRunning = run.status === "running" || continuous.status === "running" || continuous.status === "stopping";
  state.ui.running = isRunning;

  const badge = $("#runBadge");
  if (badge) {
    badge.textContent = isRunning ? "Running" : "Auto sourcing";
    badge.className = isRunning ? "status-pill live" : "status-pill muted";
  }

  $("#runMessage").textContent = isRunning
    ? "Sourcing e enrichment a correr em background."
    : "Automático quando o host está ligado.";

  const completed = Number(run.completedQueries || 0);
  const total = Number(run.totalQueries || 0);
  const pct = total ? Math.round((completed / total) * 100) : isRunning ? 42 : 0;
  $("#progressBar").style.width = `${Math.min(100, pct)}%`;
  renderRunEvents(run.events || []);
  iconRefresh();
}

function renderRunEvents(events = []) {
  const list = $("#eventList");
  if (!list) return;
  const event = events[0];
  if (!event) {
    list.innerHTML = `<span>Sem eventos recentes.</span>`;
    return;
  }
  const time = event.at ? new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now";
  list.innerHTML = `<span>${escapeHtml(time)} · ${escapeHtml(event.message || "Atualização do motor")}</span>`;
}

function platformLabel(value = "") { return value || "Web"; }
function platformClass(value = "") { return platformLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown"; }
function platformForLead(lead = {}) { return lead.platform || "Web"; }
function countryLabel(value = "") { return value || "Global"; }

function renderPlatformStrip() {
  const byPlatform = state.summary?.byPlatform || {};
  const entries = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]);
  const nonMql5Count = entries.filter(([name]) => !/mql5/i.test(name)).reduce((sum, [, count]) => sum + count, 0);
  const socialCount = entries.filter(([name]) => /linkedin|instagram|x\/twitter|telegram|discord|tiktok|facebook|threads|reddit/i.test(name)).reduce((sum, [, count]) => sum + count, 0);
  const specialistCount = entries.filter(([name]) => /mql5|myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips/i.test(name)).reduce((sum, [, count]) => sum + count, 0);
  const buttons = [
    ["", "Todas", state.summary?.counts?.total || 0],
    ["non-mql5", "Sem MQL5", nonMql5Count],
    ["social", "Social/DM", socialCount],
    ["specialist", "Especialistas", specialistCount],
    ...entries.map(([name, count]) => [name, name, count])
  ];
  $("#platformStrip").innerHTML = buttons
    .filter(([, , count], index) => index === 0 || Number(count || 0) > 0)
    .slice(0, 16)
    .map(([value, label, count]) => {
      const active = String(state.filters.platform || "") === String(value || "") ? "active" : "";
      return `<button class="source-chip ${active}" data-platform="${escapeHtml(value)}" type="button"><span>${escapeHtml(label)}</span><strong>${compactNumber(count || 0)}</strong></button>`;
    })
    .join("");
  $$("#platformStrip .source-chip").forEach((button) => button.addEventListener("click", async () => {
    state.filters.platform = button.dataset.platform || "";
    const filter = $("#platformFilter");
    if (filter) filter.value = state.filters.platform;
    resetLeadView();
    await loadDashboard({ forceLeads: true });
  }));
}

function typeLabel(value = "") {
  const labels = { partner: "Parceiro", institution: "Instituição", recruitment: "Recruta", research: "Pesquisa" };
  return labels[String(value).toLowerCase()] || value || "Pesquisa";
}
function stageLabel(value = "") {
  const labels = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage.key, stage.label]));
  return labels[String(value || "new").toLowerCase()] || String(value || "new").replace(/_/g, " ");
}
function stageKey(value = "") {
  const key = String(value || "new").toLowerCase();
  return PIPELINE_STAGES.some((stage) => stage.key === key) ? key : "new";
}
function segmentLabel(value = "") {
  const labels = {
    "Fund / Asset Manager": "Fundos / Asset Manager",
    "Event / Expo": "Eventos",
    "Prop / Funded Trading": "Prop / Funded",
    "IB / Partner": "IB / Parceiro",
    "High-Calibre Trader": "Trader Pro",
    "Trading Education": "Educação",
    Affiliate: "Afiliado",
    Community: "Comunidade",
    "Creator / Influencer": "Criador",
    "Broker-Seeking / Intent Post": "Procura corretora",
    "Broker Talent": "Talento broker"
  };
  return labels[value] || value || "";
}
function priorityClass(priority) { return String(priority || "d").toLowerCase(); }
function contactConfidence(lead = {}) { return Math.max(0, Math.min(100, Number(lead.contactConfidence || 0))); }
function leadTitle(lead = {}) {
  const value = lead.name || lead.title || "Untitled";
  return String(value)
    .replace(/^\)?\s*\/\s*posts\s*\/\s*x(?:\s*-\s*twitter)?/i, "X profile/post")
    .replace(/^thread\s*›\s*/i, "ForexFactory thread: ")
    .replace(/^past-events\s*›\s*/i, "Event: ");
}

function selectedLeadClass(lead) {
  return lead.id === state.selectedId ? "selected" : "";
}

function leadRow(lead) {
  const confidence = contactConfidence(lead);
  const title = leadTitle(lead);
  const source = platformForLead(lead);
  return `<div class="table-row lead-row ${selectedLeadClass(lead)}" data-id="${escapeHtml(lead.id)}">
    <div class="lead-main-cell"><strong>${escapeHtml(title)}</strong><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div>
    <div><span class="source-pill ${platformClass(source)}">${escapeHtml(source)}</span></div>
    <div><span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span></div>
    <div class="muted-cell">${escapeHtml(segmentLabel(lead.segment) || countryLabel(lead.country))}</div>
    <div class="score-cell">${Number(lead.score || 0)}</div>
    <div class="confidence-cell"><span>${confidence}%</span><i style="width:${confidence}%"></i></div>
    <div><span class="stage-pill">${escapeHtml(stageLabel(lead.stage))}</span></div>
  </div>`;
}

function renderLeads() {
  const total = state.leads.length;
  const rows = state.leads.map(leadRow).join("");
  $("#leadRows").innerHTML = `<div class="lead-table">
    <div class="table-row table-head"><span>Lead</span><span>Fonte</span><span>Tipo</span><span>Segmento</span><span>Score</span><span>Contacto</span><span>Estado</span></div>
    ${rows || `<div class="empty-table">${total ? "Sem resultados nesta vista." : "Ainda não há leads nesta vista."}</div>`}
  </div>`;
  $$(".lead-row").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    selectLead(row.dataset.id);
  }));
  iconRefresh();
}

function selectLead(id) {
  state.selectedId = id;
  $$(".lead-row").forEach((row) => row.classList.toggle("selected", row.dataset.id === id));
  renderDetail();
}

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function renderLinkList(title, links = []) {
  const clean = uniqueList(links).slice(0, 8);
  if (!clean.length) return "";
  return `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="link-list">${clean.map((link) => `<a class="mini-chip" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(link))}</a>`).join("")}</div></div>`;
}

function contactTypeLabel(value = "") {
  const labels = { email: "Email", whatsapp: "WhatsApp", phone: "Telefone", form: "Formulário", social: "Social/DM", website: "Website", "direct-link": "Link direto" };
  return labels[String(value).toLowerCase()] || value || "Contacto";
}
function contactHref(contact = "", type = "") {
  if (/^https?:\/\//i.test(contact)) return contact;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (type === "phone" || type === "whatsapp") return `tel:${contact.replace(/[^+\d]/g, "")}`;
  return "";
}
function contactDisplay(contact = "") { return /^https?:\/\//i.test(contact) ? shortUrl(contact) : contact; }

function renderBestContact(lead = {}) {
  const contact = lead.bestContact || "";
  if (!contact) return "";
  const type = lead.bestContactType || lead.contactQuality || "";
  const href = contactHref(contact, type);
  const source = lead.bestContactSource || "";
  const contactNode = href ? `<a class="contact-value" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(contactDisplay(contact))}</a>` : `<span class="contact-value">${escapeHtml(contact)}</span>`;
  return `<div class="detail-section primary-contact"><h3>Melhor contacto</h3><div class="contact-line"><span class="priority-pill a">${escapeHtml(contactTypeLabel(type))}</span><span class="mini-chip">${Number(lead.contactConfidence || 0)}%</span></div>${contactNode}${source ? `<p>Fonte: ${escapeHtml(contactDisplay(source))}</p>` : ""}</div>`;
}

function renderForms(forms = []) {
  const clean = forms.slice(0, 4);
  if (!clean.length) return "";
  return `<div class="detail-section"><h3>Formulários</h3><div class="link-list">${clean.map((form) => `<a class="mini-chip" href="${escapeHtml(form.pageUrl || form.action || "")}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(form.pageUrl || form.action || ""))}</a>`).join("")}</div></div>`;
}

function renderDetail() {
  const lead = state.leads.find((item) => item.id === state.selectedId);
  const panel = $("#detailPanel");
  if (!lead) {
    panel.innerHTML = `<div class="empty-state"><i data-lucide="mouse-pointer-2"></i><p>Seleciona uma lead para abrir o dossiê comercial.</p></div>`;
    iconRefresh();
    return;
  }
  const emails = uniqueList(lead.emails || []);
  const languages = uniqueList(lead.languages || []);
  const evidence = uniqueList(lead.evidence || []);
  const socialLinks = uniqueList(lead.socialLinks || []);
  const contactLinks = uniqueList(lead.contactLinks || []);
  const websiteLinks = uniqueList(lead.websiteLinks || []);
  const phoneNumbers = uniqueList(lead.phoneNumbers || []);
  const forms = lead.forms || [];

  panel.innerHTML = `<div class="detail-header">
    <div class="detail-meta"><span class="priority-pill ${priorityClass(lead.priority)}">Lead ${escapeHtml(lead.priority || "D")}</span><span class="stage-pill">${escapeHtml(stageLabel(lead.stage))}</span><span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span></div>
    <h2>${escapeHtml(leadTitle(lead))}</h2>
    <a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a>
  </div>
  <div class="detail-section"><h3>Pipeline</h3><label class="field stage-select"><span>Estado comercial</span><select id="detailStage">${PIPELINE_STAGES.map((stage) => `<option value="${stage.key}" ${stage.key === stageKey(lead.stage) ? "selected" : ""}>${stage.label}</option>`).join("")}</select></label><div class="detail-meta"><span class="mini-chip">Score ${Number(lead.score || 0)}</span><span class="mini-chip">Contacto ${lead.contactConfidence || 0}%</span><span class="mini-chip">${escapeHtml(segmentLabel(lead.segment) || "Pesquisa")}</span><span class="mini-chip">${escapeHtml(countryLabel(lead.country))}</span>${languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join("")}</div></div>
  ${renderBestContact(lead)}
  <div class="detail-section"><h3>Contexto</h3><p>${escapeHtml(lead.snippet || "No snippet captured.")}</p></div>
  ${evidence.length ? `<div class="detail-section"><h3>Sinais</h3><div class="evidence-list">${evidence.slice(0, 10).map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("")}</div></div>` : ""}
  ${emails.length ? `<div class="detail-section"><h3>Email</h3><div class="link-list">${emails.slice(0, 6).map((email) => `<a class="mini-chip" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join("")}</div></div>` : ""}
  ${phoneNumbers.length ? `<div class="detail-section"><h3>Telefones</h3><div class="link-list">${phoneNumbers.slice(0, 6).map((phone) => `<span class="mini-chip">${escapeHtml(phone)}</span>`).join("")}</div></div>` : ""}
  ${renderForms(forms)}${renderLinkList("Social", socialLinks)}${renderLinkList("Contact paths", contactLinks)}${renderLinkList("Websites", websiteLinks)}`;

  $("#detailStage").addEventListener("change", async (event) => updateLeadStage(lead.id, event.target.value));
  iconRefresh();
}

async function updateLeadStage(id, stage) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || stageKey(lead.stage) === stage) return;
  await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
  state.selectedId = id;
  state.ui.leadsSignature = "";
  await loadDashboard({ forceLeads: true });
}

function resetLeadView() {
  state.selectedId = null;
  state.ui.leadsSignature = "";
}

function bindControls() {
  $("#searchInput").addEventListener("input", (event) => {
    state.filters.q = event.target.value;
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(() => {
      resetLeadView();
      loadDashboard({ forceLeads: true }).catch((error) => console.error(error));
    }, 380);
  });
  $("#viewModeFilter").addEventListener("change", async (event) => { state.filters.viewMode = event.target.value; resetLeadView(); await loadDashboard({ forceLeads: true }); });
  $("#platformFilter").addEventListener("change", async (event) => { state.filters.platform = event.target.value; resetLeadView(); await loadDashboard({ forceLeads: true }); });
  $("#priorityFilter").addEventListener("change", async (event) => { state.filters.priority = event.target.value; resetLeadView(); await loadDashboard({ forceLeads: true }); });
  $("#typeFilter").addEventListener("change", async (event) => { state.filters.leadType = event.target.value; resetLeadView(); await loadDashboard({ forceLeads: true }); });
  $("#stageFilter").addEventListener("change", async (event) => { state.filters.stage = event.target.value; resetLeadView(); await loadDashboard({ forceLeads: true }); });
}

bindControls();
iconRefresh();
loadDashboard({ forceLeads: true }).catch((error) => console.error(error));
setInterval(() => {
  if (document.visibilityState === "hidden") return;
  loadDashboard().catch((error) => console.error(error));
}, DASHBOARD_REFRESH_MS);
