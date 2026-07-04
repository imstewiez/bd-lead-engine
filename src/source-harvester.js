import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SCAN } from "./config.js";
import { runScan } from "./engine.js";
import { exportLeads } from "./exporter.js";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "source-harvester-status.json");
const stopPath = path.join(dataDir, "source-harvester-stop");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
const numberArg = (name, fallback) => {
  const parsed = Number(args.get(name) || process.env[name.toUpperCase()] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const boolArg = (name, fallback) => args.has(name) ? args.get(name) !== "false" : fallback;

const options = {
  ...DEFAULT_SCAN,
  regionSet: args.get("region") || args.get("regionSet") || "global",
  maxQueries: Math.max(12, Math.min(numberArg("maxQueries", numberArg("batchSize", 96)), 260)),
  limitPerQuery: Math.max(3, Math.min(numberArg("limitPerQuery", 10), 25)),
  delayMs: Math.max(2000, numberArg("delayMs", 10000)),
  maxCycles: Math.max(0, numberArg("maxCycles", 0)),
  fetchPages: boolArg("fetchPages", true),
  deepEnrich: boolArg("deepEnrich", true),
  searchContacts: boolArg("searchContacts", true),
  maxContactPages: Math.max(1, Math.min(numberArg("maxContactPages", 5), 12)),
  maxExternalWebsites: Math.max(0, Math.min(numberArg("maxExternalWebsites", 4), 10)),
  maxTrailQueries: Math.max(2, Math.min(numberArg("maxTrailQueries", 16), 32)),
  trailLimit: Math.max(2, Math.min(numberArg("trailLimit", 6), 15)),
  exportEvery: Math.max(1, numberArg("exportEvery", 5)),
  incremental: true,
  includePartners: boolArg("includePartners", true),
  includeRecruitment: boolArg("includeRecruitment", true),
  includeIntentPosts: boolArg("includeIntentPosts", true),
  includeEcosystem: boolArg("includeEcosystem", true),
  includeSocialProfiles: boolArg("includeSocialProfiles", true),
  includeForums: boolArg("includeForums", true),
  includeSpecialistSources: boolArg("includeSpecialistSources", true),
  includeYouTube: boolArg("includeYouTube", false)
};

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

await fs.rm(stopPath, { force: true }).catch(() => {});
let cycle = 0;
let totals = { total: 0, exported: 0 };
await writeStatus({ status: "running", phase: "started", cycle, options, totals });

while (!(await stopRequested())) {
  cycle += 1;
  const cycleOptions = { ...options, queryOffset: (cycle - 1) * options.maxQueries };
  await writeStatus({ status: "running", phase: "scan", cycle, options: cycleOptions, totals });
  try {
    const run = await runScan(cycleOptions, (progress) => {
      if (progress.message) console.log(`[cycle ${cycle}] ${progress.message}`);
    });
    totals = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
    await writeStatus({ status: "running", phase: "waiting", cycle, options: cycleOptions, lastRun: run, totals });
  } catch (error) {
    await writeStatus({ status: "error", phase: "error", cycle, options: cycleOptions, error: error.message, totals });
  }
  if (options.maxCycles > 0 && cycle >= options.maxCycles) break;
  if (!(await stopRequested())) await sleep(options.delayMs);
}

const finalExport = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
await writeStatus({ status: "stopped", phase: "stopped", cycle, options, totals: finalExport });
