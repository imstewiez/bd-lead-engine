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

const MAX_LEADS_FETCH = 220;
const MAX_CARDS_PER_LANE = 45;
const DASHBOARD_REFRESH_MS = 15000;
const LEADS_REFRESH_WHEN_RUNNING_MS = 45000;
const SNAPSHOT_MAX_AGE_MS = 90000;

const state = {
  leads: [],
  selectedId: null,
  summary: null,
  health: null,
  filters: { q: "", priority: "", leadType: "", stage: "", platform: "", viewMode: "qualified" },
  ui: { leadsSignature: "", lastLeadFetchAt: 0, loadingLeads: false, dragging: false, running: false, iconRefreshQueued: false, toastTimer: null }
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
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 78);
  } catch {
    return String(url || "").slice(0, 78);
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
  state.ui.toastTimer = setTimeout(() => node.classList.remove("show"), 2800);
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
      run: { status: "idle" },
      snapshot: true
    };
  } catch {
    return null;
  }
}

function updateExportLinks() {
  const query = filterQueryString();
  const suffix = query ? `?${query}` : "";
  $("#exportCsvLink")?.setAttribute("href", `/api/export.csv${suffix}`);
  $("#exportJsonLink")?.setAttribute("href", `/api/export.json${suffix}`);
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
  updateExportLinks();
  updateLastUpdated(data.cachedAt || data.snapshot?.generatedAt || new Date());
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
  state.ui.lastLeadFetchAt = Date.now();
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

async function loadRun() {
  const run = await api("/api/run");
  renderRun(run);
}

function renderSummary() {
  const counts = state.summary?.counts || {};
  $("#metricTotalLabel").textContent = state.filters.viewMode === "raw" ? "Base total" : "Qualificadas";
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
  $("#systemHealth").innerHTML = `<span class="health-pill ${statusClass}"><i data-lucide="${health.ok ? "sparkles" : "alert-triangle"}"></i>${health.ok ? "Motor ok" : "A rever"}</span><span><strong>${compactNumber(health.counts?.working)}</strong> working</span><span><strong>${compactNumber(health.counts?.contactable)}</strong> contactáveis</span><span><strong>${compactNumber(health.enrichmentQueue?.dueNow)}</strong> due</span>`;
  iconRefresh();
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
    .slice(0, 18)
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

function renderRun(run = {}) {
  const badge = $("#runBadge");
  const continuous = run.continuous || {};
  const isRunning = run.status === "running" || continuous.status === "running" || continuous.status === "stopping";
  state.ui.running = isRunning;
  if (badge) {
    badge.textContent = isRunning ? "Autopilot ativo" : "Pronto";
    badge.className = isRunning ? "badge" : "badge muted";
  }
  setControlsDisabled(isRunning);
  $("#runMessage").textContent = isRunning
    ? "A procurar, qualificar e enriquecer novas oportunidades em background."
    : "Pipeline pronto. O engine mantém dados, fontes e enrichment separados da camada visual.";
  const completed = Number(run.completedQueries || 0);
  const total = Number(run.totalQueries || 0);
  const pct = total ? Math.round((completed / total) * 100) : run.status === "completed" ? 100 : 0;
  $("#progressBar").style.width = `${Math.min(100, pct)}%`;
  renderRunEvents(run.events || []);
  iconRefresh();
}

function renderRunEvents(events = []) {
  const list = $("#eventList");
  if (!list) return;
  if (!events.length) {
    list.innerHTML = `<div class="event-item"><strong>system</strong>Sem eventos recentes. O cockpit atualiza automaticamente.</div>`;
    return;
  }
  list.innerHTML = events.slice(0, 5).map((event) => {
    const time = event.at ? new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now";
    return `<div class="event-item"><strong>${escapeHtml(event.status || "event")} · ${escapeHtml(time)}</strong>${escapeHtml(event.message || "Atualização do motor")}</div>`;
  }).join("");
}

function setControlsDisabled(isRunning) {
  $("#scanButton").disabled = isRunning;
  $("#continuousButton").disabled = isRunning;
  $$(".preset-button").forEach((button) => { button.disabled = isRunning; });
  const stop = $("#stopButton");
  if (stop) stop.disabled = !isRunning;
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

function dealCard(lead) {
  const selected = lead.id === state.selectedId ? "selected" : "";
  const snippet = (lead.snippet || lead.outbound?.opener || "").slice(0, 110);
  const confidence = contactConfidence(lead);
  return `<article class="deal-card ${selected}" data-id="${escapeHtml(lead.id)}" draggable="true"><div class="deal-top"><div><div class="deal-title">${escapeHtml(leadTitle(lead))}</div><a class="deal-url" href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div><span class="priority-pill ${priorityClass(lead.priority)}">${escapeHtml(lead.priority || "D")}</span></div><div class="deal-meta"><span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span><span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span></div><div class="deal-note">${escapeHtml(segmentLabel(lead.segment) || countryLabel(lead.country))}</div>${snippet ? `<div class="deal-note">${escapeHtml(snippet)}</div>` : ""}<div class="deal-score"><span>Score ${Number(lead.score || 0)}</span><span>Contacto ${confidence}%</span></div><div class="deal-quality" title="Confiança do contacto"><span style="width:${confidence}%"></span></div></article>`;
}

function groupedLeads() {
  const groups = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage.key, []]));
  for (const lead of state.leads) groups[stageKey(lead.stage)].push(lead);
  return groups;
}

function selectLead(id) {
  state.selectedId = id;
  $$(".deal-card").forEach((card) => card.classList.toggle("selected", card.dataset.id === id));
  renderDetail();
}

function renderLeads() {
  const groups = groupedLeads();
  const total = state.leads.length;
  $("#leadRows").innerHTML = PIPELINE_STAGES.map((stage) => {
    const leads = groups[stage.key] || [];
    const visible = leads.slice(0, MAX_CARDS_PER_LANE);
    const hidden = Math.max(0, leads.length - visible.length);
    return `<section class="pipeline-lane" data-stage="${stage.key}"><header class="lane-head"><div class="lane-title"><span class="lane-dot"></span>${escapeHtml(stage.label)}</div><span class="lane-count">${compactNumber(leads.length)}</span></header><div class="lane-body">${visible.length ? visible.map(dealCard).join("") : `<div class="empty-lane">${total ? "Arrasta leads para aqui." : "Sem leads nesta vista."}</div>`}${hidden ? `<div class="lane-more">+${compactNumber(hidden)} ocultas nesta coluna. Usa pesquisa ou filtros.</div>` : ""}</div></section>`;
  }).join("");

  $$(".deal-card").forEach((card) => {
    card.addEventListener("click", (event) => { if (!event.target.closest("a, button, select")) selectLead(card.dataset.id); });
    card.addEventListener("dragstart", (event) => {
      state.ui.dragging = true;
      card.classList.add("dragging");
      event.dataTransfer.setData("text/plain", card.dataset.id);
    });
    card.addEventListener("dragend", () => {
      state.ui.dragging = false;
      card.classList.remove("dragging");
    });
  });
  $$(".pipeline-lane").forEach((lane) => {
    lane.addEventListener("dragover", (event) => { event.preventDefault(); lane.classList.add("drag-over"); });
    lane.addEventListener("dragleave", () => lane.classList.remove("drag-over"));
    lane.addEventListener("drop", async (event) => {
      event.preventDefault();
      lane.classList.remove("drag-over");
      state.ui.dragging = false;
      const id = event.dataTransfer.getData("text/plain");
      const stage = lane.dataset.stage;
      if (id && stage) await updateLeadStage(id, stage);
    });
  });
  iconRefresh();
}

function renderLinkList(title, links = []) {
  if (!links.length) return "";
  return `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="link-list">${links.map((link) => `<a class="mini-chip" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(link))}</a>`).join("")}</div></div>`;
}

function renderForms(forms = []) {
  if (!forms.length) return "";
  return `<div class="detail-section"><h3>Formulários</h3>${forms.map((form) => `<div class="message-box"><p><strong>${escapeHtml(form.method || "GET")}</strong> ${escapeHtml(shortUrl(form.action || form.pageUrl || ""))}</p><p>${escapeHtml((form.fields || []).join(", ") || form.label || "Contact form")}</p><a class="mini-chip" href="${escapeHtml(form.pageUrl || form.action || "")}" target="_blank" rel="noreferrer">Abrir formulário</a></div>`).join("")}</div>`;
}

function contactTypeLabel(value = "") {
  const labels = { email: "Email", whatsapp: "WhatsApp validado", phone: "Telefone", form: "Formulário", social: "Social/DM", website: "Website", "direct-link": "Link direto" };
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
  const contactNode = href ? `<a class="mini-chip" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(contactDisplay(contact))}</a>` : `<span class="mini-chip">${escapeHtml(contact)}</span>`;
  return `<div class="detail-section"><h3>Melhor contacto validado</h3><div class="message-box"><div class="detail-meta"><span class="priority-pill a">${escapeHtml(contactTypeLabel(type))}</span><span class="mini-chip">Confiança ${Number(lead.contactConfidence || 0)}%</span></div><div class="link-list">${contactNode}</div>${source ? `<p>Fonte: ${escapeHtml(contactDisplay(source))}</p>` : ""}<button class="copy-button" data-copy="${escapeHtml(contact)}"><i data-lucide="copy"></i> Copiar contacto</button></div></div>`;
}

function renderDetail() {
  const lead = state.leads.find((item) => item.id === state.selectedId);
  const panel = $("#detailPanel");
  if (!lead) {
    panel.innerHTML = `<div class="empty-state"><i data-lucide="mouse-pointer-2"></i><p>Seleciona uma lead para abrir o dossiê comercial.</p></div>`;
    iconRefresh();
    return;
  }
  const emails = lead.emails || [];
  const languages = lead.languages || [];
  const evidence = lead.evidence || [];
  const socialLinks = lead.socialLinks || [];
  const contactLinks = lead.contactLinks || [];
  const websiteLinks = lead.websiteLinks || [];
  const phoneNumbers = lead.phoneNumbers || [];
  const forms = lead.forms || [];
  panel.innerHTML = `<div class="detail-header"><div class="detail-meta"><span class="priority-pill ${priorityClass(lead.priority)}">Lead ${escapeHtml(lead.priority || "D")}</span><span class="stage-pill">${escapeHtml(stageLabel(lead.stage))}</span><span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span><span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span></div><h2>${escapeHtml(leadTitle(lead))}</h2><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div><div class="detail-section"><h3>Pipeline</h3><label class="field stage-select"><span>Estado comercial</span><select id="detailStage">${PIPELINE_STAGES.map((stage) => `<option value="${stage.key}" ${stage.key === stageKey(lead.stage) ? "selected" : ""}>${stage.label}</option>`).join("")}</select></label><div class="detail-meta"><span class="mini-chip">Score ${Number(lead.score || 0)}</span><span class="mini-chip">Contacto ${lead.contactConfidence || 0}%</span><span class="mini-chip">${escapeHtml(segmentLabel(lead.segment) || "Pesquisa")}</span><span class="mini-chip">${escapeHtml(countryLabel(lead.country))}</span>${languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join("")}</div></div><div class="detail-section"><h3>Sinais</h3><div class="evidence-list">${(evidence.length ? evidence : ["Needs review"]).map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("")}</div></div><div class="detail-section"><h3>Contexto</h3><p>${escapeHtml(lead.snippet || "No snippet captured.")}</p></div>${renderBestContact(lead)}<div class="detail-section"><h3>Outbound</h3><div class="message-box"><p>${escapeHtml(lead.outbound?.dm || "")}</p><button class="copy-button" data-copy="${escapeHtml(lead.outbound?.dm || "")}"><i data-lucide="copy"></i> Copiar DM</button></div><div class="message-box"><p>${escapeHtml(lead.outbound?.followUp || "")}</p><button class="copy-button" data-copy="${escapeHtml(lead.outbound?.followUp || "")}"><i data-lucide="copy"></i> Copiar follow-up</button></div></div>${emails.length ? `<div class="detail-section"><h3>Email</h3><div class="link-list">${emails.map((email) => `<a class="mini-chip" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join("")}</div></div>` : ""}${phoneNumbers.length ? `<div class="detail-section"><h3>Telefones</h3><div class="link-list">${phoneNumbers.map((phone) => `<span class="mini-chip">${escapeHtml(phone)}</span>`).join("")}</div></div>` : ""}${renderForms(forms)}${renderLinkList("Social", socialLinks)}${renderLinkList("Contact paths", contactLinks)}${renderLinkList("Websites", websiteLinks)}`;
  $("#detailStage").addEventListener("change", async (event) => updateLeadStage(lead.id, event.target.value));
  $$(".copy-button").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy || "");
    toast("Copiado para o clipboard");
  }));
  iconRefresh();
}

async function updateLeadStage(id, stage) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead || stageKey(lead.stage) === stage) return;
  await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
  state.selectedId = id;
  state.ui.leadsSignature = "";
  toast(`Lead movida para ${stageLabel(stage)}`);
  await loadDashboard({ forceLeads: true });
}

function scanPayload() {
  return {
    regionSet: $("#regionSet").value,
    maxQueries: Number($("#maxQueries").value || 32),
    limitPerQuery: Number($("#limitPerQuery").value || 8),
    includePartners: $("#includePartners").checked,
    includeRecruitment: $("#includeRecruitment").checked,
    fetchPages: $("#fetchPages").checked,
    deepEnrich: $("#deepEnrich").checked,
    searchContacts: true
  };
}

async function startScan() {
  await api("/api/scan", { method: "POST", body: JSON.stringify(scanPayload()) });
  toast("Scan iniciado");
  await loadRun();
}

async function startPreset(preset) {
  $("#activePreset").textContent = `preset ${preset}`;
  await api(`/api/scan/preset/${encodeURIComponent(preset)}`, { method: "POST", body: JSON.stringify(scanPayload()) });
  toast(`Preset ${preset} iniciado`);
  await loadRun();
}

async function startContinuous() {
  const payload = { ...scanPayload(), maxQueries: Math.max(Number($("#maxQueries").value || 80), 40), limitPerQuery: Math.max(Number($("#limitPerQuery").value || 10), 8), fetchPages: true, deepEnrich: true, searchContacts: true, delayMs: 8000 };
  await api("/api/continuous/start", { method: "POST", body: JSON.stringify(payload) });
  toast("Continuous mode iniciado");
  await loadRun();
}

async function stopContinuous() {
  await api("/api/continuous/stop", { method: "POST", body: JSON.stringify({}) });
  toast("Stop pedido. Vai terminar o ciclo atual.");
  await loadRun();
}

async function repairAndExport() {
  const button = $("#repairButton");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<i data-lucide="loader-2"></i> A reparar`;
  iconRefresh();
  try {
    await api("/api/repair", { method: "POST", body: JSON.stringify({}) });
    toast("Workers verificados e exports refeitos");
    await loadDashboard({ forceLeads: true });
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    iconRefresh();
  }
}

function resetLeadView() {
  state.selectedId = null;
  state.ui.leadsSignature = "";
  updateExportLinks();
}

function bindControls() {
  $("#refreshButton").addEventListener("click", async () => { await loadDashboard({ forceLeads: true }); toast("Dashboard atualizado"); });
  $("#scanButton").addEventListener("click", async () => { try { await startScan(); } catch (error) { toast(error.message); } });
  $("#continuousButton").addEventListener("click", async () => { try { await startContinuous(); } catch (error) { toast(error.message); } });
  $("#stopButton").addEventListener("click", async () => { try { await stopContinuous(); } catch (error) { toast(error.message); } });
  $("#repairButton").addEventListener("click", async () => { try { await repairAndExport(); } catch (error) { toast(error.message); } });
  $$(".preset-button").forEach((button) => button.addEventListener("click", async () => { try { await startPreset(button.dataset.preset); } catch (error) { toast(error.message); } }));
  $("#searchInput").addEventListener("input", (event) => {
    state.filters.q = event.target.value;
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(() => {
      resetLeadView();
      loadDashboard({ forceLeads: true }).catch((error) => console.error(error));
    }, 420);
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
  if (document.visibilityState === "hidden" || state.ui.dragging) return;
  const staleLeads = Date.now() - state.ui.lastLeadFetchAt > LEADS_REFRESH_WHEN_RUNNING_MS;
  if (!state.ui.running && !staleLeads) return;
  loadDashboard().catch((error) => console.error(error));
}, DASHBOARD_REFRESH_MS);
