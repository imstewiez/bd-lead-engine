import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCAN, SEARCH_PROFILES } from "./config.js";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { runScan } from "./engine.js";
import { filterAndDedupeLeads } from "./exporter.js";
import { getRootDir, listLeads, readDb, updateLead } from "./store.js";
import { platformFromUrl, sleep, toCsvCell } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = getRootDir();
const publicDir = path.join(rootDir, "public");
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

let activeRun = {
  status: "idle",
  message: "Ready",
  events: []
};

let continuous = {
  status: "idle",
  stopRequested: false,
  cycles: 0,
  startedAt: null,
  lastCycleAt: null,
  options: null
};

function pushRunEvent(event) {
  activeRun = {
    ...activeRun,
    ...event,
    events: [
      {
        at: new Date().toISOString(),
        message: event.message,
        status: event.status,
        latestLead: event.latestLead
      },
      ...(activeRun.events || [])
    ].slice(0, 80)
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
  const text = `${platformLower} ${url}`;
  if (value === "social") return /linkedin|instagram|x\/twitter|twitter|telegram|discord|tiktok|facebook|threads|reddit/.test(text);
  if (value === "specialist") return /mql5|myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips/.test(text);
  if (value === "non-mql5") return !/mql5|mql5\.com/.test(text);
  return platformLower === value || url.includes(value);
}

function uiPlatformRank(lead) {
  const text = `${platformForLead(lead)} ${lead.url || ""}`.toLowerCase();
  if (/linkedin/.test(text)) return 0;
  if (/instagram/.test(text)) return 1;
  if (/x\/twitter|x\.com|twitter/.test(text)) return 2;
  if (/telegram|discord|tiktok|facebook|threads|reddit/.test(text)) return 3;
  if (/myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips/.test(text)) return 4;
  if (/regulatory registry|company registry|adviserinfo|opencorporates|company-information/.test(text)) return 5;
  if (/web/.test(text)) return 6;
  if (/mql5/.test(text)) return 12;
  if (/youtube/.test(text)) return 30;
  return 8;
}

function contactRank(lead) {
  return Number(cleanEmails(lead.emails || []).length > 0) * 4 +
    Number(cleanForms(lead.forms || []).length > 0) * 3 +
    Number((lead.decisionMakers || []).length > 0) * 2 +
    Number(hasDirectOutboundPath(lead));
}

function sortForUi(leads) {
  return [...leads].sort(
    (a, b) =>
      uiPlatformRank(a) - uiPlatformRank(b) ||
      contactRank(b) - contactRank(a) ||
      (b.score || 0) - (a.score || 0) ||
      String(b.lastSeen || "").localeCompare(String(a.lastSeen || ""))
  );
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
    booked: leads.filter((lead) => lead.stage === "meeting_booked").length
    ,
    contactable: leads.filter(
      (lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)
    ).length,
    emails: leads.filter((lead) => cleanEmails(lead.emails || []).length).length,
    forms: leads.filter((lead) => cleanForms(lead.forms || []).length).length,
    directLinks: leads.filter(hasDirectOutboundPath).length
  };
  const bySegment = leads.reduce((acc, lead) => {
    acc[lead.segment || "Unclear"] = (acc[lead.segment || "Unclear"] || 0) + 1;
    return acc;
  }, {});
  const byCountry = leads.reduce((acc, lead) => {
    const key = lead.country || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byPlatform = leads.reduce((acc, lead) => {
    const key = platformForLead(lead);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    counts,
    bySegment,
    byCountry,
    byPlatform,
    rawTotal: db.leads?.length || leads.length,
    lastRun: db.runs?.[0] || null,
    activeRun: {
      ...activeRun,
      continuous
    }
  };
}

function applyLeadFilters(leads, filters = {}) {
  let filtered = [...leads];
  const q = String(filters.q || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((lead) =>
      [
        lead.name,
        lead.title,
        lead.snippet,
        lead.url,
        lead.domain,
        lead.country,
        lead.leadType,
        lead.segment,
        ...(lead.languages || []),
        ...(lead.evidence || [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (filters.priority) filtered = filtered.filter((lead) => lead.priority === filters.priority);
  if (filters.leadType) filtered = filtered.filter((lead) => lead.leadType === filters.leadType);
  if (filters.stage) filtered = filtered.filter((lead) => lead.stage === filters.stage);
  if (filters.segment) filtered = filtered.filter((lead) => lead.segment === filters.segment);
  if (filters.platform) filtered = filtered.filter((lead) => platformMatchesFilter(lead, filters.platform));
  return filtered;
}

function leadsForUi(db, query = {}) {
  const includeRaw = String(query.raw || "") === "true";
  const source = includeRaw ? [...db.leads].sort((a, b) => (b.score || 0) - (a.score || 0)) : filterAndDedupeLeads(db.leads);
  return sortForUi(applyLeadFilters(source, query));
}

function buildScanOptions(body = {}, overrides = {}) {
  return {
    ...DEFAULT_SCAN,
    ...body,
    ...overrides,
    maxQueries: Math.min(Number(body.maxQueries || overrides.maxQueries || DEFAULT_SCAN.maxQueries), 240),
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

async function continuousLoop(options) {
  continuous = {
    status: "running",
    stopRequested: false,
    cycles: 0,
    startedAt: new Date().toISOString(),
    lastCycleAt: null,
    options
  };

  while (!continuous.stopRequested) {
    const cycle = continuous.cycles + 1;
    const cycleOptions = {
      ...options,
      queryOffset: continuous.cycles * Number(options.maxQueries || DEFAULT_SCAN.maxQueries),
      deepEnrich: true,
      fetchPages: true,
      searchContacts: true
    };
    activeRun = {
      status: "running",
      message: `Continuous deep scan cycle ${cycle}`,
      events: activeRun.events || []
    };

    try {
      await runScan(cycleOptions, (event) => {
        pushRunEvent({
          ...event,
          status: event.status === "completed" && !continuous.stopRequested ? "running" : event.status,
          message: `[continuous ${cycle}] ${event.message}`
        });
      });
      continuous = {
        ...continuous,
        cycles: cycle,
        lastCycleAt: new Date().toISOString()
      };
    } catch (error) {
      pushRunEvent({
        status: "failed",
        message: `[continuous ${cycle}] ${error.message}`,
        error: error.stack
      });
    }

    if (!continuous.stopRequested) {
      pushRunEvent({
        status: "running",
        message: `Continuous deep scan waiting before cycle ${cycle + 1}`
      });
      await sleep(Number(options.delayMs || 8000));
    }
  }

  continuous = {
    ...continuous,
    status: "stopped",
    stoppedAt: new Date().toISOString()
  };
  activeRun = {
    ...activeRun,
    status: "idle",
    message: "Continuous deep scan stopped"
  };
}

app.get("/api/config", (_req, res) => {
  res.json({
    defaultScan: DEFAULT_SCAN,
    searchProfiles: SEARCH_PROFILES
  });
});

app.get("/api/summary", async (req, res, next) => {
  try {
    const db = await readDb();
    res.json(summarize(leadsForUi(db, req.query), db));
  } catch (error) {
    next(error);
  }
});

app.get("/api/leads", async (req, res, next) => {
  try {
    const db = await readDb();
    const leads = leadsForUi(db, req.query);
    const limit = Math.min(Number(req.query.limit || 250), 1000);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    res.json({
      total: leads.length,
      leads: leads.slice(offset, offset + limit)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/leads/:id", async (req, res, next) => {
  try {
    const patch = {};
    if (typeof req.body.stage === "string") patch.stage = req.body.stage;
    if (typeof req.body.notes === "string") patch.notes = req.body.notes;
    const lead = await updateLead(req.params.id, patch);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ lead });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scan", async (req, res) => {
  if (activeRun.status === "running") {
    return res.status(409).json({ error: "A scan is already running", activeRun });
  }

  const options = buildScanOptions(req.body);

  activeRun = {
    status: "running",
    message: "Starting scan",
    events: []
  };

  runScan(options, pushRunEvent).catch((error) => {
    pushRunEvent({
      status: "failed",
      message: error.message,
      error: error.stack
    });
  });

  res.json({ ok: true, activeRun });
});

app.get("/api/run", (_req, res) => {
  res.json({
    ...activeRun,
    continuous
  });
});

app.post("/api/continuous/start", async (req, res) => {
  if (activeRun.status === "running" || continuous.status === "running") {
    return res.status(409).json({ error: "A scan is already running", activeRun, continuous });
  }
  const options = buildScanOptions(req.body, {
    maxQueries: 80,
    limitPerQuery: 10,
    deepEnrich: true
  });
  continuousLoop(options).catch((error) => {
    continuous = {
      ...continuous,
      status: "failed",
      error: error.message
    };
    pushRunEvent({
      status: "failed",
      message: error.message,
      error: error.stack
    });
  });
  res.json({ ok: true, continuous });
});

app.post("/api/continuous/stop", (_req, res) => {
  if (continuous.status !== "running") {
    return res.json({ ok: true, continuous });
  }
  continuous = {
    ...continuous,
    stopRequested: true,
    status: "stopping"
  };
  pushRunEvent({
    status: "running",
    message: "Stop requested. Finishing current cycle."
  });
  res.json({ ok: true, continuous });
});

app.get("/api/export.json", async (req, res, next) => {
  try {
    const db = await readDb();
    const leads = leadsForUi(db, req.query);
    res.setHeader("content-type", "application/json");
    res.setHeader("content-disposition", "attachment; filename=bd-leads.json");
    res.send(JSON.stringify(leads, null, 2));
  } catch (error) {
    next(error);
  }
});

app.get("/api/export.csv", async (req, res, next) => {
  try {
    const db = await readDb();
    const leads = leadsForUi(db, req.query);
    const columns = [
      "priority",
      "score",
      "leadType",
      "segment",
      "stage",
      "name",
      "country",
      "languages",
      "url",
      "domain",
      "emails",
      "socialLinks",
      "contactLinks",
      "websiteLinks",
      "phoneNumbers",
      "forms",
      "contactQuality",
      "contactConfidence",
      "contactSources",
      "evidence",
      "outboundDm",
      "followUp",
      "snippet"
    ];
    const rows = [
      columns.join(","),
      ...leads.map((lead) =>
        [
          lead.priority,
          lead.score,
          lead.leadType,
          lead.segment,
          lead.stage,
          lead.name,
          lead.country,
          lead.languages,
          lead.url,
          lead.domain,
          lead.emails,
          lead.socialLinks,
          lead.contactLinks,
          lead.websiteLinks,
          lead.phoneNumbers,
          (lead.forms || []).map((form) => `${form.pageUrl} -> ${form.action} (${(form.fields || []).join("; ")})`),
          lead.contactQuality,
          lead.contactConfidence,
          lead.contactSources,
          lead.evidence,
          lead.outbound?.dm,
          lead.outbound?.followUp,
          lead.snippet
        ]
          .map(toCsvCell)
          .join(",")
      )
    ];
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", "attachment; filename=bd-leads.csv");
    res.send(`${rows.join("\n")}\n`);
  } catch (error) {
    next(error);
  }
});

app.get("/api/autopilot/status", async (_req, res, next) => {
  try {
    const statusPath = path.join(rootDir, "data", "autopilot-status.json");
    const raw = await fs.readFile(statusPath, "utf8");
    res.json(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return res.json({ status: "idle" });
    next(error);
  }
});

app.get("/autopilot-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-leads.csv"));
});

app.get("/autopilot-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-leads.json"));
});

app.get("/autopilot-contactable-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-contactable-leads.csv"));
});

app.get("/autopilot-contactable-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-contactable-leads.json"));
});

app.get("/autopilot-qualified-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-qualified-leads.csv"));
});

app.get("/autopilot-qualified-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-qualified-leads.json"));
});

app.get("/autopilot-qualified-contactable-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-qualified-contactable-leads.csv"));
});

app.get("/autopilot-qualified-contactable-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-qualified-contactable-leads.json"));
});

app.get("/autopilot-hot-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-hot-leads.csv"));
});

app.get("/autopilot-hot-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-hot-leads.json"));
});

app.get("/autopilot-social-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-social-leads.csv"));
});

app.get("/autopilot-social-leads.json", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-social-leads.json"));
});

app.get("/autopilot-instagram-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-instagram-leads.csv"));
});

app.get("/autopilot-linkedin-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-linkedin-leads.csv"));
});

app.get("/autopilot-x-leads.csv", (_req, res) => {
  res.sendFile(path.join(rootDir, "autopilot-x-leads.csv"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message });
});

app.listen(PORT, () => {
  console.log(`BD Lead Engine running at http://localhost:${PORT}`);
});
