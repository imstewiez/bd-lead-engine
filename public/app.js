const state = {
  leads: [],
  selectedId: null,
  summary: null,
  health: null,
  filters: {
    q: "",
    priority: "",
    leadType: "",
    stage: "",
    platform: "",
    viewMode: "qualified"
  }
};

const $ = (selector) => document.querySelector(selector);

function iconRefresh() {
  if (window.lucide) window.lucide.createIcons();
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
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function filterQueryString({ includeLimit = false } = {}) {
  const params = new URLSearchParams();
  if (state.filters.viewMode === "raw") params.set("raw", "true");
  if (state.filters.q) params.set("q", state.filters.q);
  if (state.filters.priority) params.set("priority", state.filters.priority);
  if (state.filters.leadType) params.set("leadType", state.filters.leadType);
  if (state.filters.stage) params.set("stage", state.filters.stage);
  if (state.filters.platform) params.set("platform", state.filters.platform);
  if (includeLimit) params.set("limit", "700");
  return params.toString();
}

async function loadSummary() {
  const query = filterQueryString();
  state.summary = await api(`/api/summary${query ? `?${query}` : ""}`);
  renderSummary();
}

async function loadLeads() {
  const data = await api(`/api/leads?${filterQueryString({ includeLimit: true })}`);
  state.leads = data.leads;
  if (!state.selectedId && state.leads.length) state.selectedId = state.leads[0].id;
  renderLeads();
  renderDetail();
}

async function loadRun() {
  const run = await api("/api/run");
  renderRun(run);
}

async function loadHealth() {
  state.health = await api("/api/health");
  renderHealth();
}

function renderSummary() {
  const counts = state.summary?.counts || {};
  $("#metricTotalLabel").textContent = state.filters.viewMode === "raw" ? "Base total" : "Qualificadas";
  $("#metricTotal").textContent = counts.total || 0;
  $("#metricRawTotal").textContent = state.summary?.rawTotal || counts.total || 0;
  $("#metricA").textContent = counts.priorityA || 0;
  $("#metricPartners").textContent = counts.partners || 0;
  $("#metricRecruitment").textContent = counts.recruitment || 0;
  $("#metricBooked").textContent = counts.booked || 0;
  $("#metricContactable").textContent = counts.contactable || 0;
  $("#metricEmailForm").textContent = Number(counts.emails || 0) + Number(counts.forms || 0);
  renderPlatformStrip();
}

function compactNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function renderHealth() {
  const health = state.health;
  if (!health) return;
  const statusClass = health.ok ? "ok" : "bad";
  $("#systemHealth").innerHTML = `
    <span class="health-pill ${statusClass}">
      <i data-lucide="${health.ok ? "sparkles" : "alert-triangle"}"></i>
      ${health.ok ? "Motor ativo" : "A rever"}
    </span>
    <span><strong>${compactNumber(health.counts?.working)}</strong> leads úteis</span>
    <span><strong>${compactNumber(health.counts?.contactable)}</strong> contactáveis</span>
  `;
  iconRefresh();
}

function platformLabel(value = "") {
  return value || "Web";
}

function platformClass(value = "") {
  return platformLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function platformForLead(lead = {}) {
  return lead.platform || "Web";
}

function countryLabel(value = "") {
  return value || "Global";
}

function renderPlatformStrip() {
  const byPlatform = state.summary?.byPlatform || {};
  const entries = Object.entries(byPlatform).sort((a, b) => b[1] - a[1]);
  const nonMql5Count = entries.filter(([name]) => !/mql5/i.test(name)).reduce((sum, [, count]) => sum + count, 0);
  const socialCount = entries
    .filter(([name]) => /linkedin|instagram|x\/twitter|telegram|discord|tiktok|facebook|threads|reddit/i.test(name))
    .reduce((sum, [, count]) => sum + count, 0);
  const buttons = [
    ["", "All", state.summary?.counts?.total || 0],
    ["non-mql5", "Non-MQL5", nonMql5Count],
    ["social", "Social/DM", socialCount],
    ...entries.map(([name, count]) => [name, name, count])
  ];

  $("#platformStrip").innerHTML = buttons
    .filter(([, , count], index) => index === 0 || Number(count || 0) > 0)
    .map(([value, label, count]) => {
      const active = String(state.filters.platform || "") === String(value || "") ? "active" : "";
      return `
        <button class="source-chip ${active}" data-platform="${escapeHtml(value)}" type="button">
          <span>${escapeHtml(label)}</span>
          <strong>${Number(count || 0)}</strong>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll("#platformStrip .source-chip").forEach((button) => {
    button.addEventListener("click", async () => {
      state.filters.platform = button.dataset.platform || "";
      $("#platformFilter").value = state.filters.platform;
      state.selectedId = null;
      await Promise.all([loadSummary(), loadLeads()]);
    });
  });
}

function renderRun(run) {
  const badge = $("#runBadge");
  const continuous = run.continuous || {};
  const isRunning = run.status === "running" || continuous.status === "running" || continuous.status === "stopping";
  badge.textContent = isRunning ? "Ativo" : "Pronto";
  badge.className = isRunning ? "badge" : "badge muted";
  $("#scanButton").disabled = isRunning;
  $("#continuousButton").disabled = isRunning;
  $("#stopButton").disabled = continuous.status !== "running" && continuous.status !== "stopping";
  $("#runMessage").textContent = isRunning
    ? "A procurar, qualificar e enriquecer novas oportunidades."
    : "Pipeline pronto para continuar a gerar leads.";
  const completed = Number(run.completedQueries || 0);
  const total = Number(run.totalQueries || 0);
  const pct = total ? Math.round((completed / total) * 100) : run.status === "completed" ? 100 : 0;
  $("#progressBar").style.width = `${Math.min(100, pct)}%`;

  $("#eventList").innerHTML = "";
  iconRefresh();
}

function typeLabel(value = "") {
  const labels = {
    partner: "Parceiro",
    institution: "Instituição",
    recruitment: "Recruta",
    research: "Pesquisa"
  };
  return labels[String(value).toLowerCase()] || value || "Pesquisa";
}

function stageLabel(value = "") {
  const labels = {
    new: "Novo",
    contacted: "Contactado",
    replied: "Respondeu",
    meeting_booked: "Reunião",
    no_show: "No-show",
    negotiating: "Negociação",
    won: "Ganho",
    lost: "Perdido"
  };
  return labels[String(value).toLowerCase()] || String(value || "new").replace(/_/g, " ");
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

function priorityClass(priority) {
  return String(priority || "d").toLowerCase();
}

function renderLeads() {
  const rows = state.leads
    .map((lead) => {
      const selected = lead.id === state.selectedId ? "selected" : "";
      return `
        <tr class="${selected}" data-id="${escapeHtml(lead.id)}">
          <td>
            <div class="lead-name">
              <strong>${escapeHtml(lead.name || lead.title || "Untitled")}</strong>
              <a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a>
              <div class="lead-snippet">${escapeHtml((lead.snippet || "").slice(0, 220))}</div>
            </div>
          </td>
          <td>
            <span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span>
            <div class="mini-gap">${escapeHtml(lead.sourcePack || lead.discoverySource || lead.source || "")}</div>
          </td>
          <td>
            <span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span>
            <div class="mini-gap">${escapeHtml(segmentLabel(lead.segment))}</div>
          </td>
          <td>
            <span class="priority-pill ${priorityClass(lead.priority)}">${escapeHtml(lead.priority || "D")}</span>
            <div class="score">${Number(lead.score || 0)}</div>
          </td>
          <td>${escapeHtml(countryLabel(lead.country))}</td>
          <td><span class="stage-pill">${escapeHtml(stageLabel(lead.stage))}</span></td>
        </tr>
      `;
    })
    .join("");

  $("#leadRows").innerHTML =
    rows ||
    `<tr><td colspan="6"><div class="empty-state"><i data-lucide="search-x"></i><p>No leads yet.</p></div></td></tr>`;

  document.querySelectorAll("#leadRows tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.id;
      renderLeads();
      renderDetail();
    });
  });
  iconRefresh();
}

function renderLinkList(title, links = []) {
  if (!links.length) return "";
  return `
    <div class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="link-list">
        ${links
          .map(
            (link) =>
              `<a class="mini-chip" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(link))}</a>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderForms(forms = []) {
  if (!forms.length) return "";
  return `
    <div class="detail-section">
      <h3>Formulários</h3>
      ${forms
        .map(
          (form) => `
            <div class="message-box">
              <p><strong>${escapeHtml(form.method || "GET")}</strong> ${escapeHtml(shortUrl(form.action || form.pageUrl || ""))}</p>
              <p>${escapeHtml((form.fields || []).join(", ") || form.label || "Contact form")}</p>
              <a class="mini-chip" href="${escapeHtml(form.pageUrl || form.action || "")}" target="_blank" rel="noreferrer">Abrir formulário</a>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function contactTypeLabel(value = "") {
  const labels = {
    email: "Email",
    whatsapp: "WhatsApp validado",
    phone: "Telefone",
    form: "Formulário",
    social: "Social/DM",
    website: "Website",
    "direct-link": "Link direto"
  };
  return labels[String(value).toLowerCase()] || value || "Contacto";
}

function contactHref(contact = "", type = "") {
  if (/^https?:\/\//i.test(contact)) return contact;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return `mailto:${contact}`;
  if (type === "phone") return `tel:${contact.replace(/[^+\d]/g, "")}`;
  return "";
}

function contactDisplay(contact = "") {
  return /^https?:\/\//i.test(contact) ? shortUrl(contact) : contact;
}

function renderBestContact(lead = {}) {
  const contact = lead.bestContact || "";
  if (!contact) return "";
  const type = lead.bestContactType || lead.contactQuality || "";
  const href = contactHref(contact, type);
  const source = lead.bestContactSource || "";
  const contactNode = href
    ? `<a class="mini-chip" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(contactDisplay(contact))}</a>`
    : `<span class="mini-chip">${escapeHtml(contact)}</span>`;

  return `
    <div class="detail-section">
      <h3>Melhor contacto validado</h3>
      <div class="message-box">
        <div class="detail-meta">
          <span class="priority-pill a">${escapeHtml(contactTypeLabel(type))}</span>
          <span class="mini-chip">Confiança ${Number(lead.contactConfidence || 0)}%</span>
        </div>
        <div class="link-list">${contactNode}</div>
        ${source ? `<p>Fonte: ${escapeHtml(contactDisplay(source))}</p>` : ""}
        <button class="copy-button" data-copy="${escapeHtml(contact)}">
          <i data-lucide="copy"></i>
          Copiar contacto
        </button>
      </div>
    </div>
  `;
}

function renderDetail() {
  const lead = state.leads.find((item) => item.id === state.selectedId);
  const panel = $("#detailPanel");
  if (!lead) {
    panel.innerHTML = `<div class="empty-state"><i data-lucide="target"></i><p>Seleciona uma lead.</p></div>`;
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

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-meta">
        <span class="priority-pill ${priorityClass(lead.priority)}">Lead ${escapeHtml(lead.priority || "D")}</span>
        <span class="type-pill ${escapeHtml(lead.leadType || "")}">${escapeHtml(typeLabel(lead.leadType))}</span>
        <span class="source-pill ${platformClass(platformForLead(lead))}">${escapeHtml(platformForLead(lead))}</span>
        <span class="mini-chip">Nota ${Number(lead.score || 0)}</span>
        <span class="mini-chip">Contacto ${lead.contactConfidence || 0}%</span>
      </div>
      <h2>${escapeHtml(lead.name || lead.title || "Untitled")}</h2>
      <a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(lead.url))}</a>
    </div>

    <div class="detail-meta">
      <span class="mini-chip">${escapeHtml(segmentLabel(lead.segment) || "Pesquisa")}</span>
      <span class="mini-chip">${escapeHtml(countryLabel(lead.country))}</span>
      ${languages.map((language) => `<span class="mini-chip">${escapeHtml(language)}</span>`).join("")}
    </div>

    <label class="field stage-select">
      <span>Estado</span>
      <select id="detailStage">
        ${["new", "contacted", "replied", "meeting_booked", "no_show", "negotiating", "won", "lost"]
          .map(
            (stage) =>
              `<option value="${stage}" ${stage === lead.stage ? "selected" : ""}>${stageLabel(stage)}</option>`
          )
          .join("")}
      </select>
    </label>

    <div class="detail-section">
      <h3>Sinais</h3>
      <div class="evidence-list">
        ${(evidence.length ? evidence : ["Needs review"])
          .map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`)
          .join("")}
      </div>
    </div>

    <div class="detail-section">
      <h3>Contexto</h3>
      <p>${escapeHtml(lead.snippet || "No snippet captured.")}</p>
    </div>

    ${renderBestContact(lead)}

    <div class="detail-section">
      <h3>Outbound</h3>
      <div class="message-box">
        <p>${escapeHtml(lead.outbound?.dm || "")}</p>
        <button class="copy-button" data-copy="${escapeHtml(lead.outbound?.dm || "")}">
          <i data-lucide="copy"></i>
          Copy DM
        </button>
      </div>
      <div class="message-box">
        <p>${escapeHtml(lead.outbound?.followUp || "")}</p>
        <button class="copy-button" data-copy="${escapeHtml(lead.outbound?.followUp || "")}">
          <i data-lucide="copy"></i>
          Copy follow-up
        </button>
      </div>
    </div>

    ${
      emails.length
        ? `<div class="detail-section"><h3>Email</h3><div class="link-list">${emails
            .map((email) => `<a class="mini-chip" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`)
            .join("")}</div></div>`
        : ""
    }

    ${
      phoneNumbers.length
        ? `<div class="detail-section"><h3>Telefones</h3><div class="link-list">${phoneNumbers
            .map((phone) => `<span class="mini-chip">${escapeHtml(phone)}</span>`)
            .join("")}</div></div>`
        : ""
    }

    ${renderForms(forms)}
    ${renderLinkList("Social", socialLinks)}
    ${renderLinkList("Contact paths", contactLinks)}
    ${renderLinkList("Websites", websiteLinks)}
  `;

  $("#detailStage").addEventListener("change", async (event) => {
    await api(`/api/leads/${lead.id}`, {
      method: "PATCH",
      body: JSON.stringify({ stage: event.target.value })
    });
    await Promise.all([loadSummary(), loadLeads()]);
  });

  document.querySelectorAll(".copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copy || "");
      button.textContent = "Copied";
      setTimeout(renderDetail, 700);
    });
  });
  iconRefresh();
}

async function startScan() {
  const payload = {
    regionSet: $("#regionSet").value,
    maxQueries: Number($("#maxQueries").value || 32),
    limitPerQuery: Number($("#limitPerQuery").value || 8),
    includePartners: $("#includePartners").checked,
    includeRecruitment: $("#includeRecruitment").checked,
    fetchPages: $("#fetchPages").checked,
    deepEnrich: $("#deepEnrich").checked,
    searchContacts: true
  };
  await api("/api/scan", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadRun();
}

async function startContinuous() {
  const payload = {
    regionSet: $("#regionSet").value,
    maxQueries: Math.max(Number($("#maxQueries").value || 80), 40),
    limitPerQuery: Math.max(Number($("#limitPerQuery").value || 10), 8),
    includePartners: $("#includePartners").checked,
    includeRecruitment: $("#includeRecruitment").checked,
    fetchPages: true,
    deepEnrich: true,
    searchContacts: true,
    delayMs: 8000
  };
  await api("/api/continuous/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadRun();
}

async function stopContinuous() {
  await api("/api/continuous/stop", {
    method: "POST",
    body: JSON.stringify({})
  });
  await loadRun();
}

function bindControls() {
  $("#scanButton").addEventListener("click", async () => {
    try {
      await startScan();
    } catch (error) {
      alert(error.message);
    }
  });
  $("#continuousButton").addEventListener("click", async () => {
    try {
      await startContinuous();
    } catch (error) {
      alert(error.message);
    }
  });
  $("#stopButton").addEventListener("click", async () => {
    try {
      await stopContinuous();
    } catch (error) {
      alert(error.message);
    }
  });

  $("#searchInput").addEventListener("input", (event) => {
    state.filters.q = event.target.value;
    clearTimeout(window.searchTimer);
    window.searchTimer = setTimeout(loadLeads, 220);
  });
  $("#viewModeFilter").addEventListener("change", async (event) => {
    state.filters.viewMode = event.target.value;
    state.selectedId = null;
    await Promise.all([loadSummary(), loadLeads()]);
  });
  $("#platformFilter").addEventListener("change", async (event) => {
    state.filters.platform = event.target.value;
    state.selectedId = null;
    await Promise.all([loadSummary(), loadLeads()]);
  });
  $("#priorityFilter").addEventListener("change", (event) => {
    state.filters.priority = event.target.value;
    state.selectedId = null;
    loadLeads();
  });
  $("#typeFilter").addEventListener("change", (event) => {
    state.filters.leadType = event.target.value;
    state.selectedId = null;
    loadLeads();
  });
  $("#stageFilter").addEventListener("change", (event) => {
    state.filters.stage = event.target.value;
    state.selectedId = null;
    loadLeads();
  });
}

async function tick() {
  await Promise.all([loadSummary(), loadRun(), loadHealth()]);
  await loadLeads();
}

bindControls();
tick().catch((error) => console.error(error));
setInterval(() => {
  Promise.all([loadSummary(), loadRun(), loadHealth()])
    .then(() => {
      const running = state.summary?.activeRun?.status === "running";
      if (running) return loadLeads();
    })
    .catch((error) => console.error(error));
}, 2500);
