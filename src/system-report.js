import fs from "node:fs/promises";
import path from "node:path";
import { cleanForms, cleanLinks, cleanPhoneNumbers, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { filterAndDedupeLeads, filterWorkingLeads, isExportQualified } from "./exporter.js";
import { healthSnapshot } from "./health.js";
import { sourceBucket } from "./mql5-limit.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { pickBestContact } from "./platform-enrichment.js";
import { getRootDir, readDb } from "./store.js";
import { nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readTextTail(filePath, maxLines = 10) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

function ageMs(dateLike) {
  const parsed = Date.parse(dateLike || "");
  return Number.isFinite(parsed) ? Date.now() - parsed : null;
}

function ageLabel(ms) {
  if (ms == null) return "n/a";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round((ms / 3600000) * 10) / 10}h`;
}

async function listStatusFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  const files = await fs.readdir(dataDir).catch(() => []);
  const statusFiles = files.filter((file) => file.endsWith("-status.json") || file === "supervisor-status.json" || file === "lead-cleaner-status.json");
  const statuses = [];
  for (const file of statusFiles) {
    const name = file.replace(/-status\.json$/, "").replace(/\.json$/, "");
    const status = await readJson(path.join(dataDir, file));
    if (!status) continue;
    const age = ageMs(status.updatedAt);
    statuses.push({ name, file, ageMs: age, age: ageLabel(age), status });
  }
  return statuses.sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeStatus(item) {
  const status = item.status || {};
  const progress = status.progress || {};
  const sourceStats = progress.sourceStats || {};
  const totals = status.totals || status.lastExport || status.lastRun || {};
  const saved = Object.values(sourceStats).reduce((sum, value) => sum + Number(value.saved || 0), 0);
  const raw = Object.values(sourceStats).reduce((sum, value) => sum + Number(value.raw || 0), 0);
  const providerErrors = Object.values(sourceStats).reduce((sum, value) => sum + Number(value.providerErrors || 0), 0);
  const discarded = Object.values(sourceStats).reduce((sum, value) => sum + Number(value.discarded || 0), 0);
  const duplicates = Object.values(sourceStats).reduce((sum, value) => sum + Number(value.duplicates || 0), 0);
  return {
    name: item.name,
    status: status.status || "unknown",
    phase: status.phase || progress.status || "n/a",
    age: item.age,
    ageMs: item.ageMs,
    cycle: status.cycle ?? null,
    pid: status.pid ?? null,
    message: progress.message || "",
    current: status.current || null,
    lastResult: status.lastResult || null,
    counts: {
      raw,
      saved,
      discarded,
      duplicates,
      providerErrors,
      total: totals.total ?? null,
      exported: totals.exported ?? null,
      working: totals.working ?? null,
      contactable: totals.contactable ?? null,
      hot: totals.hot ?? null,
      totalRemoved: status.totalRemoved ?? status.totalCleaned ?? null,
      processed: status.processed ?? null,
      stored: status.stored ?? null,
      errors: status.errors ?? null
    }
  };
}

function preparedLead(lead = {}) {
  const cleaned = stripPlatformOwnedContacts(lead);
  return { ...cleaned, ...pickBestContact(cleaned) };
}

function hasPlatformContact(lead = {}) {
  return (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
}

function contactScore(lead = {}) {
  const cleaned = preparedLead(lead);
  const emails = filterDecisionMakerEmails(cleaned);
  const direct = cleanLinks([...(cleaned.contactLinks || []), ...(cleaned.socialLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter(isUsefulDirectContactUrl);
  const forms = cleanForms(cleaned.forms || []);
  const phones = cleanPhoneNumbers(cleaned.phoneNumbers || []);
  let score = 0;
  if (direct.some((url) => /wa\.me|whatsapp/i.test(url))) score += 40;
  if (direct.some((url) => /t\.me|telegram/i.test(url))) score += 35;
  if (emails.length) score += 30;
  if (phones.length) score += 25;
  if (forms.length) score += 18;
  if ((cleaned.websiteLinks || []).length) score += 10;
  if ((cleaned.decisionMakers || []).length || (cleaned.decisionMakerLinks || []).length) score += 20;
  if (cleaned.bestContact) score += 20;
  return score;
}

function hasRealDecisionContact(lead = {}) {
  const cleaned = preparedLead(lead);
  return Boolean(cleaned.bestContact) || filterDecisionMakerEmails(cleaned).length > 0 || (cleaned.contactLinks || []).length > 0 || (cleaned.decisionMakers || []).length > 0 || (cleaned.decisionMakerLinks || []).length > 0;
}

function isSalesReadyLead(lead = {}) {
  if (!isExportQualified(lead)) return false;
  const cleaned = preparedLead(lead);
  const score = contactScore(cleaned);
  const bucket = sourceBucket(lead);
  if (hasPlatformContact(lead) && !cleaned.bestContact) return false;
  if (["mql5", "myfxbook", "specialist"].includes(bucket) && score < 55) return false;
  return score >= 45;
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function buildLeadQuality(db) {
  const leads = db.leads || [];
  const qualified = filterAndDedupeLeads(leads);
  const working = filterWorkingLeads(leads);
  const exportQualified = leads.filter(isExportQualified);
  const salesReady = qualified.filter(isSalesReadyLead).sort((a, b) => contactScore(b) - contactScore(a));
  const platformContactLeaks = leads.filter(hasPlatformContact);
  const highValueNoContact = leads.filter((lead) => Number(lead.commercialScore || lead.score || 0) >= 75 || lead.priority === "A").filter((lead) => !hasRealDecisionContact(lead));
  const weakSpecialist = leads.filter((lead) => ["mql5", "myfxbook", "specialist"].includes(sourceBucket(lead))).filter((lead) => contactScore(lead) < 45).slice(0, 10);

  return {
    totals: {
      raw: leads.length,
      exportQualified: exportQualified.length,
      qualified: qualified.length,
      working: working.length,
      salesReady: salesReady.length,
      platformContactLeaks: platformContactLeaks.length,
      highValueNoContact: highValueNoContact.length
    },
    byBucket: countBy(leads, sourceBucket),
    qualifiedByBucket: countBy(qualified, sourceBucket),
    workingByBucket: countBy(working, sourceBucket),
    salesReadyByBucket: countBy(salesReady, sourceBucket),
    topSalesReady: salesReady.slice(0, 8).map((lead) => ({ name: lead.name || lead.title || lead.url, bucket: sourceBucket(lead), score: lead.commercialScore || lead.score || 0, contactScore: contactScore(lead), contact: preparedLead(lead).bestContact || "" })),
    platformLeakSamples: platformContactLeaks.slice(0, 8).map((lead) => ({ name: lead.name || lead.title || lead.url, bucket: sourceBucket(lead), contact: lead.bestContact || "" })),
    highValueNoContactSamples: highValueNoContact.slice(0, 8).map((lead) => ({ name: lead.name || lead.title || lead.url, bucket: sourceBucket(lead), score: lead.commercialScore || lead.score || 0 })),
    weakSpecialistSamples: weakSpecialist.map((lead) => ({ name: lead.name || lead.title || lead.url, bucket: sourceBucket(lead), score: lead.commercialScore || lead.score || 0, contactScore: contactScore(lead) }))
  };
}

function scoreBoard(health, statuses, quality) {
  const harvesterStatuses = statuses.filter((item) => item.name.startsWith("source-harvester"));
  const totalProviderErrors = harvesterStatuses.reduce((sum, item) => sum + summarizeStatus(item).counts.providerErrors, 0);
  const totalSaved = harvesterStatuses.reduce((sum, item) => sum + summarizeStatus(item).counts.saved, 0);
  const totalRaw = harvesterStatuses.reduce((sum, item) => sum + summarizeStatus(item).counts.raw, 0);
  const staleWorkers = statuses.filter((item) => Number(item.ageMs || 0) > 20 * 60 * 1000).map((item) => item.name);
  return {
    ok: health.ok,
    rawLeads: health.counts.raw,
    qualified: health.counts.qualified,
    working: health.counts.working,
    contactable: health.counts.contactable,
    aLeads: health.counts.aLeads,
    a1Hot: health.counts.a1Hot,
    a2Strong: health.counts.a2Strong,
    salesReady: quality.totals.salesReady,
    platformContactLeaks: quality.totals.platformContactLeaks,
    highValueNoContact: quality.totals.highValueNoContact,
    duplicateLike: health.duplicate.duplicateLike,
    uniqueKeys: health.duplicate.uniqueKeys,
    enrichmentDueNow: health.enrichmentQueue.dueNow,
    enrichedLastHour: health.enrichmentQueue.enrichedLastHour,
    enrichedLast24h: health.enrichmentQueue.enrichedLast24h,
    harvesters: harvesterStatuses.length,
    harvesterRawSeen: totalRaw,
    harvesterSavedThisCycle: totalSaved,
    providerErrors: totalProviderErrors,
    staleWorkers,
    issues: health.issues
  };
}

async function recentLogs(names) {
  const result = {};
  for (const name of names) {
    result[name] = {
      out: await readTextTail(path.join(dataDir, `${name}.out.log`), 8),
      err: await readTextTail(path.join(dataDir, `${name}.err.log`), 8)
    };
  }
  return result;
}

function printTopic(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function printTableObject(title, object = {}, limit = 12) {
  const entries = Object.entries(object).slice(0, limit);
  if (!entries.length) return;
  console.log(`${title}: ${entries.map(([key, value]) => `${key}=${value}`).join(" | ")}`);
}

function printHuman(report) {
  const s = report.summary;
  console.log("\nBD Lead Engine — Unified System Report");
  console.log("=====================================");
  console.log(`Time: ${report.generatedAt}`);

  printTopic("1) Executive Status");
  console.log(`Health: ${s.ok ? "OK" : "CHECK"}`);
  console.log(`Issues: ${s.issues.length ? s.issues.map((issue) => `${issue.severity}:${issue.code}`).join(", ") : "none"}`);
  console.log(`Stale workers: ${s.staleWorkers.length ? s.staleWorkers.join(", ") : "none"}`);

  printTopic("2) Lead Funnel");
  console.log(`Raw=${s.rawLeads} | Qualified=${s.qualified} | Working=${s.working} | Contactable=${s.contactable} | Sales-ready=${s.salesReady}`);
  console.log(`A=${s.aLeads} | A1 Hot=${s.a1Hot} | A2 Strong=${s.a2Strong} | Duplicates=${s.duplicateLike} | Unique=${s.uniqueKeys}`);

  printTopic("3) Quality Control");
  console.log(`Platform contact leaks=${s.platformContactLeaks} | High-value without real contact=${s.highValueNoContact}`);
  printTableObject("Sales-ready by bucket", report.quality.salesReadyByBucket);
  printTableObject("Qualified by bucket", report.quality.qualifiedByBucket);
  if (report.quality.platformLeakSamples.length) {
    console.log("Platform leak samples:");
    for (const item of report.quality.platformLeakSamples) console.log(`  - ${item.bucket}: ${item.name} | ${item.contact}`);
  }
  if (report.quality.highValueNoContactSamples.length) {
    console.log("High-value no-contact samples:");
    for (const item of report.quality.highValueNoContactSamples) console.log(`  - ${item.bucket}: ${item.name} | score=${item.score}`);
  }

  printTopic("4) Enrichment");
  console.log(`Due now=${s.enrichmentDueNow} | Enriched 1h=${s.enrichedLastHour} | Enriched 24h=${s.enrichedLast24h}`);
  const smart = report.workers.find((item) => item.name === "smart-enrichment-worker");
  if (smart) console.log(`Smart trail: phase=${smart.phase} processed=${smart.counts.processed ?? "n/a"} stored=${smart.counts.stored ?? "n/a"} errors=${smart.counts.errors ?? 0}${smart.current?.name ? ` | current=${smart.current.name}` : ""}`);

  printTopic("5) Sourcing Performance");
  console.log(`Harvesters=${s.harvesters} | Raw seen=${s.harvesterRawSeen} | Saved this cycle=${s.harvesterSavedThisCycle} | Provider errors=${s.providerErrors}`);
  for (const item of report.workers.filter((worker) => worker.name.startsWith("source-harvester"))) {
    const c = item.counts;
    console.log(`${item.name.padEnd(34)} age=${String(item.age).padEnd(5)} raw=${String(c.raw).padEnd(5)} saved=${String(c.saved).padEnd(4)} discarded=${String(c.discarded).padEnd(4)} dup=${String(c.duplicates).padEnd(4)} providerErr=${c.providerErrors}`);
    if (item.message) console.log(`  ↳ ${item.message}`);
  }

  printTopic("6) Workers");
  for (const item of report.workers.filter((worker) => !worker.name.startsWith("source-harvester"))) {
    const c = item.counts;
    console.log(`${item.name.padEnd(34)} ${String(item.status).padEnd(8)} ${String(item.phase).padEnd(16)} age=${String(item.age).padEnd(5)} processed=${c.processed ?? "-"} stored=${c.stored ?? "-"} errors=${c.errors ?? "-"}`);
    if (item.current?.name) console.log(`  ↳ current: ${item.current.name}`);
    if (item.lastResult?.name) console.log(`  ↳ last: ${item.lastResult.name} | best=${item.lastResult.bestContact || "-"}`);
  }

  printTopic("7) Exports");
  for (const [file, info] of Object.entries(report.exports)) {
    console.log(`${file.padEnd(48)} ${info.exists ? "ok" : "missing"} age=${ageLabel(info.ageMs)} size=${info.size || 0}`);
  }

  printTopic("8) Action Needed");
  const actions = [];
  if (s.staleWorkers.length) actions.push(`Restart background if still stale after next supervisor cycle: ${s.staleWorkers.join(", ")}`);
  if (s.providerErrors > Math.max(500, s.harvesterRawSeen)) actions.push("High provider errors: add official search API keys for scale/stability.");
  if (s.platformContactLeaks) actions.push("Platform-owned contacts found: smart enrichment should replace them with decision-maker contacts.");
  if (s.salesReady === 0 && s.qualified > 0) actions.push("No sales-ready export yet: let smart enrichment run longer.");
  if (!actions.length) actions.push("No urgent action. Let background run.");
  for (const action of actions) console.log(`- ${action}`);

  printTopic("9) Recent Errors");
  let anyError = false;
  for (const [name, logs] of Object.entries(report.logs)) {
    if (!logs.err.length) continue;
    anyError = true;
    console.log(`\n${name}:`);
    for (const line of logs.err.slice(-5)) console.log(`  ${line}`);
  }
  if (!anyError) console.log("none");
}

const health = await healthSnapshot();
const db = await readDb();
const statuses = await listStatusFiles();
const quality = buildLeadQuality(db);
const workerSummaries = statuses.map(summarizeStatus);
const logNames = [...new Set([...Object.keys(health.tasks || {}), ...statuses.map((item) => item.name)])];
const report = {
  ok: health.ok,
  generatedAt: nowIso(),
  summary: scoreBoard(health, statuses, quality),
  health,
  quality,
  workers: workerSummaries,
  exports: health.exports,
  recentRuns: (db.runs || []).slice(0, 5),
  pruneHistory: (db.pruneHistory || []).slice(0, 5),
  cleanupHistory: (db.cleanupHistory || []).slice(0, 5),
  qualityRebuildHistory: (db.qualityRebuildHistory || []).slice(0, 5),
  smartTrailBoostHistory: (db.smartTrailBoostHistory || []).slice(0, 5),
  logs: await recentLogs(logNames)
};

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else printHuman(report);
