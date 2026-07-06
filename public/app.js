const PIPELINE_STAGES = [
  { key: "new", label: "Uncontacted" },
  { key: "contacted", label: "Activated" },
  { key: "replied", label: "Replied" },
  { key: "meeting_booked", label: "Meeting Locked" },
  { key: "no_show", label: "No-Show" },
  { key: "negotiating", label: "Negotiating" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" }
];

const MAX_LEADS_FETCH = 500;
const DASHBOARD_REFRESH_MS = 12000;
const SNAPSHOT_MAX_AGE_MS = 90000;
const SOURCE_FILTERS = [
  ["", "All Targets"],
  ["specialist", "Specialists"],
  ["social", "Social/DM"],
  ["linkedin", "LinkedIn"],
  ["instagram", "Instagram"],
  ["telegram", "Telegram"],
  ["myfxbook", "Myfxbook"],
  ["mql5", "MQL5"],
  ["forums", "Forums"],
  ["web", "Web"]
];

const state = {
  leads: [],
  lastAllLeads: [],
  selectedId: null,
  summary: null,
  health: null,
  filters: { q: "", priority: "", leadType: "", stage: "", platform: "", viewMode: "qualified" },
  ui: { leadsSignature: "", loadingLeads: false, running: false, iconRefreshQueued: false, toastTimer: null, abortController: null }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };

function iconRefresh() {
  if (!window.lucide || state.ui.iconRefreshQueued) return;
  state.ui.iconRefreshQueued = true;
  requestAnimationFrame(() => {
    window.lucide.createIcons();
    state.ui.iconRefreshQueued = false;
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortUrl(url = "") {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 74);
  } catch {
    return String(url || "").slice(0, 74);
  }
}

async function api(path, options = {}) {
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
  node.textContent = `AXIOM ALERT // ${message}`;
  node.classList.add("show");
  clearTimeout(state.ui.toastTimer);
  state.ui.toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
}

function compactNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
function percent(part, total) { return total ? Math.max(0, Math.min(100, Math.round((Number(part || 0) / Number(total || 0)) * 100))) : 0; }

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
  return leads.map((lead) => [lead.id, lead.stage, lead.commercialScore, lead.score, lead.contactConfidence, lead.lastSeen, lead.updatedAt].join(":")).join("|");
}

function updateLastUpdated(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  setText("#lastUpdated", `SYNC ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
}

function sourceText(lead = {}) {
  return `${platformForLead(lead)} ${lead.url || ""} ${lead.sourceBucket || ""} ${lead.entityType || ""} ${lead.segment || ""}`.toLowerCase();
}

function categoryMatches(lead = {}, category = "") {
  const text = sourceText(lead);
  const value = String(category || "").toLowerCase();
  if (!value) return true;
  if (value === "specialist") return /mql5|myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|forexfactory|babypips|specialist/.test(text);
  if (value === "social") return /linkedin|instagram|x\/twitter|twitter|telegram|t\.me|discord|tiktok|facebook|threads|reddit/.test(text);
  if (value === "linkedin") return /linkedin/.test(text);
  if (value === "instagram") return /instagram/.test(text);
  if (value === "telegram") return /telegram|t\.me/.test(text);
  if (value === "myfxbook") return /myfxbook/.test(text);
  if (value === "mql5") return /mql5/.test(text);
  if (value === "forums") return /forexfactory|babypips|earnforex|reddit|forum/.test(text);
  if (value === "web") return !["specialist", "social"].some((key) => categoryMatches(lead, key));
  return text.includes(value);
}

function applyLocalFilters(leads = state.lastAllLeads) {
  let filtered = [...leads];
  const q = String(state.filters.q || "").toLowerCase().trim();
  if (q) filtered = filtered.filter((lead) => [lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.country, lead.leadType, lead.segment, lead.entityType, ...(lead.evidence || [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  if (state.filters.priority) filtered = filtered.filter((lead) => lead.priority === state.filters.priority || lead.commercialTier === state.filters.priority);
  if (state.filters.leadType) filtered = filtered.filter((lead) => lead.leadType === state.filters.leadType);
  if (state.filters.stage) filtered = filtered.filter((lead) => (lead.stage || "new") === state.filters.stage);
  if (state.filters.platform) filtered = filtered.filter((lead) => categoryMatches(lead, state.filters.platform));
  return filtered;
}

function renderLocalPreview() {
  if (!state.lastAllLeads.length) return;
  const leads = applyLocalFilters();
  state.leads = leads;
  if (!state.selectedId || !state.leads.some((lead) => lead.id === state.selectedId)) state.selectedId = state.leads[0]?.id || null;
  state.ui.leadsSignature = leadsSignature(leads);
  renderLeads();
  renderDetail();
  renderSourceActiveStates();
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
    return { total: snapshot.total || 0, leads: (snapshot.leads || []).slice(0, MAX_LEADS_FETCH), summary, health: null, run: { status: "idle", continuous: { status: "auto" } }, snapshot: true };
  } catch { return null; }
}

function applyDashboardData(data, { forceLeads = false } = {}) {
  const leads = data.leads || [];
  const signature = leadsSignature(leads);
  const selectedBefore = state.selectedId;

  state.summary = data.summary || null;
  state.health = data.health || null;
  state.leads = leads;
  if (!hasLiveFilters()) state.lastAllLeads = leads;

  if (!state.selectedId && state.leads.length) state.selectedId = state.leads[0].id;
  if (state.selectedId && !state.leads.some((lead) => lead.id === state.selectedId)) state.selectedId = state.leads[0]?.id || null;

  renderSummary();
  renderRun(data.run || state.summary?.activeRun || {});
  updateLastUpdated(data.cachedAt || new Date());

  const selectionChanged = selectedBefore !== state.selectedId;
  if (forceLeads || selectionChanged || signature !== state.ui.leadsSignature) {
    state.ui.leadsSignature = signature;
    renderLeads();
    renderDetail();
  }
}

async function loadDashboard({ forceLeads = false } = {}) {
  if (state.ui.loadingLeads && !forceLeads) return;
  if (forceLeads && state.ui.abortController) state.ui.abortController.abort();
  const controller = new AbortController();
  state.ui.abortController = controller;
  state.ui.loadingLeads = true;
  $("#leadRows")?.classList.add("is-loading");
  try {
    const snapshot = await loadStaticSnapshot();
    if (snapshot && !forceLeads) {
      applyDashboardData(snapshot, { forceLeads });
      if (!state.ui.running) return;
    }
    const query = filterQueryString({ includeLimit: true });
    const data = await api(`/api/dashboard${query ? `?${query}` : ""}`, { signal: controller.signal });
    applyDashboardData(data, { forceLeads });
  } catch (error) {
    if (error.name !== "AbortError") {
      toast(error.message || "Command cockpit data load failed");
      console.error(error);
    }
  } finally {
    if (state.ui.abortController === controller) state.ui.abortController = null;
    state.ui.loadingLeads = false;
    $("#leadRows")?.classList.remove("is-loading");
  }
}

function renderSummary() {
  const counts = state.summary?.counts || {};
  setText("#metricTotalLabel", state.filters.viewMode === "raw" ? "Harvested Graph View" : "Execution-Ready Prospects");
  setText("#metricTotal", compactNumber(counts.total || 0));
  setText("#metricRawTotal", compactNumber(state.summary?.rawTotal || counts.total || 0));
  setText("#metricA", compactNumber(counts.priorityA || 0));
  setText("#metricPartners", compactNumber(counts.partners || 0));
  setText("#metricRecruitment", compactNumber(counts.recruitment || 0));
  setText("#metricBooked", compactNumber(counts.booked || 0));
  setText("#metricContactable", compactNumber(counts.contactable || 0));
  setText("#metricEmailForm", compactNumber(Number(counts.emails || 0) + Number(counts.forms || 0)));
  renderPlatformStrip();
  renderInsights();
}

function renderRun(run = {}) {
  const continuous = run.continuous || {};
  state.ui.running = run.status === "running" || continuous.status === "running" || continuous.status === "stopping";
  const badge = $("#runBadge");
  if (badge) {
    badge.textContent = state.ui.running ? "ENGINE ACTIVE" : "SYSTEM ONLINE";
    badge.className = "status-pill live";
  }
  setText("#metricActiveWorkers", state.ui.running ? "LIVE" : "AUTO");
  iconRefresh();
}

function platformLabel(value = "") { return value || "Web"; }
function platformClass(value = "") { return platformLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown"; }
function platformForLead(lead = {}) { return lead.platform || "Web"; }
function countryLabel(value = "") { return value || "Global"; }

function renderSourceActiveStates() {
  $$("#platformStrip .source-chip").forEach((button) => button.classList.toggle("active", String(state.filters.platform || "") === String(button.dataset.platform || "")));
}

async function setPlatformFilter(value) {
  state.filters.platform = value || "";
  const filter = $("#platformFilter");
  if (filter) filter.value = state.filters.platform;
  resetLeadView();
  renderSourceActiveStates();
  renderLocalPreview();
  await loadDashboard({ forceLeads: true });
}

function categoryCount(key, byPlatform = {}, categoryCounts = {}) {
  if (!key) return state.summary?.counts?.total || 0;
  if (categoryCounts[key]) return categoryCounts[key];
  return state.lastAllLeads.filter((lead) => categoryMatches(lead, key)).length || byPlatform[key] || byPlatform[key.toUpperCase()] || 0;
}

function renderPlatformStrip() {
  const node = $("#platformStrip");
  if (!node) return;
  const categoryCounts = state.summary?.bySourceCategory || {};
  const byPlatform = state.summary?.byPlatform || {};
  const platformEntries = Object.entries(byPlatform)
    .filter(([name]) => !SOURCE_FILTERS.some(([key]) => key && key.toLowerCase() === String(name).toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const buttons = [
    ...SOURCE_FILTERS.map(([value, label]) => [value, label, categoryCount(value, byPlatform, categoryCounts)]),
    ...platformEntries.map(([name, count]) => [name, name, count])
  ];
  node.innerHTML = buttons
    .filter(([, , count], index) => index === 0 || Number(count || 0) > 0)
    .map(([value, label, count]) => `<button class="source-chip ${String(state.filters.platform || "") === String(value || "") ? "active" : ""}" data-platform="${escapeHtml(value)}" type="button"><span>${escapeHtml(label)}</span><strong>${compactNumber(count || 0)}</strong></button>`)
    .join("");
  $$("#platformStrip .source-chip").forEach((button) => button.addEventListener("click", () => setPlatformFilter(button.dataset.platform || "").catch((error) => console.error(error))));
}

function renderInsights() {
  const counts = state.summary?.counts || {};
  const contactPct = percent(counts.contactable || 0, counts.total || 0);
  $("#qualityRing")?.style.setProperty("--pct", `${contactPct}%`);
  setText("#qualityPercent", `${contactPct}%`);
  setText("#qualityCopy", `${compactNumber(counts.contactable || 0)} / ${compactNumber(counts.total || 0)} targets have actionable delivery routes.`);

  const sourceEntries = Object.entries(state.summary?.byPlatform || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  setText("#topSourceLabel", sourceEntries[0] ? `${sourceEntries[0][0]} · ${compactNumber(sourceEntries[0][1])}` : "—");
  renderBarChart("#sourceChart", sourceEntries, { kind: "platform" });

  const stageEntries = PIPELINE_STAGES.map((stage) => [stage.label, state.leads.filter((lead) => stageKey(lead.stage) === stage.key).length, stage.key]).filter(([, value]) => value > 0).slice(0, 5);
  setText("#stageFocusLabel", stageEntries[0] ? `${stageEntries[0][0]} · ${compactNumber(stageEntries[0][1])}` : "—");
  renderBarChart("#stageChart", stageEntries, { kind: "stage" });
}

function renderBarChart(selector, entries = [], options = {}) {
  const node = $(selector);
  if (!node) return;
  if (!entries.length) { node.innerHTML = `<div class="empty-chart">No signal data in this view.</div>`; return; }
  const max = Math.max(...entries.map(([, value]) => Number(value || 0)), 1);
  node.innerHTML = entries.map(([label, value, key]) => {
    const width = Math.max(5, Math.round((Number(value || 0) / max) * 100));
    const dataAttrs = options.kind === "stage" ? `data-stage="${escapeHtml(key || "")}"` : `data-platform="${escapeHtml(label)}"`;
    return `<button class="chart-row" type="button" ${dataAttrs}><span>${escapeHtml(label)}</span><strong>${compactNumber(value)}</strong><i><b style="width:${width}%"></b></i></button>`;
  }).join("");
  node.querySelectorAll(".chart-row").forEach((row) => row.addEventListener("click", async () => {
    if (options.kind === "stage") { state.filters.stage = row.dataset.stage || ""; const filter = $("#stageFilter"); if (filter) filter.value = state.filters.stage; resetLeadView(); renderLocalPreview(); await loadDashboard({ forceLeads: true }); }
    else { await setPlatformFilter(row.dataset.platform || ""); }
  }));
}

function typeLabel(value = "") {
  const labels = { partner: "IB / Affiliate", institution: "Institution", recruitment: "Broker Talent", research: "Research Signal" };
  return labels[String(value).toLowerCase()] || value || "Research Signal";
}
function stageLabel(value = "") { const labels = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage.key, stage.label])); return labels[String(value || "new").toLowerCase()] || String(value || "new").replace(/_/g, " "); }
function stageKey(value = "") { const key = String(value || "new").toLowerCase(); return PIPELINE_STAGES.some((stage) => stage.key === key) ? key : "new"; }
function segmentLabel(value = "") {
  const labels = { "Fund / Asset Manager": "Fund / Asset Manager", "Event / Expo": "Event / Expo", "Prop / Funded Trading": "Prop / Funded", "IB / Partner": "IB / Partner", "High-Calibre Trader": "Pro Trader", "Trading Education": "Trading Academy", Affiliate: "Affiliate", Community: "Community", "Creator / Influencer": "Creator", "Broker-Seeking / Intent Post": "Broker Intent", "Broker Talent": "Broker Talent" };
  return labels[value] || value || "";
}
function priorityClass(priority) { return String(priority || "d").toLowerCase(); }
function contactConfidence(lead = {}) { return Math.max(0, Math.min(100, Number(lead.contactConfidence || 0))); }
function leadTitle(lead = {}) { return String(lead.companyName || lead.name || lead.title || "Untitled Target").replace(/^\)?\s*\/\s*posts\s*\/\s*x(?:\s*-\s*twitter)?/i, "X profile/post").replace(/^thread\s*›\s*/i, "ForexFactory thread: ").replace(/^past-events\s*›\s*/i, "Event: "); }
function selectedLeadClass(lead) { return lead.id === state.selectedId ? "selected" : ""; }
function signalClass(confidence = 0) { if (confidence >= 85) return "high-signal"; if (confidence >= 60) return "mid-signal"; if (confidence > 0) return "low-signal"; return "no-signal"; }

function leadRow(lead) {
  const confidence = contactConfidence(lead);
  const title = leadTitle(lead);
  const source = platformForLead(lead);
  const stage = stageKey(lead.stage);
  return `<div class="table-row lead-row ${selectedLeadClass(lead)}" data-id="${escapeHtml(lead.id)}">
    <div class="lead-main-cell"><strong>${escapeHtml(title)}</strong><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div>
    <div><span class="source-pill ${platformClass(source)}">${escapeHtml(source)}</span></div>
    <div><span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span></div>
    <div class="muted-cell">${escapeHtml(segmentLabel(lead.segment) || countryLabel(lead.country))}</div>
    <div class="score-cell">${Number(lead.commercialScore || lead.score || 0)}</div>
    <div class="confidence-cell ${signalClass(confidence)}"><span>${confidence}%</span><i style="width:${confidence}%"></i></div>
    <div><span class="stage-pill ${stage}">${escapeHtml(stageLabel(lead.stage))}</span></div>
  </div>`;
}

function renderLeads() {
  const node = $("#leadRows");
  if (!node) return;
  const rows = state.leads.map(leadRow).join("");
  node.innerHTML = `<div class="lead-table"><div class="table-row table-head"><span>Target Entity</span><span>Source</span><span>Model</span><span>Segment</span><span>Score</span><span>Signal Accuracy</span><span>Pipeline</span></div>${rows || `<div class="empty-table">No execution-ready targets in this view.</div>`}</div>`;
  $$(".lead-row").forEach((row) => row.addEventListener("click", (event) => { if (!event.target.closest("a")) selectLead(row.dataset.id); }));
  iconRefresh();
}

function selectLead(id) { state.selectedId = id; $$(".lead-row").forEach((row) => row.classList.toggle("selected", row.dataset.id === id)); renderDetail(); }
function uniqueList(items = []) { return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))]; }
function renderLinkList(title, links = []) { const clean = uniqueList(links).slice(0, 8); return clean.length ? `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="link-list">${clean.map((link) => `<a class="mini-chip" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(link))}</a>`).join("")}</div></div>` : ""; }
function contactTypeLabel(value = "") { const labels = { email: "Email", whatsapp: "WhatsApp", phone: "Phone", form: "Form", social: "Social/DM", website: "Website", "direct-link": "Direct Link" }; return labels[String(value).toLowerCase()] || value || "Contact Route"; }
function contactHref(contact = "", type = "") { if (/^https?:\/\//i.test(contact)) return contact; if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`; if (type === "phone" || type === "whatsapp") return `tel:${contact.replace(/[^+\d]/g, "")}`; return ""; }
function contactDisplay(contact = "") { return /^https?:\/\//i.test(contact) ? shortUrl(contact) : contact; }
function renderBestContact(lead = {}) { const contact = lead.bestContact || ""; if (!contact) return ""; const type = lead.bestContactType || lead.contactQuality || ""; const href = contactHref(contact, type); const source = lead.bestContactSource || ""; const contactNode = href ? `<a class="contact-value" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(contactDisplay(contact))}</a>` : `<span class="contact-value">${escapeHtml(contact)}</span>`; return `<div class="detail-section primary-contact"><h3>Best Execution Route</h3><div class="contact-line"><span class="priority-pill a">${escapeHtml(contactTypeLabel(type))}</span><span class="mini-chip high-signal">${Number(lead.contactConfidence || 0)}%</span></div>${contactNode}${source ? `<p>Source: ${escapeHtml(contactDisplay(source))}</p>` : ""}</div>`; }
function renderForms(forms = []) { const clean = forms.slice(0, 4); return clean.length ? `<div class="detail-section"><h3>Forms</h3><div class="link-list">${clean.map((form) => `<a class="mini-chip" href="${escapeHtml(form.pageUrl || form.action || "")}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(form.pageUrl || form.action || ""))}</a>`).join("")}</div></div>` : ""; }

function renderDetail() {
  const lead = state.leads.find((item) => item.id === state.selectedId);
  const panel = $("#detailPanel");
  if (!panel) return;
  if (!lead) { panel.innerHTML = `<div class="empty-state"><i data-lucide="mouse-pointer-2"></i><p>Select a target to open the commercial intelligence dossier.</p></div>`; iconRefresh(); return; }
  const emails = uniqueList(lead.emails || []), languages = uniqueList(lead.languages || []), evidence = uniqueList(lead.evidence || []), socialLinks = uniqueList(lead.socialLinks || []), contactLinks = uniqueList(lead.contactLinks || []), websiteLinks = uniqueList(lead.websiteLinks || []), phoneNumbers = uniqueList(lead.phoneNumbers || []), forms = lead.forms || [];
  panel.innerHTML = `<div class="detail-header"><div class="detail-meta"><span class="priority-pill ${priorityClass(lead.priority)}">Tier ${escapeHtml(lead.priority || "D")}</span><span class="stage-pill ${stageKey(lead.stage)}">${escapeHtml(stageLabel(lead.stage))}</span><span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span></div><h2>${escapeHtml(leadTitle(lead))}</h2><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div><div class="detail-section"><h3>Pipeline Control</h3><label class="field stage-select"><span>Commercial stage</span><select id="detailStage">${PIPELINE_STAGES.map((stage) => `<option value="${stage.key}" ${stage.key === stageKey(lead.stage) ? "selected" : ""}>${stage.label}</option>`).join("")}</select></label><div class="detail-meta"><span class="mini-chip">Score ${Number(lead.commercialScore || lead.score || 0)}</span><span class="mini-chip ${signalClass(contactConfidence(lead))}">Signal ${lead.contactConfidence || 0}%</span><span class="mini-chip">${escapeHtml(segmentLabel(lead.segment) || "Research Signal")}</span><span class="mini-chip">${escapeHtml(countryLabel(lead.country))}</span>${languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join("")}</div></div>${renderBestContact(lead)}<div class="detail-section"><h3>Commercial Context</h3><p>${escapeHtml(lead.snippet || "No snippet captured.")}</p></div>${evidence.length ? `<div class="detail-section"><h3>Intent Signals</h3><div class="evidence-list">${evidence.slice(0, 10).map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("")}</div></div>` : ""}${emails.length ? `<div class="detail-section"><h3>Email Routes</h3><div class="link-list">${emails.slice(0, 6).map((email) => `<a class="mini-chip" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join("")}</div></div>` : ""}${phoneNumbers.length ? `<div class="detail-section"><h3>Phone / WhatsApp Routes</h3><div class="link-list">${phoneNumbers.slice(0, 6).map((phone) => `<span class="mini-chip">${escapeHtml(phone)}</span>`).join("")}</div></div>` : ""}${renderForms(forms)}${renderLinkList("Owned Social", socialLinks)}${renderLinkList("Contact Paths", contactLinks)}${renderLinkList("Web Properties", websiteLinks)}`;
  $("#detailStage")?.addEventListener("change", async (event) => updateLeadStage(lead.id, event.target.value));
  iconRefresh();
}

async function updateLeadStage(id, stage) { const lead = state.leads.find((item) => item.id === id); if (!lead || stageKey(lead.stage) === stage) return; await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) }); state.selectedId = id; state.ui.leadsSignature = ""; await loadDashboard({ forceLeads: true }); }
function resetLeadView() { state.selectedId = null; state.ui.leadsSignature = ""; }
async function applyFilterChange() { resetLeadView(); renderLocalPreview(); await loadDashboard({ forceLeads: true }); }

function bindControls() {
  $("#searchInput")?.addEventListener("input", (event) => { state.filters.q = event.target.value; clearTimeout(window.searchTimer); renderLocalPreview(); window.searchTimer = setTimeout(() => applyFilterChange().catch((error) => console.error(error)), 260); });
  $("#viewModeFilter")?.addEventListener("change", async (event) => { state.filters.viewMode = event.target.value; await applyFilterChange(); });
  $("#platformFilter")?.addEventListener("change", async (event) => { await setPlatformFilter(event.target.value); });
  $("#priorityFilter")?.addEventListener("change", async (event) => { state.filters.priority = event.target.value; await applyFilterChange(); });
  $("#typeFilter")?.addEventListener("change", async (event) => { state.filters.leadType = event.target.value; await applyFilterChange(); });
  $("#stageFilter")?.addEventListener("change", async (event) => { state.filters.stage = event.target.value; await applyFilterChange(); });
}

bindControls();
iconRefresh();
loadDashboard({ forceLeads: true }).catch((error) => console.error(error));
setInterval(() => { if (document.visibilityState === "hidden") return; loadDashboard().catch((error) => console.error(error)); }, DASHBOARD_REFRESH_MS);
