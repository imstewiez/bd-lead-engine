import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { filterAndDedupeLeads, filterWorkingLeads } from "./exporter.js";
import { BACKGROUND_TASKS, isPidRunning, readPid } from "./process-manager.js";
import { qualifyLead } from "./qualification.js";
import { getRootDir, readDb } from "./store.js";
import { domainOf, nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

const STATUS_FILES = Object.fromEntries(Object.keys(BACKGROUND_TASKS).map((name) => [name, `${name}-status.json`]));

const EXPORT_FILES = [
  "autopilot-qualified-leads.csv",
  "autopilot-qualified-contactable-leads.csv",
  "autopilot-hot-leads.csv",
  "autopilot-working-leads.csv",
  "autopilot-social-leads.csv",
  "autopilot-linkedin-leads.csv",
  "autopilot-instagram-leads.csv",
  "autopilot-x-leads.csv"
];

function ageMs(dateLike) {
  const parsed = Date.parse(dateLike || "");
  if (!Number.isFinite(parsed)) return null;
  return Date.now() - parsed;
}

function ageHours(dateLike) {
  const age = ageMs(dateLike);
  return age == null ? null : age / (60 * 60 * 1000);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return { error: error.message };
  }
}

async function fileInfo(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return {
      exists: true,
      path: filePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      ageMs: Date.now() - stat.mtimeMs
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, path: filePath };
    return { exists: false, path: filePath, error: error.message };
  }
}

function duplicateStats(leads) {
  const seen = new Set();
  let duplicates = 0;
  for (const lead of leads) {
    const email = cleanEmails(lead.emails || [])[0];
    const key =
      email ||
      String(lead.url || "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase() ||
      `${domainOf(lead.url)}|${String(lead.name || "").toLowerCase()}`;
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return { duplicateLike: duplicates, uniqueKeys: seen.size };
}

function hasContact(lead) {
  return hasDirectOutboundPath(lead) || cleanForms(lead.forms || []).length > 0 || cleanEmails(lead.emails || []).length > 0 || Boolean(lead.bestContact);
}

function enrichmentQueueStats(leads) {
  let stale = 0;
  let contactless = 0;
  let neverDeep = 0;
  let eligible = 0;
  let dueNow = 0;
  let rotationDue = 0;
  let enrichedLastHour = 0;
  let enrichedLast24h = 0;
  let oldestDeepAgeHours = 0;
  let running = 0;

  for (const lead of leads) {
    const url = String(lead.url || "");
    const allowedType = ["partner", "recruitment", "institution"].includes(lead.leadType);
    const eligibleLead = Boolean(lead.id && url && allowedType && !/youtube\.com|youtu\.be/i.test(url));
    const deepAge = ageHours(lead.lastDeepEnrichedAt);
    const contact = hasContact(lead);

    if (lead.deepStatus === "running") running += 1;
    if (!lead.lastDeepEnrichedAt) neverDeep += 1;
    if (deepAge == null || deepAge > 48) stale += 1;
    if (!contact) contactless += 1;
    if (deepAge != null && deepAge <= 1) enrichedLastHour += 1;
    if (deepAge != null && deepAge <= 24) enrichedLast24h += 1;
    if (deepAge != null) oldestDeepAgeHours = Math.max(oldestDeepAgeHours, Math.round(deepAge * 10) / 10);

    if (!eligibleLead) continue;
    eligible += 1;
    if (!lead.lastDeepEnrichedAt) {
      dueNow += 1;
      continue;
    }
    if (!contact && deepAge != null && deepAge > 1) {
      dueNow += 1;
      continue;
    }
    if (deepAge != null && deepAge > 2) {
      rotationDue += 1;
      dueNow += 1;
    }
  }

  return {
    stale,
    contactless,
    neverDeep,
    eligible,
    dueNow,
    rotationDue,
    enrichedLastHour,
    enrichedLast24h,
    oldestDeepAgeHours,
    running
  };
}

function tierCounts(leads) {
  const counts = {
    a1Hot: 0,
    a2Strong: 0,
    bNurture: 0,
    cResearch: 0,
    sourceOnly: 0
  };
  for (const lead of leads) {
    const qualified = qualifyLead(lead);
    if (qualified.icpTier === "A1 Hot") counts.a1Hot += 1;
    else if (qualified.icpTier === "A2 Strong") counts.a2Strong += 1;
    else if (qualified.icpTier === "B Nurture") counts.bNurture += 1;
    else if (qualified.icpTier === "Source-only") counts.sourceOnly += 1;
    else counts.cResearch += 1;
  }
  return counts;
}

export async function healthSnapshot() {
  await fs.mkdir(dataDir, { recursive: true });
  const db = await readDb();
  const rawLeads = db.leads || [];
  const qualifiedLeads = filterAndDedupeLeads(rawLeads);
  const workingLeads = filterWorkingLeads(rawLeads);
  const contactableLeads = workingLeads.filter((lead) => hasDirectOutboundPath(lead) || cleanForms(lead.forms || []).length > 0 || cleanEmails(lead.emails || []).length > 0 || Boolean(lead.bestContact));
  const tiers = tierCounts(workingLeads);
  const duplicate = duplicateStats(rawLeads);
  const enrichmentQueue = enrichmentQueueStats(rawLeads);

  const tasks = {};
  for (const name of Object.keys(BACKGROUND_TASKS)) {
    const pid = await readPid(name);
    tasks[name] = { pid, running: Boolean(pid && isPidRunning(pid)) };
  }

  const statuses = {};
  for (const [name, file] of Object.entries(STATUS_FILES)) {
    const status = await readJsonIfExists(path.join(dataDir, file));
    statuses[name] = {
      exists: Boolean(status),
      updatedAt: status?.updatedAt || null,
      ageMs: status?.updatedAt ? ageMs(status.updatedAt) : null,
      status
    };
  }

  const exports = {};
  for (const file of EXPORT_FILES) {
    exports[file] = await fileInfo(path.join(rootDir, file));
  }

  const issues = [];
  if (!rawLeads.length) issues.push({ severity: "critical", code: "empty_db", message: "Lead database is empty." });
  if (!workingLeads.length && rawLeads.length) issues.push({ severity: "critical", code: "no_working_leads", message: "Raw leads exist but none pass the working-lead gate." });
  if (duplicate.duplicateLike > Math.max(25, rawLeads.length * 0.08)) issues.push({ severity: "warning", code: "duplicate_pressure", message: "Duplicate-like raw lead pressure is high." });
  for (const [name, task] of Object.entries(tasks)) {
    if (!task.running) issues.push({ severity: name === "supervisor" ? "warning" : "critical", code: `${name}_not_running`, message: `${name} is not running.` });
  }
  for (const name of Object.keys(BACKGROUND_TASKS).filter((taskName) => taskName !== "supervisor")) {
    const status = statuses[name];
    if (!status.exists) issues.push({ severity: "warning", code: `${name}_no_status`, message: `${name} has not written a status file yet.` });
    else if (status.ageMs != null && status.ageMs > 20 * 60 * 1000) issues.push({ severity: "warning", code: `${name}_stale_status`, message: `${name} status is stale.` });
  }
  for (const [file, info] of Object.entries(exports)) {
    if (!info.exists) issues.push({ severity: "warning", code: "missing_export", message: `${file} is missing.` });
    else if (info.ageMs > 10 * 60 * 1000) issues.push({ severity: "warning", code: "stale_export", message: `${file} is stale.` });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    updatedAt: nowIso(),
    counts: {
      raw: rawLeads.length,
      qualified: qualifiedLeads.length,
      working: workingLeads.length,
      contactable: contactableLeads.length,
      aLeads: tiers.a1Hot + tiers.a2Strong,
      ...tiers
    },
    duplicate,
    enrichmentQueue,
    tasks,
    statuses,
    exports,
    issues
  };
}
