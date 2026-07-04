import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCAN, SEARCH_PROFILES } from "./config.js";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { runScan } from "./engine.js";
import { filterAndDedupeLeads } from "./exporter.js";
import { clusterLeads, rankLeadsCommercially } from "./intelligence.js";
import { countBySource, sourceBucket } from "./mql5-limit.js";
import { getRootDir, readDb, updateLead } from "./store.js";
import { platformFromUrl, sleep, toCsvCell } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = getRootDir();
const publicDir = path.join(rootDir, "public");
const PORT = Number(process.env.PORT || 8787);

const SCAN_PRESETS = {
  quality: { maxQueries: 90, limitPerQuery: 8, deepEnrich: true, fetchPages: true, searchContacts: true, maxContactPages: 8, maxExternalWebsites: 6, maxTrailQueries: 24, trailLimit: 8, exportEvery: 3 },
  volume: { maxQueries: 220, limitPerQuery: 15, deepEnrich: true, fetchPages: true, searchContacts: true, maxContactPages: 5, maxExternalWebsites: 4, maxTrailQueries: 16, trailLimit: 6, exportEvery: 5 },
  social: { maxQueries: 160, limitPerQuery: 12, deepEnrich: true, fetchPages: true, searchContacts: true, maxContactPages: 6, maxExternalWebsites: 5, maxTrailQueries: 18, trailLimit: 7, includePartners: false, includeRecruitment: false, includeIntentPosts: true, includeEcosystem: false, includeSocialProfiles: true, includeForums: true, includeSpecialistSources: false, exportEvery: 4 },
  latam: { regionSet: "latam", maxQueries: 180, limitPerQuery: 12, deepEnrich: true, fetchPages: true, searchContacts: true, maxContactPages: 7, maxExternalWebsites: 5, maxTrailQueries: 22, trailLimit: 8, exportEvery: 4 },
  super: { regionSet: "global", maxQueries: 260, limitPerQuery: 15, deepEnrich: true, fetchPages: true, searchContacts: true, maxContactPages: 8, maxExternalWebsites: 6, maxTrailQueries: 24, trailLimit: 8, includePartners: true, includeRecruitment: true, includeIntentPosts: true, includeEcosystem: true, includeSocialProfiles: true, includeForums: true, includeSpecialistSources: true, exportEvery: 3, delayMs: 7000 }
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

let activeRun = { status: "idle", message: "Ready", events: [] };
let continuous = { status: "idle", stopRequested: false, cycles: 0, startedAt: null, lastCycleAt: null, options: null };

function pushRunEvent(event) {
  activeRun = {
    ...activeRun,
    ...event,
    events: [{ at: new Date().toISOString(), message: event.message, status: event.status, latestLead: event.latestLead, sourceStats: event.sourceStats }, ...(activeRun.events || [])].slice(0, 80)
  };
}

function platformForLead(lead = {}) {
  return lead.platform || platformFromUrl(lead.url || "") || "Unknown";
}

function platformMatchesFilter(lead, filter) {
  const value = String(filter || "").trim().toLowerCase();
  if (!value) return true;
  const platform = platformForLead(lead);
  const platformLower = platform.toLowerCase();
  const url = String(lead.url || "").toLowerCase();
  const text = `${platformLower} ${url} ${sourceBucket(lead)}`;
  if (value === "social") return /linkedin|instagram|x\/twitter|twitter|telegram|discord|tiktok|facebook|threads|reddit/.test(text);
  if (value === "specialist") return /mql5|myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips/.test(text);
  if (value === "non-mql5") return !/mql5|mql5\.com/.test(text);
  return platformLower === value || url.includes(value) || sourceBucket(lead) === value;
}

function uiPlatformRank(lead) {
  const text = `${platformForLead(lead)} ${lead.url || ""} ${sourceBucket(lead)}`.toLowerCase();
  if (/linkedin/.test(text)) return 0;
  if (/instagram/.test(text)) return 1;
  if (/x\/twitter|x\.com|twitter/.test(text)) return 2;
  if (/telegram|discord|tiktok|facebook|threads|reddit/.test(text)) return 3;
  if (/myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips/.test(text)) return 4;
  if (/ecosystem|regulatory registry|company registry|adviserinfo|opencorporates|company-information/.test(text)) return 5;
  if (/web/.test(text)) return 6;
  if (/mql5/.test(text)) return 12;
  if (/youtube/.test(text)) return 30;
  return 8;
}

function contactRank(lead) {
  return Number(cleanEmails(lead.emails || []).length > 0) * 4 + Number(cleanForms(lead.forms || []).length > 0) * 3 + Number((lead.decisionMakers || []).length > 0) * 2 + Number(hasDirectOutboundPath(lead));
}

function sortForUi(leads) {
  return rankLeadsCommercially(leads).sort((a, b) => Number(b.commercialScore || 0) - Number(a.commercialScore || 0) || uiPlatformRank(a) - uiPlatformRank(b) || contactRank(b) - contactRank(a) || Number(b.score || 0) - Number(a.score || 0) || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));
}

function buildDiagnostics(db, visibleLeads = []) {
  const rawLeads = db.leads || [];
  const latestRun = db.runs?.[0] || null;
  const qualifiedBySource = countBySource(visibleLeads);
  const rawBySource = countBySource(rawLeads);
  const contactableBySource = countBySource(rawLeads.filter((lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)));
  const bySource = Object.keys({ ...rawBySource, ...qualifiedBySource, ...contactableBySource }).sort().map((bucket) => ({ bucket, raw: rawBySource[bucket] || 0, qualified: qualifiedBySource[bucket] || 0, contactable: contactableBySource[bucket] || 0, lastRun: latestRun?.sourceStats?.[bucket] || null }));
  return {
    updatedAt: new Date().toISOString(),
    totals: { raw: rawLeads.length, qualified: visibleLeads.length, contactable: visibleLeads.filter((lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)).length, clusters: clusterLeads(visibleLeads).length },
    bySource,
    lastRun: latestRun ? { id: latestRun.id, startedAt: latestRun.startedAt, finishedAt: latestRun.finishedAt, totalQueries: latestRun.totalQueries, rawResults: latestRun.rawResults, leadsFound: latestRun.leadsFound, created: latestRun.created, updated: latestRun.updated, sourceStats: latestRun.sourceStats || {}, qualifiedBySource: latestRun.qualifiedBySource || {} } : null,
    activeRun: { ...activeRun, continuous }
  };
}

function summarize(leads, db) {
  const counts = {
    total: leads.length,
    priorityA: leads.filter((lead) => lead.priority === "A").length,
    priorityB: leads.filter((lead) => lead.priority === "B").length,
    partners: leads.filter((lead) => lead.leadType === "partner").length,
    recruitment: leads.filter((lead) => lead.leadType === "recruitment").length,
    institutions: leads.filter((lead) => lead.leadType === "institution").length,
    new: leads.filter((lead) => lead.stage === "new").length,
    contacted: leads.filter((lead) => lead.stage === "contacted").length,
    booked: leads.filter((lead) => lead.stage === "meeting_booked").length,
    contactable: leads.filter((lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)).length,
    emails: leads.filter((lead) => cleanEmails(lead.emails || []).length).length,
    forms: leads.filter((lead) => cleanForms(lead.forms || []).length).length,
    directLinks: leads.filter(hasDirectOutboundPath).length,
    clusters: clusterLeads(leads).length
  };
  const bySegment = leads.reduce((acc, lead) => { acc[lead.segment || "Unclear"] = (acc[lead.segment || "Unclear"] || 0) + 1; return acc; }, {});
  const byCountry = leads.reduce((acc, lead) => { const key = lead.country || "Unknown"; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const byPlatform = leads.reduce((acc, lead) => { const key = platformForLead(lead); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  return { counts, bySegment, byCountry, byPlatform, bySource: countBySource(leads), diagnostics: buildDiagnostics(db, leads), rawTotal: db.leads?.length || leads.length, lastRun: db.runs?.[0] || null, activeRun: { ...activeRun, continuous } };
}

function applyLeadFilters(leads, filters = {}) {
  let filtered = [...leads];
  const q = String(filters.q || "").trim().toLowerCase();
  if (q) filtered = filtered.filter((lead) => [lead.name, lead.title, lead.snippet, lead.url, lead.domain, lead.country, lead.leadType, lead.segment, sourceBucket(lead), ...(lead.languages || []), ...(lead.evidence || [])].filter(Boolean).join(" ").toLowerCase().includes(q));
  if (filters.priority) filtered = filtered.filter((lead) => lead.priority === filters.priority);
  if (filters.leadType) filtered = filtered.filter((lead) => lead.leadType === filters.leadType);
  if (filters.stage) filtered = filtered.filter((lead) => lead.stage === filters.stage);
  if (filters.segment) filtered = filtered.filter((lead) => lead.segment === filters.segment);
  if (filters.platform) filtered = filtered.filter((lead) => platformMatchesFilter(lead, filters.platform));
  return filtered;
}

function leadsForUi(db, query = {}) {
  const includeRaw = String(query.raw || "") === "true";
  const source = includeRaw ? [...db.leads].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)) : filterAndDedupeLeads(db.leads);
  return sortForUi(applyLeadFilters(source, query));
}

function buildScanOptions(body = {}, overrides = {}) {
  return {
    ...DEFAULT_SCAN,
    ...body,
    ...overrides,
    maxQueries: Math.min(Number(body.maxQueries || overrides.maxQueries || DEFAULT_SCAN.maxQueries), 400),
    limitPerQuery: Math.min(Number(body.limitPerQuery || overrides.limitPerQuery || DEFAULT_SCAN.limitPerQuery), 25),
    fetchPages: body.fetchPages !== false,
    deepEnrich: Boolean(body.deepEnrich || overrides.deepEnrich),
    searchContacts: body.searchContacts !== false,
    maxContactPages: Number(body.maxContactPages || overrides.maxContactPages || 4),
    maxExternalWebsites: Number(body.maxExternalWebsites || overrides.maxExternalWebsites || 3),
    maxTrailQueries: Number(body.maxTrailQueries || overrides.maxTrailQueries || 14),
    trailLimit: Number(body.trailLimit || overrides.trailLimit || 5),
    exportEvery: Number(body.exportEvery || overrides.exportEvery || 5),
    incremental: true,
    includePartners: body.includePartners !== false,
    includeRecruitment: body.includeRecruitment !== false,
    includeIntentPosts: body.includeIntentPosts !== false,
    includeEcosystem: body.includeEcosystem !== false,
    includeSocialProfiles: body.includeSocialProfiles !== false,
    includeForums: body.includeForums !== false,
    includeSpecialistSources: body.includeSpecialistSources !== false,
    includeYouTube: body.includeYouTube === true || overrides.includeYouTube === true
  };
}

function startRun(options, label = "scan") {
  activeRun = { status: "running", message: `Starting ${label}`, events: [] };
  runScan(options, pushRunEvent).catch((error) => pushRunEvent({ status: "failed", message: error.message, error: error.stack }));
}

async function continuousLoop(options) {
  continuous = { status: "running", stopRequested: false, cycles: 0, startedAt: new Date().toISOString(), lastCycleAt: null, options };
  while (!continuous.stopRequested) {
    const cycle = continuous.cycles + 1;
    const cycleOptions = { ...options, queryOffset: continuous.cycles * Number(options.maxQueries || DEFAULT_SCAN.maxQueries), deepEnrich: true, fetchPages: true, searchContacts: true };
    activeRun = { status: "running", message: `Continuous deep scan cycle ${cycle}`, events: activeRun.events || [] };
    try {
      await runScan(cycleOptions, (event) => pushRunEvent({ ...event, status: event.status === "completed" && !continuous.stopRequested ? "running" : event.status, message: `[continuous ${cycle}] ${event.message}` }));
      continuous = { ...continuous, cycles: cycle, lastCycleAt: new Date().toISOString() };
    } catch (error) {
      pushRunEvent({ status: "failed", message: `[continuous ${cycle}] ${error.message}`, error: error.stack });
    }
    if (!continuous.stopRequested) {
      pushRunEvent({ status: "running", message: `Continuous deep scan waiting before cycle ${cycle + 1}` });
      await sleep(Number(options.delayMs || 8000));
    }
  }
  continuous = { ...continuous, status: "stopped", stoppedAt: new Date().toISOString() };
  activeRun = { ...activeRun, status: "idle", message: "Continuous deep scan stopped" };
}

function autoStartSuper() {
  if (process.env.AUTO_START_SOURCING === "false") return;
  if (activeRun.status === "running" || continuous.status === "running") return;
  const options = buildScanOptions(SCAN_PRESETS.super, SCAN_PRESETS.super);
  continuousLoop(options).catch((error) => {
    continuous = { ...continuous, status: "failed", error: error.message };
    pushRunEvent({ status: "failed", message: error.message, error: error.stack });
  });
}

app.get("/api/config", (_req, res) => res.json({ defaultScan: DEFAULT_SCAN, searchProfiles: SEARCH_PROFILES, scanPresets: SCAN_PRESETS, autoStart: process.env.AUTO_START_SOURCING !== "false" }));
app.get("/api/summary", async (req, res, next) => { try { const db = await readDb(); res.json(summarize(leadsForUi(db, req.query), db)); } catch (error) { next(error); } });
app.get("/api/diagnostics", async (req, res, next) => { try { const db = await readDb(); res.json(buildDiagnostics(db, leadsForUi(db, req.query))); } catch (error) { next(error); } });
app.get("/api/clusters", async (req, res, next) => { try { const db = await readDb(); const leads = leadsForUi(db, req.query); const clusters = clusterLeads(leads); res.json({ total: clusters.length, clusters }); } catch (error) { next(error); } });
app.get("/api/leads", async (req, res, next) => { try { const db = await readDb(); const leads = leadsForUi(db, req.query); const limit = Math.min(Number(req.query.limit || 250), 1000); const offset = Math.max(Number(req.query.offset || 0), 0); res.json({ total: leads.length, leads: leads.slice(offset, offset + limit) }); } catch (error) { next(error); } });
app.patch("/api/leads/:id", async (req, res, next) => { try { const patch = {}; if (typeof req.body.stage === "string") patch.stage = req.body.stage; if (typeof req.body.notes === "string") patch.notes = req.body.notes; const lead = await updateLead(req.params.id, patch); if (!lead) return res.status(404).json({ error: "Lead not found" }); res.json({ lead }); } catch (error) { next(error); } });
app.post("/api/scan", async (req, res) => { if (activeRun.status === "running") return res.status(409).json({ error: "A scan is already running", activeRun }); const options = buildScanOptions(req.body); startRun(options, "scan"); res.json({ ok: true, activeRun, options }); });
app.post("/api/scan/preset/:preset", async (req, res) => { if (activeRun.status === "running") return res.status(409).json({ error: "A scan is already running", activeRun }); const preset = SCAN_PRESETS[req.params.preset]; if (!preset) return res.status(404).json({ error: "Unknown preset", available: Object.keys(SCAN_PRESETS) }); const options = buildScanOptions({ ...preset, ...(req.body || {}) }, preset); startRun(options, `${req.params.preset} preset`); res.json({ ok: true, preset: req.params.preset, activeRun, options }); });
app.get("/api/run", (_req, res) => res.json({ ...activeRun, continuous }));
app.post("/api/continuous/start", async (req, res) => { if (activeRun.status === "running" || continuous.status === "running") return res.status(409).json({ error: "A scan is already running", activeRun, continuous }); const options = buildScanOptions(req.body, SCAN_PRESETS.super); continuousLoop(options).catch((error) => { continuous = { ...continuous, status: "failed", error: error.message }; pushRunEvent({ status: "failed", message: error.message, error: error.stack }); }); res.json({ ok: true, continuous, options }); });
app.post("/api/continuous/stop", (_req, res) => { if (continuous.status !== "running") return res.json({ ok: true, continuous }); continuous = { ...continuous, stopRequested: true, status: "stopping" }; pushRunEvent({ status: "running", message: "Stop requested. Finishing current cycle." }); res.json({ ok: true, continuous }); });
app.get("/api/export.json", async (req, res, next) => { try { const db = await readDb(); const leads = leadsForUi(db, req.query); res.setHeader("content-type", "application/json"); res.setHeader("content-disposition", "attachment; filename=bd-leads.json"); res.send(JSON.stringify(leads, null, 2)); } catch (error) { next(error); } });
app.get("/api/export.csv", async (req, res, next) => { try { const db = await readDb(); const leads = leadsForUi(db, req.query); const columns = ["commercialScore", "sourceBucket", "priority", "score", "leadType", "segment", "stage", "name", "country", "languages", "url", "domain", "emails", "socialLinks", "contactLinks", "websiteLinks", "phoneNumbers", "forms", "contactQuality", "contactConfidence", "contactSources", "evidence", "outboundDm", "followUp", "snippet"]; const rows = [columns.join(","), ...leads.map((lead) => [lead.commercialScore, lead.sourceBucket, lead.priority, lead.score, lead.leadType, lead.segment, lead.stage, lead.name, lead.country, lead.languages, lead.url, lead.domain, lead.emails, lead.socialLinks, lead.contactLinks, lead.websiteLinks, lead.phoneNumbers, (lead.forms || []).map((form) => `${form.pageUrl} -> ${form.action} (${(form.fields || []).join("; ")})`), lead.contactQuality, lead.contactConfidence, lead.contactSources, lead.evidence, lead.outbound?.dm, lead.outbound?.followUp, lead.snippet].map(toCsvCell).join(","))]; res.setHeader("content-type", "text/csv; charset=utf-8"); res.setHeader("content-disposition", "attachment; filename=bd-leads.csv"); res.send(`${rows.join("\n")}\n`); } catch (error) { next(error); } });
app.get("/api/autopilot/status", async (_req, res, next) => { try { const statusPath = path.join(rootDir, "data", "autopilot-status.json"); const raw = await fs.readFile(statusPath, "utf8"); res.json(JSON.parse(raw)); } catch (error) { if (error.code === "ENOENT") return res.json({ status: "idle" }); next(error); } });

app.get("/autopilot-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-leads.csv")));
app.get("/autopilot-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-leads.json")));
app.get("/autopilot-contactable-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-contactable-leads.csv")));
app.get("/autopilot-contactable-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-contactable-leads.json")));
app.get("/autopilot-qualified-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-qualified-leads.csv")));
app.get("/autopilot-qualified-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-qualified-leads.json")));
app.get("/autopilot-qualified-contactable-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-qualified-contactable-leads.csv")));
app.get("/autopilot-qualified-contactable-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-qualified-contactable-leads.json")));
app.get("/autopilot-hot-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-hot-leads.csv")));
app.get("/autopilot-hot-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-hot-leads.json")));
app.get("/autopilot-social-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-social-leads.csv")));
app.get("/autopilot-social-leads.json", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-social-leads.json")));
app.get("/autopilot-instagram-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-instagram-leads.csv")));
app.get("/autopilot-linkedin-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-linkedin-leads.csv")));
app.get("/autopilot-x-leads.csv", (_req, res) => res.sendFile(path.join(rootDir, "autopilot-x-leads.csv")));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: error.message }); });

app.listen(PORT, () => {
  console.log(`BD Lead Engine running at http://localhost:${PORT}`);
  console.log(process.env.AUTO_START_SOURCING === "false" ? "Auto sourcing disabled." : "Auto sourcing enabled: super continuous mode will start automatically.");
  setTimeout(autoStartSuper, 1200);
});
