const PIPELINE_STAGES = [
  { key: "new", label: "Uncontacted" },
  { key: "contacted", label: "Activated" },
  { key: "replied", label: "Replied" },
  { key: "meeting_booked", label: "Meeting" },
  { key: "no_show", label: "No-show" },
  { key: "negotiating", label: "Negotiating" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" }
];

const MAX_LEADS_FETCH = 500;
const DASHBOARD_REFRESH_MS = 12000;
const SNAPSHOT_MAX_AGE_MS = 90000;
const SOURCE_FILTERS = [
  ["", "All"], ["linkedin", "LinkedIn"], ["instagram", "Instagram"], ["telegram", "Telegram"],
  ["myfxbook", "Myfxbook"], ["mql5", "MQL5"], ["specialist", "Specialist"], ["social", "Social"], ["forums", "Forums"], ["web", "Web"]
];

const state = {
  leads: [],
  lastAllLeads: [],
  selectedId: null,
  summary: null,
  health: null,
  filters: { q: "", priority: "", leadType: "", stage: "", platform: "", viewMode: "qualified", quick: "all" },
  sort: { key: "score", dir: "desc" },
  ui: { loadingLeads: false, running: false, iconRefreshQueued: false, toastTimer: null, abortController: null, leadsSignature: "", commandOpen: false }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };

function iconRefresh() {
  if (!window.lucide || state.ui.iconRefreshQueued) return;
  state.ui.iconRefreshQueued = true;
  requestAnimationFrame(() => { window.lucide.createIcons(); state.ui.iconRefreshQueued = false; });
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function compactNumber(value) { return Number(value || 0).toLocaleString("en-US"); }
function percent(part, total) { return total ? Math.max(0, Math.min(100, Math.round((Number(part || 0) / Number(total || 0)) * 100))) : 0; }
function platformForLead(lead = {}) { return lead.platform || "Web"; }
function platformClass(value = "") { return String(value || "web").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "web"; }
function countryLabel(value = "") { return value || "Global"; }
function stageKey(value = "") { const key = String(value || "new").toLowerCase(); return PIPELINE_STAGES.some((stage) => stage.key === key) ? key : "new"; }
function stageLabel(value = "") { return PIPELINE_STAGES.find((stage) => stage.key === stageKey(value))?.label || "Uncontacted"; }
function contactConfidence(lead = {}) { return Math.max(0, Math.min(100, Number(lead.contactConfidence || 0))); }
function scoreOf(lead = {}) { return Number(lead.commercialScore || lead.score || 0); }
function hasContact(lead = {}) { return Boolean((lead.emails || []).length || (lead.forms || []).length || (lead.phoneNumbers || []).length || lead.bestContact || (lead.contactLinks || []).length); }
function isHot(lead = {}) { return lead.priority === "A" || lead.commercialTier === "A" || scoreOf(lead) >= 76; }
function leadTitle(lead = {}) { return String(lead.companyName || lead.name || lead.title || "Untitled Target").replace(/^\)?\s*\/\s*posts\s*\/\s*x(?:\s*-\s*twitter)?/i, "X profile/post").replace(/^thread\s*›\s*/i, "ForexFactory thread: ").replace(/^past-events\s*›\s*/i, "Event: "); }
function segmentLabel(value = "") { return value || "Unclear"; }
function typeLabel(value = "") { return ({ partner: "IB/Affiliate", institution: "Institution", recruitment: "Talent", research: "Research" })[String(value).toLowerCase()] || value || "Research"; }
function priorityClass(priority = "D") { return String(priority || "D").toLowerCase(); }
function shortUrl(url = "") { try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 78); } catch { return String(url || "").slice(0, 78); } }
function uniqueList(items = []) { return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))]; }
function signalClass(confidence = 0) { if (confidence >= 85) return "high-signal"; if (confidence >= 60) return "mid-signal"; if (confidence > 0) return "low-signal"; return "no-signal"; }

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
  node.textContent = `AXIOM // ${message}`;
  node.classList.add("show");
  clearTimeout(state.ui.toastTimer);
  state.ui.toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
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
function hasLiveFilters() { return state.filters.viewMode === "raw" || state.filters.q || state.filters.priority || state.filters.leadType || state.filters.stage || state.filters.platform; }
function leadsSignature(leads = []) { return leads.map((lead) => [lead.id, lead.stage, scoreOf(lead), lead.contactConfidence, lead.lastSeen, lead.updatedAt].join(":")).join("|"); }
function updateLastUpdated(value = new Date()) { const date = value instanceof Date ? value : new Date(value); setText("#lastUpdated", `SYNC ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`); }

function sourceText(lead = {}) { return `${platformForLead(lead)} ${lead.url || ""} ${lead.sourceBucket || ""} ${lead.entityType || ""} ${lead.segment || ""}`.toLowerCase(); }
function categoryMatches(lead = {}, category = "") {
  const text = sourceText(lead); const value = String(category || "").toLowerCase();
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

function quickMatches(lead) {
  if (state.filters.quick === "hot") return isHot(lead);
  if (state.filters.quick === "contactable") return hasContact(lead);
  if (state.filters.quick === "no-contact") return !hasContact(lead);
  return true;
}
function applyLocalFilters(leads = state.lastAllLeads) {
  let filtered = [...leads];
  const q = String(state.filters.q || "").toLowerCase().trim();
  if (q) filtered = filtered.filter((lead) => [lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.country, lead.leadType, lead.segment, lead.entityType, ...(lead.evidence || [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  if (state.filters.priority) filtered = filtered.filter((lead) => lead.priority === state.filters.priority || lead.commercialTier === state.filters.priority);
  if (state.filters.leadType) filtered = filtered.filter((lead) => lead.leadType === state.filters.leadType);
  if (state.filters.stage) filtered = filtered.filter((lead) => stageKey(lead.stage) === state.filters.stage);
  if (state.filters.platform) filtered = filtered.filter((lead) => categoryMatches(lead, state.filters.platform));
  filtered = filtered.filter(quickMatches);
  return sortLeads(filtered);
}
function sortLeads(leads = []) {
  const dir = state.sort.dir === "asc" ? 1 : -1;
  const value = (lead) => {
    if (state.sort.key === "contact") return contactConfidence(lead);
    if (state.sort.key === "stage") return stageLabel(lead.stage);
    if (state.sort.key === "source") return platformForLead(lead);
    if (state.sort.key === "name") return leadTitle(lead);
    return scoreOf(lead);
  };
  return [...leads].sort((a, b) => String(value(a)).localeCompare(String(value(b)), undefined, { numeric: true }) * dir);
}
function renderLocalPreview() { if (!state.lastAllLeads.length) return; state.leads = applyLocalFilters(); if (!state.selectedId || !state.leads.some((lead) => lead.id === state.selectedId)) state.selectedId = state.leads[0]?.id || null; renderAllDynamic(); }

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
    return { total: snapshot.total || 0, leads: (snapshot.leads || []).slice(0, MAX_LEADS_FETCH), summary, run: { status: "idle", continuous: { status: "auto" } }, snapshot: true };
  } catch { return null; }
}
async function loadDashboard({ forceLeads = false } = {}) {
  if (state.ui.loadingLeads && !forceLeads) return;
  if (forceLeads && state.ui.abortController) state.ui.abortController.abort();
  const controller = new AbortController(); state.ui.abortController = controller; state.ui.loadingLeads = true; $("#leadRows")?.classList.add("is-loading");
  try {
    const snapshot = await loadStaticSnapshot();
    if (snapshot && !forceLeads) applyDashboardData(snapshot, { forceLeads });
    const query = filterQueryString({ includeLimit: true });
    const data = await api(`/api/dashboard${query ? `?${query}` : ""}`, { signal: controller.signal });
    applyDashboardData(data, { forceLeads: true });
  } catch (error) { if (error.name !== "AbortError") { toast(error.message || "Data load failed"); console.error(error); } }
  finally { if (state.ui.abortController === controller) state.ui.abortController = null; state.ui.loadingLeads = false; $("#leadRows")?.classList.remove("is-loading"); }
}
function applyDashboardData(data) {
  state.summary = data.summary || null; state.health = data.health || null; state.lastAllLeads = data.leads || []; state.leads = applyLocalFilters(state.lastAllLeads);
  if (!state.selectedId && state.leads.length) state.selectedId = state.leads[0].id;
  if (state.selectedId && !state.leads.some((lead) => lead.id === state.selectedId)) state.selectedId = state.leads[0]?.id || null;
  renderRun(data.run || state.summary?.activeRun || {}); updateLastUpdated(data.cachedAt || new Date()); renderAllDynamic();
}
function renderAllDynamic() { renderSummary(); renderQuickViews(); renderPlatformStrip(); renderInsights(); renderLeads(); renderDetail(); updateExportLinks(); iconRefresh(); }

function renderSummary() {
  const counts = state.summary?.counts || {};
  setText("#metricTotalLabel", state.filters.viewMode === "raw" ? "Raw Graph" : "Execution-Ready");
  setText("#metricTotal", compactNumber(state.leads.length || counts.total || 0));
  setText("#metricRawTotal", compactNumber(state.summary?.rawTotal || counts.total || 0));
  setText("#metricA", compactNumber(state.leads.filter(isHot).length || counts.priorityA || 0));
  setText("#metricPartners", compactNumber(counts.partners || 0));
  setText("#metricRecruitment", compactNumber(counts.recruitment || 0));
  setText("#metricBooked", compactNumber(counts.booked || 0));
  setText("#metricContactable", compactNumber(state.leads.filter(hasContact).length || counts.contactable || 0));
  setText("#metricEmailForm", compactNumber(Number(counts.emails || 0) + Number(counts.forms || 0)));
}
function renderRun(run = {}) { const continuous = run.continuous || {}; state.ui.running = run.status === "running" || continuous.status === "running" || continuous.status === "stopping"; setText("#runBadge", state.ui.running ? "ENGINE ACTIVE" : "SYSTEM ONLINE"); setText("#metricActiveWorkers", state.ui.running ? "LIVE" : "AUTO"); }
function renderQuickViews() { const all = state.lastAllLeads; setText("#quickAll", compactNumber(all.length)); setText("#quickHot", compactNumber(all.filter(isHot).length)); setText("#quickContactable", compactNumber(all.filter(hasContact).length)); setText("#quickNoContact", compactNumber(all.filter((lead) => !hasContact(lead)).length)); $$(".quick-card").forEach((button) => button.classList.toggle("active", button.dataset.view === state.filters.quick)); }
function sourceCount(key) { if (!key) return state.lastAllLeads.length; return state.lastAllLeads.filter((lead) => categoryMatches(lead, key)).length; }
function renderPlatformStrip() { const node = $("#platformStrip"); if (!node) return; const byPlatform = state.summary?.byPlatform || {}; const extra = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => [name, name, count]); const buttons = [...SOURCE_FILTERS.map(([key, label]) => [key, label, sourceCount(key)]), ...extra]; node.innerHTML = buttons.filter(([, , count], i) => i === 0 || count > 0).map(([key, label, count]) => `<button class="source-chip ${String(state.filters.platform) === String(key) ? "active" : ""}" data-platform="${escapeHtml(key)}" type="button">${escapeHtml(label)}<strong>${compactNumber(count)}</strong></button>`).join(""); $$("#platformStrip .source-chip").forEach((button) => button.addEventListener("click", () => setPlatformFilter(button.dataset.platform || ""))); }
function renderInsights() { const total = state.leads.length; const contactable = state.leads.filter(hasContact).length; const pct = percent(contactable, total); $("#qualityRing")?.style.setProperty("--pct", `${pct}%`); setText("#qualityPercent", `${pct}%`); setText("#qualityCopy", `${compactNumber(contactable)} / ${compactNumber(total)} visible targets have actionable routes.`); const sources = Object.entries(state.summary?.byPlatform || {}).sort((a, b) => b[1] - a[1]).slice(0, 5); setText("#topSourceLabel", sources[0] ? `${sources[0][0]} · ${compactNumber(sources[0][1])}` : "—"); renderBarChart("#sourceChart", sources, "platform"); const stages = PIPELINE_STAGES.map((stage) => [stage.label, state.leads.filter((lead) => stageKey(lead.stage) === stage.key).length, stage.key]).filter(([, n]) => n > 0).slice(0, 5); setText("#stageFocusLabel", stages[0] ? `${stages[0][0]} · ${compactNumber(stages[0][1])}` : "—"); renderBarChart("#stageChart", stages, "stage"); }
function renderBarChart(selector, entries = [], kind = "platform") { const node = $(selector); if (!node) return; if (!entries.length) { node.innerHTML = `<div class="empty-chart">No signal data.</div>`; return; } const max = Math.max(...entries.map(([, value]) => Number(value || 0)), 1); node.innerHTML = entries.map(([label, value, key]) => `<button class="chart-row" type="button" ${kind === "stage" ? `data-stage="${escapeHtml(key || "")}"` : `data-platform="${escapeHtml(label)}"`}><span>${escapeHtml(label)}</span><strong>${compactNumber(value)}</strong><i><b style="width:${Math.max(5, Math.round((Number(value || 0) / max) * 100))}%"></b></i></button>`).join(""); node.querySelectorAll(".chart-row").forEach((row) => row.addEventListener("click", () => { if (kind === "stage") { state.filters.stage = row.dataset.stage || ""; const select = $("#stageFilter"); if (select) select.value = state.filters.stage; } else setPlatformFilter(row.dataset.platform || ""); renderLocalPreview(); })); }

function selectedLeadClass(lead) { return lead.id === state.selectedId ? "selected" : ""; }
function leadRow(lead) { const conf = contactConfidence(lead); const source = platformForLead(lead); const stage = stageKey(lead.stage); return `<div class="table-row lead-row ${selectedLeadClass(lead)}" data-id="${escapeHtml(lead.id)}"><div class="lead-main-cell"><strong>${escapeHtml(leadTitle(lead))}</strong><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div><div><span class="source-pill ${platformClass(source)}">${escapeHtml(source)}</span></div><div><span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span></div><div class="muted-cell">${escapeHtml(segmentLabel(lead.segment) || countryLabel(lead.country))}</div><div class="score-cell">${scoreOf(lead)}</div><div class="confidence-cell ${signalClass(conf)}"><span>${conf}%</span><i style="width:${conf}%"></i></div><div><span class="stage-pill ${stage}">${escapeHtml(stageLabel(lead.stage))}</span></div></div>`; }
function sortHeader(label, key) { const mark = state.sort.key === key ? (state.sort.dir === "asc" ? " ↑" : " ↓") : ""; return `<span data-sort="${key}">${label}${mark}</span>`; }
function renderLeads() { const node = $("#leadRows"); if (!node) return; const rows = state.leads.map(leadRow).join(""); node.innerHTML = `<div class="lead-table"><div class="table-row table-head">${sortHeader("Target Entity", "name")}${sortHeader("Source", "source")}<span>Model</span><span>Segment</span>${sortHeader("Score", "score")}${sortHeader("Signal", "contact")}${sortHeader("Pipeline", "stage")}</div>${rows || `<div class="empty-table">No targets in this view. Switch Quick View or Raw Graph.</div>`}</div>`; $$(".lead-row").forEach((row) => row.addEventListener("click", (event) => { if (!event.target.closest("a")) selectLead(row.dataset.id); })); $$(".table-head [data-sort]").forEach((head) => head.addEventListener("click", () => { const key = head.dataset.sort; state.sort = { key, dir: state.sort.key === key && state.sort.dir === "desc" ? "asc" : "desc" }; renderLocalPreview(); })); }
function contactHref(contact = "", type = "") { if (/^https?:\/\//i.test(contact)) return contact; if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`; if (type === "phone" || type === "whatsapp") return `tel:${contact.replace(/[^+\d]/g, "")}`; return ""; }
function contactDisplay(contact = "") { return /^https?:\/\//i.test(contact) ? shortUrl(contact) : contact; }
function renderLinkList(title, links = []) { const clean = uniqueList(links).slice(0, 8); return clean.length ? `<div class="detail-section"><h3>${escapeHtml(title)}</h3><div class="link-list">${clean.map((link) => `<a class="mini-chip" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(link))}</a>`).join("")}</div></div>` : ""; }
function renderBestContact(lead = {}) { const contact = lead.bestContact || uniqueList(lead.emails || [])[0] || uniqueList(lead.phoneNumbers || [])[0] || ""; if (!contact) return ""; const type = lead.bestContactType || lead.contactQuality || ""; const href = contactHref(contact, type); const contactNode = href ? `<a class="contact-value" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(contactDisplay(contact))}</a>` : `<span class="contact-value">${escapeHtml(contact)}</span>`; return `<div class="detail-section"><h3>Best Execution Route</h3><div class="detail-meta"><span class="priority-pill a">${escapeHtml(type || "Route")}</span><span class="mini-chip">${contactConfidence(lead)}%</span></div>${contactNode}</div>`; }
function renderDetail() { const lead = state.leads.find((item) => item.id === state.selectedId); const panel = $("#detailPanel"); if (!panel) return; if (!lead) { panel.innerHTML = `<div class="empty-state"><i data-lucide="mouse-pointer-2"></i><p>Select a target to open the commercial intelligence dossier.</p></div>`; iconRefresh(); return; } const emails = uniqueList(lead.emails || []), evidence = uniqueList(lead.evidence || []), socialLinks = uniqueList(lead.socialLinks || []), contactLinks = uniqueList(lead.contactLinks || []), websiteLinks = uniqueList(lead.websiteLinks || []), phoneNumbers = uniqueList(lead.phoneNumbers || []), forms = lead.forms || [], languages = uniqueList(lead.languages || []); panel.innerHTML = `<div class="detail-header"><div class="detail-meta"><span class="priority-pill ${priorityClass(lead.priority)}">Tier ${escapeHtml(lead.priority || "D")}</span><span class="stage-pill ${stageKey(lead.stage)}">${escapeHtml(stageLabel(lead.stage))}</span><span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span></div><h2>${escapeHtml(leadTitle(lead))}</h2><a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a></div><div class="detail-section"><h3>Pipeline Control</h3><label class="field"><span>Commercial Stage</span><select id="detailStage">${PIPELINE_STAGES.map((stage) => `<option value="${stage.key}" ${stage.key === stageKey(lead.stage) ? "selected" : ""}>${stage.label}</option>`).join("")}</select></label><div class="detail-meta"><span class="mini-chip">Score ${scoreOf(lead)}</span><span class="mini-chip">Signal ${contactConfidence(lead)}%</span><span class="mini-chip">${escapeHtml(segmentLabel(lead.segment))}</span><span class="mini-chip">${escapeHtml(countryLabel(lead.country))}</span>${languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join("")}</div></div>${renderBestContact(lead)}<div class="detail-section"><h3>Commercial Context</h3><p>${escapeHtml(lead.snippet || "No snippet captured.")}</p></div>${evidence.length ? `<div class="detail-section"><h3>Intent Signals</h3><div class="evidence-list">${evidence.slice(0, 10).map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("")}</div></div>` : ""}${emails.length ? `<div class="detail-section"><h3>Email Routes</h3><div class="link-list">${emails.slice(0, 6).map((email) => `<a class="mini-chip" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join("")}</div></div>` : ""}${phoneNumbers.length ? `<div class="detail-section"><h3>Phone Routes</h3><div class="link-list">${phoneNumbers.slice(0, 6).map((phone) => `<span class="mini-chip">${escapeHtml(phone)}</span>`).join("")}</div></div>` : ""}${forms.length ? `<div class="detail-section"><h3>Forms</h3><div class="link-list">${forms.slice(0, 4).map((form) => `<a class="mini-chip" href="${escapeHtml(form.pageUrl || form.action || "")}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(form.pageUrl || form.action || ""))}</a>`).join("")}</div></div>` : ""}${renderLinkList("Owned Social", socialLinks)}${renderLinkList("Contact Paths", contactLinks)}${renderLinkList("Web Properties", websiteLinks)}`; $("#detailStage")?.addEventListener("change", (event) => updateLeadStage(lead.id, event.target.value)); iconRefresh(); }
async function updateLeadStage(id, stage) { await api(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) }); state.selectedId = id; toast("Pipeline stage updated"); await loadDashboard({ forceLeads: true }); }
function selectLead(id) { state.selectedId = id; $$(".lead-row").forEach((row) => row.classList.toggle("selected", row.dataset.id === id)); renderDetail(); }
function setPlatformFilter(value) { state.filters.platform = value || ""; const select = $("#platformFilter"); if (select) select.value = state.filters.platform; renderLocalPreview(); }
function updateExportLinks() { const query = filterQueryString(); const suffix = query ? `?${query}` : ""; const csv = $("#exportCsvBtn"); const json = $("#exportJsonBtn"); if (csv) csv.href = `/api/export.csv${suffix}`; if (json) json.href = `/api/export.json${suffix}`; }

const commands = [
  { title: "Refresh cockpit", hint: "Reload live data", run: () => loadDashboard({ forceLeads: true }) },
  { title: "Show A-Tier targets", hint: "Quick view", run: () => setQuickView("hot") },
  { title: "Show contactable targets", hint: "Quick view", run: () => setQuickView("contactable") },
  { title: "Show targets missing route", hint: "Gap list", run: () => setQuickView("no-contact") },
  { title: "Raw harvested graph", hint: "View mode", run: () => { state.filters.viewMode = "raw"; $("#viewModeFilter").value = "raw"; loadDashboard({ forceLeads: true }); } },
  { title: "Export CSV", hint: "Pipeline push", run: () => { window.location.href = $("#exportCsvBtn")?.href || "/api/export.csv"; } },
  { title: "Initialize quality sourcing", hint: "Run scan preset", run: () => startQualityScan() }
];
function openCommandPalette() { state.ui.commandOpen = true; $("#commandPalette")?.classList.add("open"); $("#commandPalette")?.setAttribute("aria-hidden", "false"); renderCommands(); setTimeout(() => $("#commandInput")?.focus(), 20); }
function closeCommandPalette() { state.ui.commandOpen = false; $("#commandPalette")?.classList.remove("open"); $("#commandPalette")?.setAttribute("aria-hidden", "true"); }
function renderCommands() { const q = String($("#commandInput")?.value || "").toLowerCase(); const list = $("#commandList"); if (!list) return; const filtered = commands.filter((cmd) => `${cmd.title} ${cmd.hint}`.toLowerCase().includes(q)); list.innerHTML = filtered.map((cmd, index) => `<button class="command-item ${index === 0 ? "active" : ""}" data-command="${index}" type="button"><span>${escapeHtml(cmd.title)}</span><small>${escapeHtml(cmd.hint)}</small></button>`).join(""); list.querySelectorAll(".command-item").forEach((button) => button.addEventListener("click", () => { filtered[Number(button.dataset.command)]?.run(); closeCommandPalette(); })); }
function setQuickView(view = "all") { state.filters.quick = view; renderLocalPreview(); }
async function startQualityScan() { try { await api("/api/scan/preset/quality", { method: "POST", body: JSON.stringify({}) }); toast("Quality sourcing initialized"); await loadDashboard({ forceLeads: true }); } catch (error) { toast(error.message || "Scan could not start"); } }
function bindControls() {
  $("#refreshBtn")?.addEventListener("click", () => loadDashboard({ forceLeads: true }));
  $("#commandBtn")?.addEventListener("click", openCommandPalette);
  $("#startEngineBtn")?.addEventListener("click", startQualityScan);
  $("#searchInput")?.addEventListener("input", (event) => { state.filters.q = event.target.value; clearTimeout(window.searchTimer); window.searchTimer = setTimeout(renderLocalPreview, 120); });
  $("#viewModeFilter")?.addEventListener("change", async (event) => { state.filters.viewMode = event.target.value; await loadDashboard({ forceLeads: true }); });
  $("#priorityFilter")?.addEventListener("change", (event) => { state.filters.priority = event.target.value; renderLocalPreview(); });
  $("#typeFilter")?.addEventListener("change", (event) => { state.filters.leadType = event.target.value; renderLocalPreview(); });
  $("#stageFilter")?.addEventListener("change", (event) => { state.filters.stage = event.target.value; renderLocalPreview(); });
  $$(".quick-card").forEach((button) => button.addEventListener("click", () => setQuickView(button.dataset.view || "all")));
  $("#commandPalette")?.addEventListener("click", (event) => { if (event.target.id === "commandPalette") closeCommandPalette(); });
  $("#commandInput")?.addEventListener("input", renderCommands);
  document.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openCommandPalette(); } if (event.key === "Escape") closeCommandPalette(); });
}

bindControls();
iconRefresh();
loadDashboard({ forceLeads: true }).catch((error) => console.error(error));
setInterval(() => { if (document.visibilityState !== "hidden") loadDashboard().catch((error) => console.error(error)); }, DASHBOARD_REFRESH_MS);
