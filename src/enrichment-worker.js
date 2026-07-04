import fs from "node:fs/promises";
import path from "node:path";
import { classifyResult } from "./classify.js";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers } from "./contact-cleaner.js";
import { deepEnrichResult } from "./deep.js";
import { exportLeads, isWorkingLead } from "./exporter.js";
import { hasStrictTradingIcp, leadRejectionReasons } from "./lead-quality.js";
import { commercialScoreForLead } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { isPlatformProfileUrl } from "./platform-enrichment.js";
import { getRootDir, readDb, updateLead, upsertLeads } from "./store.js";
import { normalizeWhitespace, nowIso, platformFromUrl, sleep, unique } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "enrichment-worker-status.json");
const logPath = path.join(dataDir, "enrichment-worker.log");
const stopPath = path.join(dataDir, "enrichment-worker-stop");

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

function numberArg(name, fallback) {
  const parsed = Number(args.get(name) || process.env[name.toUpperCase()] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const options = {
  delayMs: Math.max(500, numberArg("delayMs", 2500)),
  idleMs: Math.max(5000, numberArg("idleMs", 30000)),
  staleHours: Math.max(1, numberArg("staleHours", 72)),
  hotStaleHours: Math.max(1, numberArg("hotStaleHours", 12)),
  contactlessStaleHours: Math.max(1, numberArg("contactlessStaleHours", 18)),
  maxAttempts: Math.max(1, numberArg("maxAttempts", 8)),
  maxContactPages: Math.max(1, Math.min(numberArg("maxContactPages", 6), 14)),
  maxExternalWebsites: Math.max(0, Math.min(numberArg("maxExternalWebsites", 4), 10)),
  maxTrailQueries: Math.max(2, Math.min(numberArg("maxTrailQueries", 14), 28)),
  trailLimit: Math.max(2, Math.min(numberArg("trailLimit", 6), 14))
};

async function appendLog(message) {
  await fs.mkdir(dataDir, { recursive: true });
  const line = `${nowIso()} ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
  console.log(message);
}

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

async function stopRequested() {
  try {
    await fs.access(stopPath);
    return true;
  } catch {
    return false;
  }
}

async function clearStopFile() {
  await fs.rm(stopPath, { force: true }).catch(() => {});
}

function hasFreshRunningStatus(lead) {
  if (lead.deepStatus !== "running") return false;
  const started = Date.parse(lead.deepStartedAt || "");
  return Number.isFinite(started) && Date.now() - started < 60 * 60 * 1000;
}

function needsEnrichment(lead) {
  if (!lead?.id || !lead.url) return false;
  if (/youtube\.com|youtu\.be/i.test(String(lead.url))) return false;
  if (!["partner", "recruitment", "institution"].includes(lead.leadType)) return false;
  if (lead.segment === "Broker Site" && lead.leadType !== "recruitment") return false;
  if (hasFreshRunningStatus(lead)) return false;
  if (!isWorkingLead(lead) && !hasStrictTradingIcp(lead)) return false;
  if ((lead.enrichmentAttempts || 0) >= options.maxAttempts && contactCompleteness(lead) < 20) return false;

  const last = Date.parse(lead.lastDeepEnrichedAt || "");
  if (!Number.isFinite(last)) return true;
  const commercialScore = commercialScoreForLead(lead);
  const refreshHours =
    contactCompleteness(lead) < 35
      ? options.contactlessStaleHours
      : commercialScore >= 78 || lead.priority === "A"
        ? options.hotStaleHours
        : options.staleHours;
  return Date.now() - last > refreshHours * 60 * 60 * 1000;
}

function contactCompleteness(lead) {
  let score = 0;
  if ((lead.emails || []).length) score += 30;
  if ((lead.phoneNumbers || []).length) score += 20;
  if ((lead.forms || []).length) score += 20;
  if ((lead.websiteLinks || []).length) score += 10;
  if ((lead.decisionMakers || []).length) score += 20;
  if ((lead.contactLinks || []).length) score += 10;
  return score;
}

function platformRank(lead) {
  const bucket = sourceBucket(lead);
  if (["linkedin", "instagram", "x", "telegram", "discord", "tiktok", "facebook_threads"].includes(bucket)) return 0;
  if (["forum", "ecosystem", "recruitment"].includes(bucket)) return 1;
  if (["myfxbook", "tradingview", "specialist"].includes(bucket)) return 2;
  if (bucket === "web") return 3;
  if (bucket === "mql5") return 4;
  return 5;
}

function pickNextLead(leads) {
  return leads
    .filter(needsEnrichment)
    .sort((a, b) => {
      const completenessA = contactCompleteness(a);
      const completenessB = contactCompleteness(b);
      const commercialA = commercialScoreForLead(a);
      const commercialB = commercialScoreForLead(b);
      return (
        Number(completenessB < 35) - Number(completenessA < 35) ||
        Number(b.priority === "A") - Number(a.priority === "A") ||
        commercialB - commercialA ||
        platformRank(a) - platformRank(b) ||
        completenessA - completenessB ||
        (b.score || 0) - (a.score || 0) ||
        String(a.lastDeepEnrichedAt || "").localeCompare(String(b.lastDeepEnrichedAt || ""))
      );
    })[0];
}

function maybeBaseValues(base, resetPlatformContacts, key) {
  return resetPlatformContacts ? [] : base[key] || [];
}

function mergeLeadEnrichment(base, enriched) {
  const resetPlatformContacts = isPlatformProfileUrl(base.url);
  return {
    ...base,
    ...enriched,
    snippet: normalizeWhitespace([
      base.snippet,
      enriched.snippet,
      enriched.pageDescription
    ].filter(Boolean).join(" ")).slice(0, 1400),
    emails: cleanEmails([...maybeBaseValues(base, resetPlatformContacts, "emails"), ...(enriched.emails || [])]),
    phoneNumbers: cleanPhoneNumbers([...maybeBaseValues(base, resetPlatformContacts, "phoneNumbers"), ...(enriched.phoneNumbers || [])]),
    forms: cleanForms([...maybeBaseValues(base, resetPlatformContacts, "forms"), ...(enriched.forms || [])]),
    contactLinks: cleanLinks([...maybeBaseValues(base, resetPlatformContacts, "contactLinks"), ...(enriched.contactLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    socialLinks: cleanLinks([base.url, ...maybeBaseValues(base, resetPlatformContacts, "socialLinks"), ...(enriched.socialLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    websiteLinks: cleanLinks([...maybeBaseValues(base, resetPlatformContacts, "websiteLinks"), ...(enriched.websiteLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    relatedLinks: unique([...maybeBaseValues(base, resetPlatformContacts, "relatedLinks"), ...(enriched.relatedLinks || [])]).slice(0, 35),
    contactSources: unique([...maybeBaseValues(base, resetPlatformContacts, "contactSources"), ...(enriched.contactSources || [])]).slice(0, 25),
    decisionMakerLinks: unique([...(base.decisionMakerLinks || []), ...(enriched.decisionMakerLinks || [])]).slice(0, 12),
    decisionMakers: [...(base.decisionMakers || []), ...(enriched.decisionMakers || [])].slice(0, 10),
    contactConfidence: resetPlatformContacts
      ? Number(enriched.contactConfidence || 0)
      : Math.max(Number(base.contactConfidence || 0), Number(enriched.contactConfidence || 0)),
    bestContact: enriched.bestContact || (resetPlatformContacts ? "" : base.bestContact || ""),
    bestContactType: enriched.bestContactType || (resetPlatformContacts ? "" : base.bestContactType || ""),
    bestContactSource: enriched.bestContactSource || (resetPlatformContacts ? "" : base.bestContactSource || ""),
    platform: enriched.platform || base.platform || platformFromUrl(base.url)
  };
}

async function enrichOne(lead) {
  await updateLead(lead.id, {
    deepStatus: "running",
    deepStartedAt: nowIso(),
    enrichmentAttempts: Number(lead.enrichmentAttempts || 0) + 1
  });

  const enriched = await deepEnrichResult(lead, {
    searchContacts: true,
    maxContactPages: options.maxContactPages,
    maxExternalWebsites: options.maxExternalWebsites,
    maxTrailQueries: options.maxTrailQueries,
    trailLimit: options.trailLimit
  });

  const merged = mergeLeadEnrichment(lead, enriched);
  const classified = classifyResult(merged, merged.sourceIntent || merged.leadType || "partner");
  const finalLead = {
    ...classified,
    deepStatus: "done",
    deepFinishedAt: nowIso(),
    lastDeepEnrichedAt: nowIso(),
    enrichmentWorker: true
  };

  const reasons = leadRejectionReasons(finalLead);
  if (reasons.length) {
    await updateLead(lead.id, {
      deepStatus: "rejected",
      deepFinishedAt: nowIso(),
      lastDeepEnrichedAt: nowIso(),
      rejectionReasons: reasons
    });
    return { status: "rejected", lead: finalLead, reasons };
  }

  const stored = await upsertLeads([finalLead], `enrichment_worker_${Date.now()}`);
  const exported = await exportLeads({
    csvName: "autopilot-leads.csv",
    jsonName: "autopilot-leads.json"
  });
  return { status: "stored", lead: finalLead, stored, exported };
}

await clearStopFile();
await appendLog(`[enrichment-worker] Started with ${JSON.stringify(options)}`);
await writeStatus({ status: "running", phase: "started", options });

let processed = 0;
let rejected = 0;
let errors = 0;

while (!(await stopRequested())) {
  const db = await readDb();
  const lead = pickNextLead(db.leads || []);

  if (!lead) {
    await writeStatus({ status: "running", phase: "idle", options, processed, rejected, errors, total: db.leads.length });
    await sleep(options.idleMs);
    continue;
  }

  await writeStatus({
    status: "running",
    phase: "enriching",
    options,
    processed,
    rejected,
    errors,
    current: { id: lead.id, name: lead.name, url: lead.url, platform: lead.platform }
  });

  try {
    const result = await enrichOne(lead);
    processed += 1;
    if (result.status === "rejected") rejected += 1;
    await appendLog(
      `[enrichment-worker] ${result.status} ${lead.id} ${lead.name || lead.url}; emails=${(result.lead.emails || []).length}; links=${(result.lead.contactLinks || []).length}; makers=${(result.lead.decisionMakers || []).length}`
    );
  } catch (error) {
    errors += 1;
    await updateLead(lead.id, {
      deepStatus: "error",
      deepFinishedAt: nowIso(),
      enrichmentErrors: unique([...(lead.enrichmentErrors || []), error.message]).slice(0, 8)
    }).catch(() => {});
    await appendLog(`[enrichment-worker] error ${lead.id} ${error.stack || error.message}`);
  }

  if (!(await stopRequested())) await sleep(options.delayMs);
}

await exportLeads({
  csvName: "autopilot-leads.csv",
  jsonName: "autopilot-leads.json"
});
await writeStatus({ status: "stopped", phase: "stopped", options, processed, rejected, errors });
await appendLog(`[enrichment-worker] Stopped. processed=${processed}; rejected=${rejected}; errors=${errors}`);
