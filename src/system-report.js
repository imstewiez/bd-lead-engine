import fs from "node:fs/promises";
import path from "node:path";
import { healthSnapshot } from "./health.js";
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

async function readTextTail(filePath, maxLines = 12) {
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
    cycle: status.cycle ?? null,
    pid: status.pid ?? null,
    message: progress.message || "",
    current: status.current || null,
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
      totalRemoved: status.totalRemoved ?? status.totalCleaned ?? null
    }
  };
}

function scoreBoard(health, statuses) {
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

function printHuman(report) {
  const s = report.summary;
  console.log("\nBD Lead Engine — Unified System Report");
  console.log("=====================================");
  console.log(`Time: ${report.generatedAt}`);
  console.log(`Health: ${s.ok ? "OK" : "CHECK"}`);
  console.log(`Leads: raw=${s.rawLeads} qualified=${s.qualified} working=${s.working} contactable=${s.contactable} A=${s.aLeads} A1=${s.a1Hot} A2=${s.a2Strong}`);
  console.log(`Enrichment: dueNow=${s.enrichmentDueNow} enriched1h=${s.enrichedLastHour} enriched24h=${s.enrichedLast24h}`);
  console.log(`Sourcing: harvesters=${s.harvesters} rawSeen=${s.harvesterRawSeen} savedThisCycle=${s.harvesterSavedThisCycle} providerErrors=${s.providerErrors}`);
  console.log(`Duplicates: duplicateLike=${s.duplicateLike} uniqueKeys=${s.uniqueKeys}`);
  if (s.issues.length) console.log(`Issues: ${s.issues.map((issue) => `${issue.severity}:${issue.code}`).join(", ")}`);
  else console.log("Issues: none");
  if (s.staleWorkers.length) console.log(`Stale workers: ${s.staleWorkers.join(", ")}`);

  console.log("\nWorkers / Harvesters");
  console.log("--------------------");
  for (const item of report.workers) {
    const c = item.counts;
    const line = `${item.name.padEnd(34)} ${String(item.status).padEnd(8)} ${String(item.phase).padEnd(12)} age=${String(item.age).padEnd(5)} raw=${String(c.raw).padEnd(5)} saved=${String(c.saved).padEnd(4)} discarded=${String(c.discarded).padEnd(4)} dup=${String(c.duplicates).padEnd(4)} providerErr=${c.providerErrors}`;
    console.log(line);
    if (item.message) console.log(`  ↳ ${item.message}`);
    if (item.current?.name) console.log(`  ↳ current: ${item.current.name}`);
  }

  console.log("\nExports");
  console.log("-------");
  for (const [file, info] of Object.entries(report.exports)) {
    console.log(`${file.padEnd(48)} ${info.exists ? "ok" : "missing"} age=${ageLabel(info.ageMs)} size=${info.size || 0}`);
  }

  console.log("\nRecent errors");
  console.log("-------------");
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
const workerSummaries = statuses.map(summarizeStatus);
const logNames = [...new Set([...Object.keys(health.tasks || {}), ...statuses.map((item) => item.name)])];
const report = {
  ok: health.ok,
  generatedAt: nowIso(),
  summary: scoreBoard(health, statuses),
  health,
  workers: workerSummaries,
  exports: health.exports,
  recentRuns: (db.runs || []).slice(0, 5),
  pruneHistory: (db.pruneHistory || []).slice(0, 5),
  cleanupHistory: (db.cleanupHistory || []).slice(0, 5),
  logs: await recentLogs(logNames)
};

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else printHuman(report);
